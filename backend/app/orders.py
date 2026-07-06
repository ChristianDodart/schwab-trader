"""Order placement / status / list / cancel — Phase 5 trading.

Human-in-the-loop: nothing executes automatically; the UI order ticket is the
confirm step. Server-side safety rails:
  - Orders only on the SELECTED account, and only when it is trading-enabled
    (per-account toggle) — never an account you're not viewing, never the LLC.
  - SELL refused unless held shares are positively confirmed >= quantity
    (fail-CLOSED — an unreadable position blocks the sell; no accidental shorts).
  - STOP/STOP_LIMIT refused if the stop is on the wrong side of the last price
    (would convert to an immediate market order).
  - All order types supported; MARKET and triggered orders fill at the
    prevailing price (the ticket warns).
  - Cancel refused only for terminal statuses (denylist).
"""
from __future__ import annotations

import asyncio
import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from . import accounts as accounts_svc
from . import config_store
from .db import SessionLocal
from .db.models import Lot
from .schwab import hub
from .schwab.auth import get_client
from .strategy import rules

# An order can be canceled unless it's already terminal. Denylist is robust to
# Schwab adding new live statuses (broker is the final authority on the cancel).
_TERMINAL = {
    "FILLED", "CANCELED", "REJECTED", "EXPIRED", "REPLACED",
    "PENDING_CANCEL", "PENDING_REPLACE", "UNKNOWN",
}

# Soft-confirm thresholds (overridable with confirm=true). The strategy trades
# ~$500–1500/rung, so these only trip on a likely typo.
_FATFINGER_PCT = 0.20       # limit this far from the last price → confirm
_NOTIONAL_CONFIRM = 10_000  # a BUY larger than this (qty × price) → confirm


def _f(x) -> float:
    return float(x) if x is not None else 0.0


def _ref_price(symbol: str) -> float | None:
    """Last price for validating a real order — TRUSTED (schwab-sourced) quotes
    only. A demo/synthetic quote must read as 'no reference' so the rails fail
    CLOSED (require confirmation) instead of validating against a random-walk price."""
    q = hub.latest.get(symbol.upper(), {}) or {}
    if q.get("source") != "schwab":
        return None
    p = q.get("last")
    return _f(p) if p else None


def _avg_fill_price(o: dict):
    """Qty-weighted average EXECUTION price from the order's execution legs, or
    None if nothing has executed. The top-level order `price` is the limit/working
    price (null for MARKET orders) — NOT what it actually filled at."""
    tot_qty = tot_val = 0.0
    for act in o.get("orderActivityCollection") or []:
        if act.get("activityType") != "EXECUTION":
            continue
        for ex in act.get("executionLegs") or []:
            q, p = ex.get("quantity"), ex.get("price")
            if isinstance(q, (int, float)) and isinstance(p, (int, float)) and q > 0 and p > 0:
                tot_qty += q
                tot_val += q * p
    return (tot_val / tot_qty) if tot_qty > 0 else None


async def _account_hash(explicit: str | None) -> str | None:
    # MUST use the profile-scoped key (like every other selected-account read), not
    # the bare SELECTED_KEY — otherwise order list/get/cancel resolve a stale,
    # non-active-profile account under the active profile's token.
    return explicit or await accounts_svc.get_setting(accounts_svc._sel_key())


def _build_order(symbol: str, side: str, quantity: int, order_type: str,
                 limit_price=None, stop_price=None, trailing_offset=None,
                 trailing_type: str = "PERCENT", duration: str = "DAY",
                 session: str = "NORMAL"):
    """Hand-built via OrderBuilder so we support stop/stop-limit/trailing
    (schwab-py has no prebuilt helpers for those)."""
    from schwab.orders.common import (
        Duration, EquityInstruction, OrderStrategyType, OrderType, Session,
        StopPriceLinkBasis, StopPriceLinkType,
    )
    from schwab.orders.generic import OrderBuilder

    symbol, side, order_type = symbol.upper(), side.upper(), order_type.upper()
    if quantity <= 0:
        raise ValueError("quantity must be > 0")
    if side not in ("BUY", "SELL"):
        raise ValueError("side must be BUY or SELL")
    try:
        ot = OrderType[order_type]
    except KeyError:
        raise ValueError(f"unsupported order type: {order_type}")
    try:
        dur = Duration[str(duration).upper()]
    except KeyError:
        raise ValueError(f"unsupported duration: {duration}")
    try:
        sess = Session[str(session).upper()]
    except KeyError:
        raise ValueError(f"unsupported session: {session}")

    ob = OrderBuilder()
    ob.set_session(sess)
    ob.set_duration(dur)
    ob.set_order_strategy_type(OrderStrategyType.SINGLE)
    ob.set_order_type(ot)

    if order_type in ("LIMIT", "STOP_LIMIT"):
        if not limit_price or float(limit_price) <= 0:
            raise ValueError("a positive limit price is required")
        ob.set_price(f"{float(limit_price):.2f}")
    if order_type in ("STOP", "STOP_LIMIT"):
        if not stop_price or float(stop_price) <= 0:
            raise ValueError("a positive stop price is required")
        ob.set_stop_price(f"{float(stop_price):.2f}")
    if order_type == "TRAILING_STOP":
        if not trailing_offset or float(trailing_offset) <= 0:
            raise ValueError("a positive trailing offset is required")
        tt = str(trailing_type).upper()
        try:
            lt = StopPriceLinkType[tt]  # PERCENT or VALUE
        except KeyError:
            raise ValueError(f"unsupported trailing type: {trailing_type}")
        off = float(trailing_offset)
        # sanity bounds (PERCENT is whole-number percent: 5 == 5%, not 0.05)
        if tt == "PERCENT" and not (0.1 <= off <= 50):
            raise ValueError("trailing percent must be 0.1–50 (e.g. 5 = 5%)")
        if tt == "VALUE" and off <= 0:
            raise ValueError("trailing dollar offset must be > 0")
        ob.set_stop_price_link_type(lt)
        ob.set_stop_price_link_basis(StopPriceLinkBasis.MARK)
        ob.set_stop_price_offset(off)

    instr = EquityInstruction.BUY if side == "BUY" else EquityInstruction.SELL
    ob.add_equity_leg(instr, symbol, int(quantity))
    return ob


async def place_order(symbol: str, side: str, quantity: int,
                      order_type: str = "LIMIT", limit_price=None,
                      stop_price=None, trailing_offset=None,
                      trailing_type: str = "PERCENT", duration: str = "DAY",
                      session: str = "NORMAL",
                      account_hash: str | None = None,
                      confirm: bool = False) -> dict:
    client = get_client()
    if client is None:
        return {"ok": False, "error": "no Schwab token"}

    # --- HARD GUARD: orders only on the SELECTED account, and only if it is
    # trading-enabled. get_trading_account() = selected-if-enabled, else None.
    # A client-supplied account_hash may not diverge from the selected account.
    target = await accounts_svc.get_trading_account()
    if not target:
        # trading_disabled flag lets the UI name WHICH account (it knows the mask) —
        # the server only has the opaque hash, not the account number.
        return {"ok": False, "trading_disabled": True,
                "error": "This account isn't enabled for trading — turn it on in Settings → Account."}
    if account_hash and account_hash != target:
        return {"ok": False, "error": "orders may only be placed on the selected (trading-enabled) account"}

    try:
        builder = _build_order(symbol, side, quantity, order_type, limit_price,
                               stop_price, trailing_offset, trailing_type,
                               duration, session)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    # --- stop-direction guard: a wrong-side stop triggers an immediate market order ---
    if order_type.upper() in ("STOP", "STOP_LIMIT") and stop_price:
        ref = _ref_price(symbol)
        if ref:
            sp = float(stop_price)
            if side.upper() == "SELL" and sp >= ref:
                return {"ok": False, "error": f"sell-stop {sp} is at/above the last price {ref} — would trigger immediately"}
            if side.upper() == "BUY" and sp <= ref:
                return {"ok": False, "error": f"buy-stop {sp} is at/below the last price {ref} — would trigger immediately"}
        elif not confirm:
            # No trusted quote to validate the stop side — fail CLOSED (match the
            # fat-finger rail) rather than skipping the check.
            return {"ok": False, "needs_confirm": True,
                    "warning": f"No live quote for {symbol.upper()} to check the stop direction — confirm."}

    # --- fat-finger guard: a limit far from the market is probably a typo. Soft
    # block (needs_confirm) so the user can override a deliberate odd limit. If we
    # have NO live quote, we can't validate it — require confirmation rather than
    # silently skip the check.
    last_ref = _ref_price(symbol)
    if not confirm and order_type.upper() in ("LIMIT", "STOP_LIMIT") and limit_price:
        if not last_ref or last_ref <= 0:
            return {"ok": False, "needs_confirm": True,
                    "warning": f"No live quote for {symbol.upper()} to sanity-check the "
                               f"${float(limit_price):.2f} limit — confirm the price."}
        dev = abs(float(limit_price) / last_ref - 1)
        if dev > _FATFINGER_PCT:
            return {"ok": False, "needs_confirm": True,
                    "warning": f"Limit ${float(limit_price):.2f} is {dev * 100:.0f}% "
                               f"from the last price ${last_ref:.2f} — confirm this isn't a typo."}

    # --- notional sanity rail: an unexpectedly large BUY is likely a quantity typo ---
    if not confirm and side.upper() == "BUY":
        market_ish = order_type.upper() not in ("LIMIT", "STOP_LIMIT")
        px = float(limit_price) if limit_price else (last_ref or 0.0)
        if market_ish and px <= 0:
            # No live quote to size a market/triggered buy → can't bound it; confirm.
            return {"ok": False, "needs_confirm": True,
                    "warning": f"No live quote for {symbol.upper()} to size this market order — "
                               f"confirm you want to proceed."}
        notional = quantity * px
        if notional > _NOTIONAL_CONFIRM:
            return {"ok": False, "needs_confirm": True,
                    "warning": f"This buy is about ${notional:,.0f} ({quantity} × ${px:.2f}) — "
                               f"confirm the quantity isn't a typo."}

    # --- SELL guard (fail CLOSED): only sell shares positively confirmed as held ---
    if side.upper() == "SELL":
        held = await accounts_svc.held_shares(target, symbol)
        if held is None:
            return {"ok": False, "error": "could not verify shares held — sell refused"}
        if quantity > held:
            return {"ok": False,
                    "error": f"sell {quantity} exceeds {held:g} shares held — refused to avoid a short"}

    def go():
        from schwab.utils import Utils
        resp = client.place_order(target, builder.build())
        oid, warn = None, None
        try:
            oid = Utils(client, target).extract_order_id(resp)
        except Exception as e:  # missing Location header returns None; mismatch raises
            warn = f"order-id not resolved: {e!r}"
        return resp.status_code, resp.text, oid, warn

    try:
        status, body, oid, warn = await asyncio.to_thread(go)
    except Exception as e:
        return {"ok": False, "error": repr(e)}
    ok = status in (200, 201)
    return {
        "ok": ok,
        "http": status,
        "order_id": oid,
        "needs_verify": bool(ok and not oid),   # placed but id unresolved -> check Orders
        "warning": warn,
        "detail": None if ok else (body[:300] or f"HTTP {status}"),
    }


async def get_order(order_id, account_hash: str | None = None) -> dict:
    client = get_client()
    h = await _account_hash(account_hash)
    if client is None or not h:
        return {"error": "no client/account"}

    def go():
        return client.get_order(order_id, h).json()

    try:
        return await asyncio.to_thread(go)
    except Exception as e:
        return {"error": repr(e)}


async def list_orders(days: int = 7, account_hash: str | None = None) -> list[dict]:
    client = get_client()
    h = await _account_hash(account_hash)
    if client is None or not h:
        return []

    def go():
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=days)
        r = client.get_orders_for_account(h, from_entered_datetime=start,
                                          to_entered_datetime=end)
        return r.json() if r.status_code == 200 else []

    try:
        data = await asyncio.to_thread(go)
    except Exception:
        return []

    out = []
    for o in data if isinstance(data, list) else []:
        legs = o.get("orderLegCollection", []) or []
        leg = legs[0] if legs else {}
        limit_price = o.get("price")
        fill = _avg_fill_price(o)
        out.append({
            "order_id": o.get("orderId"),
            "symbol": leg.get("instrument", {}).get("symbol"),
            "side": leg.get("instruction"),
            "quantity": o.get("quantity"),
            "filled": o.get("filledQuantity"),
            "type": o.get("orderType"),
            # show the actual fill price once anything executes (MARKET orders have
            # no limit price), else the working/limit price.
            "price": round(fill, 4) if fill is not None else limit_price,
            "limit_price": limit_price,
            "fill_price": round(fill, 4) if fill is not None else None,
            "status": o.get("status"),
            "entered": (o.get("enteredTime") or "")[:19],
        })
    return out


_WORKING_STATUSES = {"WORKING", "QUEUED", "ACCEPTED", "PENDING_ACTIVATION",
                     "AWAITING_PARENT_ORDER", "AWAITING_CONDITION", "AWAITING_MANUAL_REVIEW"}


async def working_count(account_hash: str | None = None) -> int:
    """Count of still-working orders on the account — powers the ambient nav badge.
    READ-ONLY (reuses list_orders); never touches place/cancel."""
    orders = await list_orders(days=7, account_hash=account_hash)
    return sum(1 for o in orders if o.get("status") in _WORKING_STATUSES)


async def cancel_order(order_id, account_hash: str | None = None) -> dict:
    client = get_client()
    h = await _account_hash(account_hash)
    if client is None or not h:
        return {"ok": False, "error": "no client/account"}

    def go():
        status = (client.get_order(order_id, h).json() or {}).get("status")
        if status in _TERMINAL:
            return {"ok": False, "error": f"order is {status}; not cancelable", "status": status}
        c = client.cancel_order(order_id, h)
        return {"ok": c.status_code in (200, 201), "http": c.status_code, "status": status}

    try:
        return await asyncio.to_thread(go)
    except Exception as e:
        return {"ok": False, "error": repr(e)}


# ---- strategy-driven order suggestions (the user confirms, then places) ----

async def suggest_buy(symbol: str, account_hash: str) -> dict:
    symbol = symbol.upper()
    cfg = await config_store.get_strategy(account_hash)
    async with SessionLocal() as s:
        lots = (await s.execute(
            select(Lot).where(Lot.symbol == symbol, Lot.account_hash == account_hash)
            .order_by(Lot.rung)
        )).scalars().all()
    filled = len(lots)
    next_rung = filled + 1
    if filled == 0:
        return {"symbol": symbol, "error": "no existing lots; first-buy price is manual"}
    if next_rung > cfg.max_rungs:
        return {"symbol": symbol, "error": f"ladder full: {filled} rungs (max {cfg.max_rungs})"}

    # Match the dashboard/ladder: scale the trigger by account deployment when the
    # user enabled it (no-op / cached when off).
    from . import accounts as accounts_svc
    deployed = await accounts_svc.deployed_pct(account_hash) if cfg.deployment_scaling.enabled else None
    trigger = rules.next_buy_price(_f(lots[-1].buy_price), next_rung, cfg, deployed)
    dollars = rules.sizing_dollars(filled, cfg)
    raw_qty = math.floor(dollars / trigger) if trigger else 0
    out = {
        "symbol": symbol, "side": "BUY", "order_type": "LIMIT",
        "rung": next_rung, "limit_price": round(trigger, 2),
        "quantity": raw_qty, "sizing_dollars": dollars,
        "est_cost": round(raw_qty * trigger, 2),
        "rationale": f"Rung {next_rung}: {dollars:.0f} ÷ {trigger:.2f} trigger",
    }
    if raw_qty < 1:  # one share already exceeds the rung budget — let the human size it
        out["note"] = f"one share (~${trigger:.0f}) exceeds the ${dollars:.0f} rung budget — set quantity manually"
    # Advisory only: surface available buying power so the ticket can flag an order
    # that exceeds it. NEVER a hard block — margin/settlement rules are the broker's job.
    try:
        ms = await accounts_svc.margin_summary(account_hash)
        bp = ms.get("buying_power") if not ms.get("blocked") else None
    except Exception:
        bp = None
    out["buying_power"] = bp
    out["affordable"] = (out["est_cost"] <= bp) if bp is not None else None
    return out


async def suggest_sell(lot_id: int, account_hash: str) -> dict:
    async with SessionLocal() as s:
        lot = (await s.execute(
            select(Lot).where(Lot.id == lot_id, Lot.account_hash == account_hash)
        )).scalar_one_or_none()
    if lot is None:
        return {"error": f"lot {lot_id} not found"}
    cfg = await config_store.get_strategy(account_hash)
    bp = _f(lot.buy_price)
    sh = _f(lot.shares)
    qty = int(sh)  # whole-share order
    target = (_f(lot.sell_target_price) if lot.sell_target_price is not None
              else rules.sell_target_price(bp, sh, cfg, mode=lot.sell_mode))
    out = {
        "symbol": lot.symbol, "side": "SELL", "order_type": "LIMIT",
        "lot_id": lot_id, "rung": lot.rung, "limit_price": round(target, 2),
        "quantity": qty, "buy_price": round(bp, 2),
        # est_* derived from the INTEGER qty actually ordered, so they match
        "est_proceeds": round(qty * target, 2),
        "est_profit": round((target - bp) * qty, 2),
    }
    if qty == 0:
        out["note"] = f"lot holds {sh:g} (<1) share — set quantity manually"
    elif qty < sh:
        out["note"] = f"lot holds {sh:g}; whole-share order of {qty} leaves {sh - qty:g}"
    return out
