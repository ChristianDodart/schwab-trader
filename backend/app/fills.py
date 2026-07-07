"""Fetch executed fills for one account from the Schwab REST API and map them to
`reconstruct.Fill`s. Orders (status=FILLED) are the authoritative source — the
true per-share execution price lives in orderActivityCollection[].executionLegs,
NOT the top-level (limit/working) `price`.

Schwab caps each orders query at 60 days, so to reconstruct a complete LIFO
history (a lot may be held for months) we PAGE backward in 60-day windows up to
`_MAX_LOOKBACK_DAYS`. Reconstruction needs the full buy history — a truncated
window would erase old held lots and fabricate "oversold" sells.

Account-scoped: always takes an explicit account hash (never "selected"). Read-only.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from .reconstruct import Fill
from .schwab.auth import get_client

log = logging.getLogger(__name__)

_WINDOW_DAYS = 60          # Schwab's hard per-query cap
_DEFAULT_LOOKBACK_DAYS = 366   # default history horizon (override via the 'fills_lookback_days' setting)
_MAX_LOOKBACK_DAYS = 1830      # hard cap (~5y). Positions-reconciliation backfills anything older.


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


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


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


async def fetch_fills(account_hash: str, lookback_days: int | None = None):
    """All executed fills for the account over the lookback, paged in <=60-day windows.

    Returns:
      list[Fill]  — the fills (possibly EMPTY [] = the API succeeded and the account
                    genuinely has no fills in the window);
      None        — could NOT fetch (no token / API error / any window failed). The
                    caller MUST distinguish: [] may route to a positions-mirror, but
                    None means 'unknown' and must never trigger a wipe or a re-route.
    """
    if not account_hash:
        return None
    client = get_client()
    if client is None:
        return None
    if lookback_days is None:
        lookback_days = await _lookback_days()
    lookback_days = max(1, min(int(lookback_days), _MAX_LOOKBACK_DAYS))

    def go():
        by_id: dict = {}  # dedup orders that straddle a window boundary, by orderId
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
        return list(by_id.values())

    try:
        orders = await asyncio.to_thread(go)
    except Exception as e:
        log.warning(f"fetch failed for {account_hash[-4:]}: {e!r}")
        return None  # could not fetch — caller must NOT treat this as 'no fills'

    fills: list[Fill] = []
    for o in orders:
        fills.extend(_fills_from_order(o))
    return fills
