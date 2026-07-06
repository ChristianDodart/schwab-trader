"""Bulk actions — harvest profitable last-positions (sell) and bulk-buy (dips or
fresh entries). The UI builds a plan (read-only), the user reviews + confirms,
then these place orders ONE BY ONE through the guarded orders.place_order path
(selected+trading-enabled account, SELL fail-closed held-shares, stop-direction).

Each plan flags which candidates QUALIFY for auto-selection (configurable
thresholds in `bulk_prefs`); the UI pre-checks those but every candidate stays
manually selectable/deselectable.

HARD SAFETY: bulk-sell may only sell a symbol's LAST (highest-rung) open lot —
never a deeper lot, even if profitable — enforced server-side regardless of
what the client sends. Sell also re-checks profitability at placement.
"""
from __future__ import annotations

import json

from sqlalchemy import select

from . import accounts as accounts_svc
from . import config_store
from . import orders as orders_svc
from . import profiles as profiles_svc
from .db import SessionLocal
from .db.models import Lot, Ticker
from .schwab import hub
from .strategy import rules

_EPS = 1e-9
_DEFAULT_PREFS = {"sell_min_gain_pct": 0.0, "buy_dip_pct": 10.0}
_BULK_MAX_NOTIONAL = 25_000.0   # per-order fat-finger ceiling (well above a ~$1.5k rung)
_BULK_PRICE_BAND = 0.25         # an edited BUY limit may sit at most this far from the market


def _f(x) -> float:
    return float(x) if x is not None else 0.0


def _price(sym: str):
    """Current price for money decisions — TRUSTED (schwab-sourced) quotes only.
    Demo/synthetic quotes are random-walk numbers; pricing a real order off one
    would be catastrophic, so their absence must read as 'no live price' and make
    every plan/placement refuse."""
    q = hub.latest.get(sym.upper(), {}) or {}
    if q.get("source") != "schwab":
        return None
    p = q.get("last")
    return _f(p) if p else None


# --- auto-select thresholds (persisted; drive the DEFAULT checkboxes only) ---

async def get_prefs() -> dict:
    """{sell_min_gain_pct, buy_dip_pct}. Auto-select a sell candidate when its last
    lot's gain% >= sell_min_gain_pct, and a held buy candidate when price is
    >= buy_dip_pct below its last buy. Both default sensibly; every candidate is
    still manually selectable regardless."""
    raw = await accounts_svc.get_setting(profiles_svc.pkey("bulk_prefs"))
    d = {}
    if raw:
        try:
            d = json.loads(raw)
        except (ValueError, TypeError):
            d = {}
    return {
        "sell_min_gain_pct": max(0.0, _f(d.get("sell_min_gain_pct", _DEFAULT_PREFS["sell_min_gain_pct"]))),
        "buy_dip_pct": max(0.0, _f(d.get("buy_dip_pct", _DEFAULT_PREFS["buy_dip_pct"]))),
    }


async def set_prefs(patch: dict) -> dict:
    cur = await get_prefs()
    if patch.get("sell_min_gain_pct") is not None:
        cur["sell_min_gain_pct"] = max(0.0, _f(patch["sell_min_gain_pct"]))
    if patch.get("buy_dip_pct") is not None:
        cur["buy_dip_pct"] = max(0.0, _f(patch["buy_dip_pct"]))
    await accounts_svc.set_setting(profiles_svc.pkey("bulk_prefs"), json.dumps(cur))
    return cur


async def _lots_by_symbol(account_hash: str) -> dict[str, list[Lot]]:
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(Lot).where(Lot.account_hash == account_hash).order_by(Lot.symbol, Lot.rung)
        )).scalars().all()
    by: dict[str, list[Lot]] = {}
    for l in rows:
        by.setdefault(l.symbol, []).append(l)
    return by


def _last_lot(lots: list[Lot]) -> Lot:
    return max(lots, key=lambda l: l.rung)  # highest rung = last-in (LIFO)


async def _not_trading(account_hash: str) -> bool:
    """The selected account can't place orders — planning would only mislead."""
    return await accounts_svc.get_trading_account() != account_hash


async def sell_plan(account_hash: str) -> dict:
    """Every PROFITABLE last position (the sellable set). `qualifies` marks those
    whose gain% meets the auto-select threshold. Sell is marketable @ current price."""
    if await _not_trading(account_hash):
        return {"ok": True, "mode": hub.mode, "count": 0, "candidates": [], "note": "account is not trading-enabled"}
    prefs = await get_prefs()
    min_gain = prefs["sell_min_gain_pct"]
    by = await _lots_by_symbol(account_hash)
    cands = []
    for sym, lots in by.items():
        last = _last_lot(lots)
        px = _price(sym)
        if px is None:
            continue
        qty = int(_f(last.shares))
        bp = _f(last.buy_price)
        if qty < 1 or (px - bp) * qty <= _EPS:   # only profitable last positions are sellable here
            continue
        gain_pct = ((px - bp) / bp * 100) if bp > 0 else 0.0
        cands.append({
            "symbol": sym, "lot_id": last.id, "rung": last.rung,
            "shares": qty, "buy_price": round(bp, 2), "price": round(px, 2),
            "order_type": "LIMIT", "limit_price": round(px, 2),
            "est_proceeds": round(qty * px, 2), "est_profit": round((px - bp) * qty, 2),
            "gain_pct": round(gain_pct, 2), "qualifies": gain_pct >= min_gain, "note": None,
        })
    cands.sort(key=lambda c: c["est_profit"], reverse=True)
    return {"ok": True, "mode": hub.mode, "count": sum(1 for c in cands if c["qualifies"]), "candidates": cands}


async def buy_plan(account_hash: str) -> dict:
    """Every BUYABLE symbol — held positions with ladder room AND watchlist tickers
    (fresh entries). `qualifies` marks held positions that have dipped >= buy_dip_pct
    below their last buy (auto-selected). New/undipped rows are selectable but not
    auto-checked. Sizing follows the strategy tier; buys are marketable @ current."""
    if await _not_trading(account_hash):
        return {"ok": True, "mode": hub.mode, "count": 0, "candidates": [], "note": "account is not trading-enabled"}
    prefs = await get_prefs()
    dip = prefs["buy_dip_pct"]
    cfg = await config_store.get_strategy(account_hash)
    by = await _lots_by_symbol(account_hash)
    async with SessionLocal() as s:
        watch = (await s.execute(select(Ticker.symbol).where(Ticker.watch.is_(True)))).scalars().all()
    universe = sorted(set(by) | set(watch))

    cands = []
    for sym in universe:
        px = _price(sym)
        if px is None or px <= 0:
            continue
        lots = by.get(sym, [])
        filled = len(lots)
        if filled >= cfg.max_rungs:   # ladder full — no room to add
            continue
        dollars = rules.sizing_dollars(filled, cfg)
        qty = int(dollars // px)      # whole-share, strategy-sized
        if qty < 1:                   # one share exceeds the rung budget → use the single ticket
            continue
        is_new = filled == 0
        qualifies = False
        if not is_new:
            last_buy = _f(_last_lot(lots).buy_price)
            if last_buy > 0 and px <= last_buy * (1 - dip / 100):
                qualifies = True
        cands.append({
            "symbol": sym, "is_new": is_new, "rung": filled + 1, "shares": qty,
            "price": round(px, 2), "order_type": "LIMIT", "limit_price": round(px, 2),
            "est_cost": round(qty * px, 2), "qualifies": qualifies, "note": None,
        })
    # qualifying dips first (deepest discount first), then everything else by symbol
    cands.sort(key=lambda c: (not c["qualifies"], c["symbol"]))
    # Advisory: buying power so the review modal can flag when the SELECTED total
    # exceeds it. Informational — never blocks (margin rules are the broker's job).
    try:
        from . import accounts as accounts_svc
        ms = await accounts_svc.margin_summary(account_hash)
        buying_power = ms.get("buying_power") if not ms.get("blocked") else None
    except Exception:
        buying_power = None
    return {"ok": True, "mode": hub.mode, "buying_power": buying_power,
            "count": sum(1 for c in cands if c["qualifies"]), "candidates": cands}


async def bulk_sell(account_hash: str, items: list[dict], order_type: str = "LIMIT", confirm: bool = False) -> dict:
    """Place each reviewed sell. HARD: the lot must be its symbol's LAST (highest-rung)
    lot, and shares may not exceed that lot's shares (never sell into a deeper lot).
    LIMIT places at the reviewed price (a floor — fills at that price or better, so a
    stale/edited price can't fill below it); MARKET re-checks profitability at the
    current price (no floor) and fills now."""
    ot = "MARKET" if str(order_type).upper() == "MARKET" else "LIMIT"
    by = await _lots_by_symbol(account_hash)
    last_ids = {_last_lot(lots).id for lots in by.values()}
    id_to_lot = {l.id: l for lots in by.values() for l in lots}
    results = []
    seen_ids: set[int] = set()
    for it in items:
        lid = int(it.get("lot_id") or 0)
        shares = int(it.get("shares") or 0)
        lot = id_to_lot.get(lid)
        if lot is None:
            results.append({"lot_id": lid, "ok": False, "error": "lot not found on this account"})
            continue
        # IDENTITY: the reviewed symbol must match the lot the id resolves to. SQLite
        # reuses rowids after the wipe-and-reinsert resync, so a stale id from a plan
        # made before a resync could alias a DIFFERENT lot — refuse instead of selling
        # the wrong position. (Fail-closed: an item without a symbol is refused too.)
        want_sym = str(it.get("symbol") or "").upper()
        if not want_sym or want_sym != lot.symbol.upper():
            results.append({"lot_id": lid, "symbol": lot.symbol, "ok": False,
                            "error": "lot identity mismatch — refresh the plan and review again"})
            continue
        # One order per lot per batch: a duplicated lot_id would sell the last lot's
        # shares twice, reaching deeper inventory the per-item guard can't see.
        if lid in seen_ids:
            results.append({"lot_id": lid, "symbol": lot.symbol, "ok": False,
                            "error": "duplicate lot in this batch — refused"})
            continue
        seen_ids.add(lid)
        if lid not in last_ids:
            results.append({"lot_id": lid, "symbol": lot.symbol, "ok": False,
                            "error": "not the last position — refused (bulk-sell only sells last positions)"})
            continue
        px = _price(lot.symbol)
        lot_sh = int(_f(lot.shares))
        if px is None or px <= 0:
            results.append({"lot_id": lid, "symbol": lot.symbol, "ok": False, "error": "no live price"})
            continue
        if shares < 1:
            results.append({"lot_id": lid, "symbol": lot.symbol, "ok": False, "error": "shares must be >= 1"})
            continue
        if shares > lot_sh:   # never sell more than the last lot holds (would reach a deeper lot)
            results.append({"lot_id": lid, "symbol": lot.symbol, "ok": False,
                            "error": f"exceeds the last position's {lot_sh} shares"})
            continue
        if ot == "MARKET":
            if (px - _f(lot.buy_price)) * shares <= _EPS:   # no floor → never market-sell at a loss
                results.append({"lot_id": lid, "symbol": lot.symbol, "ok": False,
                                "error": f"no longer profitable at {round(px, 2)} — skipped"})
                continue
            res = await orders_svc.place_order(lot.symbol, "SELL", shares, "MARKET", account_hash=account_hash, confirm=True)
            results.append({"lot_id": lid, "symbol": lot.symbol, "shares": shares, "order_type": "MARKET", "limit_price": None, **res})
        else:
            lim = round(_f(it.get("limit_price")) if it.get("limit_price") else px, 2)
            if lim <= 0:
                results.append({"lot_id": lid, "symbol": lot.symbol, "ok": False, "error": "invalid limit price"})
                continue
            # The floor logic only protects when the floor is ABOVE cost — an EDITED
            # limit below break-even would place a marketable losing sell. This is the
            # "sell profitable" tool: refuse sub-break-even limits outright.
            if (lim - _f(lot.buy_price)) * shares <= _EPS:
                results.append({"lot_id": lid, "symbol": lot.symbol, "ok": False,
                                "error": f"limit {lim} is at/below the {round(_f(lot.buy_price), 2)} cost — not profitable, refused"})
                continue
            res = await orders_svc.place_order(lot.symbol, "SELL", shares, "LIMIT", limit_price=lim, account_hash=account_hash, confirm=True)
            results.append({"lot_id": lid, "symbol": lot.symbol, "shares": shares, "order_type": "LIMIT", "limit_price": lim, **res})
    return {"ok": bool(results) and all(r.get("ok") for r in results),
            "placed": sum(1 for r in results if r.get("ok")), "count": len(results), "results": results}


async def bulk_buy(account_hash: str, items: list[dict], order_type: str = "LIMIT", confirm: bool = False) -> dict:
    """Place each reviewed buy at its shares/price. Guards: ladder room, an edited
    LIMIT within +-25% of the market (fat-finger), and a per-order notional ceiling.
    LIMIT places at the reviewed price; MARKET fills now."""
    ot = "MARKET" if str(order_type).upper() == "MARKET" else "LIMIT"
    cfg = await config_store.get_strategy(account_hash)
    by = await _lots_by_symbol(account_hash)
    results = []
    seen_syms: set[str] = set()
    for it in items:
        sym = str(it.get("symbol") or "").upper()
        shares = int(it.get("shares") or 0)
        px = _price(sym)
        if px is None or px <= 0:
            results.append({"symbol": sym, "ok": False, "error": "no live price"})
            continue
        # One buy per symbol per batch — the review shows one row per symbol, so a
        # duplicate is a malformed request that would stack rungs past the review.
        if sym in seen_syms:
            results.append({"symbol": sym, "ok": False, "error": "duplicate symbol in this batch — refused"})
            continue
        seen_syms.add(sym)
        if len(by.get(sym, [])) >= cfg.max_rungs:
            results.append({"symbol": sym, "ok": False, "error": "ladder full"})
            continue
        if shares < 1:
            results.append({"symbol": sym, "ok": False, "error": "shares must be >= 1"})
            continue
        eff = round(_f(it.get("limit_price")) if (ot == "LIMIT" and it.get("limit_price")) else px, 2)
        if ot == "LIMIT":
            if eff <= 0:
                results.append({"symbol": sym, "ok": False, "error": "invalid limit price"})
                continue
            if abs(eff / px - 1) > _BULK_PRICE_BAND:   # fat-finger on an edited buy limit (ceiling)
                results.append({"symbol": sym, "ok": False, "error": f"limit {eff} is >25% from the market {round(px, 2)} — adjust"})
                continue
        if shares * eff > _BULK_MAX_NOTIONAL:
            results.append({"symbol": sym, "ok": False, "error": f"~${shares * eff:,.0f} exceeds the ${_BULK_MAX_NOTIONAL:,.0f} bulk cap"})
            continue
        res = await orders_svc.place_order(
            sym, "BUY", shares, ot,
            limit_price=(eff if ot == "LIMIT" else None), account_hash=account_hash, confirm=True,
        )
        results.append({"symbol": sym, "shares": shares, "order_type": ot,
                        "limit_price": (eff if ot == "LIMIT" else None), **res})
    return {"ok": bool(results) and all(r.get("ok") for r in results),
            "placed": sum(1 for r in results if r.get("ok")), "count": len(results), "results": results}
