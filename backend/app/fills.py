"""Fetch executed fills for one account from the Schwab REST API and map them to
`reconstruct.Fill`s.

SOURCE: the TRANSACTIONS endpoint (type=TRADE), which Schwab confirms is the
authoritative record of executions — the orders endpoint includes canceled/rejected
orders AND misses fills from GTC orders entered before the query window. Validated on
a live account (2026-07): transactions reproduced 100% of the orders-derived fills
byte-for-byte AND recovered 2 fills the orders endpoint had dropped. The orders path
(`_fetch_from_orders`) is kept as a resilience fallback.

Each TRADE record's security leg (transferItems entry whose instrument.assetType is
not CURRENCY / not a fee leg) carries: `amount` (shares, SIGNED), `price`, and
`positionEffect` (OPENING/CLOSING). Side = (+amount & OPENING)→BUY,
(-amount & CLOSING)→SELL; short opens/covers are skipped (long-only ladder), matching
the orders path. The derived `fill_key` (order_id + execution time + price + shares +
side) is IDENTICAL to the orders-derived one, so switching source is idempotent — a
resync re-inserts nothing and simply adds any fills orders had been missing.

Transactions cap each query at 1 YEAR, so we PAGE backward in <=1-year windows to the
lookback horizon (or until a window is empty = the account's tOS-enablement ceiling).

Account-scoped: always takes an explicit account hash (never "selected"). Read-only.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from .reconstruct import Fill
from .schwab.auth import get_client
from .util import _f

log = logging.getLogger(__name__)

_WINDOW_DAYS = 60          # orders endpoint per-query cap (fallback path)
_TXN_WINDOW_DAYS = 365     # transactions endpoint per-query cap (Schwab 400s beyond 1 year)
_DEFAULT_LOOKBACK_DAYS = 1830  # default horizon (~5y). Paging stops early at the account's
                               # tOS ceiling (first empty window), so this is just an upper bound.
_MAX_LOOKBACK_DAYS = 3660      # hard cap (~10y). Positions-reconciliation backfills anything older.


async def _lookback_days() -> int:
    """Configurable fill-history horizon (app_setting 'fills_lookback_days'), clamped."""
    from .accounts import get_setting
    try:
        v = int(await get_setting("fills_lookback_days") or _DEFAULT_LOOKBACK_DAYS)
    except (TypeError, ValueError):
        v = _DEFAULT_LOOKBACK_DAYS
    return max(1, min(v, _MAX_LOOKBACK_DAYS))

# The ladder is a SHARE-based long strategy, so accept equities, ETFs, and funds
# (Schwab classifies e.g. some ETFs/ETNs as COLLECTIVE_INVESTMENT). Only skip
# instruments that are NOT share-based (options/futures/forex) — those can't be
# reconstructed as share lots. Never skip SILENTLY; a skip is logged.
_SKIP_ASSET_TYPES = {"OPTION", "FUTURE", "FOREX"}


def _parse_dt(s) -> datetime | None:
    """Parse Schwab ISO8601 to a tz-AWARE UTC datetime. Always aware so
    reconstruct's chronological sort can't crash mixing naive/aware values."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _normalize_side(instruction: str) -> str | None:
    """Long-only ladder: only plain BUY/SELL count. SELL_SHORT / BUY_TO_COVER
    open/close a SHORT — folding them into BUY/SELL would corrupt LIFO, so we
    skip them (returns None). A real short would then surface as an `oversold`
    mismatch, which rebuild refuses to commit on."""
    i = (instruction or "").upper()
    if i == "BUY":
        return "BUY"
    if i == "SELL":
        return "SELL"
    return None


def _leg_info(leg: dict) -> tuple[str | None, str | None, str]:
    instr = leg.get("instrument") or {}
    return instr.get("symbol"), _normalize_side(leg.get("instruction")), instr.get("assetType")


def _fills_from_order(o: dict) -> list[Fill]:
    """One Fill per execution leg (preserves partial fills), resolved to the
    correct order leg by legId for multi-leg orders. Equity, long-only."""
    order_legs = o.get("orderLegCollection") or []
    by_leg_id = {lg.get("legId"): lg for lg in order_legs if lg.get("legId") is not None}
    single = order_legs[0] if len(order_legs) == 1 else None
    otype = (o.get("orderType") or "").upper()
    oid = str(o.get("orderId") or "")

    def resolve(ex_leg):
        lg = by_leg_id.get(ex_leg.get("legId")) or single
        return _leg_info(lg) if lg else (None, None, None)

    out: list[Fill] = []
    for act in o.get("orderActivityCollection") or []:
        if act.get("activityType") != "EXECUTION":
            continue
        for ex in act.get("executionLegs") or []:
            symbol, side, asset = resolve(ex)
            if not symbol or side is None:
                continue  # unresolved leg / short instruction
            if asset in _SKIP_ASSET_TYPES:
                log.info(f"skipping non-share fill {symbol} ({asset}) — not reconstructable as a share lot")
                continue
            shares, price, at = _f(ex.get("quantity")), _f(ex.get("price")), _parse_dt(ex.get("time"))
            if shares > 0 and price > 0 and at is not None:
                out.append(Fill(symbol=symbol, side=side, shares=shares, price=price, at=at, order_type=otype, order_id=oid))

    if not out and single is not None:  # fallback: no execution detail
        symbol, side, asset = _leg_info(single)
        if symbol and side is not None and asset not in _SKIP_ASSET_TYPES:
            shares = _f(o.get("filledQuantity"))
            # prefer a realized average price; only fall back to the limit price
            price = _f(o.get("avgFillPrice")) or _f(o.get("averagePrice")) or _f(o.get("price"))
            at = _parse_dt(o.get("closeTime") or o.get("enteredTime"))
            if shares > 0 and price > 0 and at is not None:
                if not (o.get("avgFillPrice") or o.get("averagePrice")):
                    log.warning(f"{symbol} order {o.get('orderId')}: no execution detail; "
                                f"using order price {price} as an ESTIMATE")
                out.append(Fill(symbol=symbol, side=side, shares=shares, price=price, at=at, order_type=otype, order_id=oid))
    return out


def _txn_security_leg(t: dict) -> dict | None:
    """The traded-security leg of a TRADE transaction: the transferItems entry whose
    instrument is a real security (not CURRENCY) and isn't a fee leg (feeType)."""
    for it in t.get("transferItems") or []:
        inst = it.get("instrument") or {}
        if inst.get("assetType") not in (None, "CURRENCY") and not it.get("feeType"):
            return it
    return None


def fills_from_transactions(txns: list[dict]) -> list[Fill]:
    """Map TRADE transactions → long-only Fills. Pure.

    Side from (amount sign, positionEffect): +/OPENING = BUY, -/CLOSING = SELL. A short
    open (-/OPENING) or cover (+/CLOSING) is skipped (long-only ladder) — a real short
    then surfaces as an `oversold` mismatch, which rebuild refuses to commit on, exactly
    as with the orders path. `at` = the execution `time` (so the derived fill_key matches
    the orders-derived key). Non-share instruments (option/future/forex) are skipped."""
    out: list[Fill] = []
    for t in txns or []:
        if (t.get("type") or "").upper() != "TRADE":
            continue
        leg = _txn_security_leg(t)
        if not leg:
            continue
        inst = leg.get("instrument") or {}
        symbol, asset = inst.get("symbol"), inst.get("assetType")
        if not symbol or asset in _SKIP_ASSET_TYPES:
            if asset in _SKIP_ASSET_TYPES:
                log.info(f"skipping non-share fill {symbol} ({asset}) — not reconstructable as a share lot")
            continue
        amt = _f(leg.get("amount")); pe = (leg.get("positionEffect") or "").upper()
        if amt > 0 and pe == "OPENING":
            side = "BUY"
        elif amt < 0 and pe == "CLOSING":
            side = "SELL"
        else:
            continue  # short open / cover — long-only, skip (surfaces as oversold if real)
        shares, price = abs(amt), _f(leg.get("price"))
        at = _parse_dt(t.get("time"))
        if shares > 0 and price > 0 and at is not None:
            out.append(Fill(symbol=symbol, side=side, shares=shares, price=price,
                            at=at, order_type="TRADE", order_id=str(t.get("orderId") or "")))
    return out


def _fetch_from_transactions(client, account_hash: str, lookback_days: int) -> list[Fill]:
    """Page the transactions endpoint (type=TRADE) in <=1-year windows back to the
    horizon, stopping early once a window is empty (the account's tOS-enablement
    ceiling — no point requesting older). Raises on any HTTP error."""
    end = datetime.now(timezone.utc)
    horizon = end - timedelta(days=lookback_days)
    win_end = end
    txns: list[dict] = []
    while win_end > horizon:
        win_start = max(win_end - timedelta(days=_TXN_WINDOW_DAYS), horizon)
        resp = client.get_transactions(
            account_hash, start_date=win_start, end_date=win_end,
            transaction_types=client.Transactions.TransactionType.TRADE,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"transactions HTTP {resp.status_code} for {win_start:%Y-%m-%d}..{win_end:%Y-%m-%d}")
        data = resp.json()
        window = data if isinstance(data, list) else []
        txns.extend(window)
        if not window:
            break  # reached the account's API ceiling — older windows are empty too
        win_end = win_start
    return fills_from_transactions(txns)


def _fetch_from_orders(client, account_hash: str, lookback_days: int) -> list[Fill]:
    """Fallback: the legacy orders-endpoint path (status=FILLED, <=60-day windows)."""
    by_id: dict = {}
    end = datetime.now(timezone.utc)
    horizon = end - timedelta(days=lookback_days)
    win_end = end
    while win_end > horizon:
        win_start = max(win_end - timedelta(days=_WINDOW_DAYS), horizon)
        resp = client.get_orders_for_account(
            account_hash, from_entered_datetime=win_start,
            to_entered_datetime=win_end, status=client.Order.Status.FILLED,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"orders HTTP {resp.status_code} for {win_start:%Y-%m-%d}..{win_end:%Y-%m-%d}")
        data = resp.json()
        for o in data if isinstance(data, list) else []:
            if (o or {}).get("status") == "FILLED" and o.get("orderId") is not None:
                by_id[o["orderId"]] = o
        win_end = win_start
    fills: list[Fill] = []
    for o in by_id.values():
        fills.extend(_fills_from_order(o))
    return fills


async def fetch_fills(account_hash: str, lookback_days: int | None = None):
    """All executed fills for the account, from the TRANSACTIONS endpoint (authoritative),
    falling back to ORDERS if transactions can't be fetched.

    Returns:
      list[Fill]  — the fills (possibly EMPTY [] = the API succeeded and the account
                    genuinely has no fills in the window);
      None        — could NOT fetch from EITHER source. The caller MUST distinguish:
                    [] may route to a positions-mirror, but None means 'unknown' and
                    must never trigger a wipe or a re-route.
    """
    if not account_hash:
        return None
    client = get_client()
    if client is None:
        return None
    if lookback_days is None:
        lookback_days = await _lookback_days()
    lookback_days = max(1, min(int(lookback_days), _MAX_LOOKBACK_DAYS))

    try:
        return await asyncio.to_thread(_fetch_from_transactions, client, account_hash, lookback_days)
    except Exception as e:
        log.warning(f"transactions fetch failed for {account_hash[-4:]} ({e!r}) — trying orders fallback")
    try:
        return await asyncio.to_thread(_fetch_from_orders, client, account_hash, lookback_days)
    except Exception as e:
        log.warning(f"orders fetch also failed for {account_hash[-4:]}: {e!r}")
        return None  # could not fetch from either — caller must NOT treat as 'no fills'
