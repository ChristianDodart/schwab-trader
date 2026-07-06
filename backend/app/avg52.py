"""52-week price statistics — the MEAN and MEDIAN of the daily closes over the
past year.

Both answer "where does the stock spend most of its time" (a ~252-day picture);
each trading day's close counts once. The mean (≈ the 200-day MA) is pulled by
big outlier days; the median is the middle close, robust to spikes — for a
choppy/spiky name the median is often the truer "typical price". We compute both
from the SAME fetched year of candles (one request serves both columns).

Built on `market_data.price_history(symbol, "1Y")` (the SAME in-server Schwab
client the charts use — never a side script, which would rotate the OAuth token
and kill the streamer). The stats barely move day to day, so they're cached
per-symbol for the calendar day and refreshed in the BACKGROUND: the dashboard
loop (~1x/sec) reads the last-known values instantly and never blocks on an HTTP
call. Purely reference columns — no order/strategy logic depends on them.
"""
from __future__ import annotations

import asyncio
import time
from datetime import date, datetime

from . import market_data
from .ledger import MARKET_TZ

# A brand-new listing (e.g. a days-old ETF) has too little history for a
# meaningful "52-week" figure — report nothing rather than a 3-day mean/median
# masquerading as a year. Below this many daily closes, the values are None.
_MIN_DAYS = 20

# symbol -> {"mean": float | None, "median": float | None, "days": int, "asof": date}
_cache: dict[str, dict] = {}
_inflight: set[str] = set()
# Per-symbol "don't retry before" wall-clock (monotonic). A failed/throttled fetch
# sets this so we DON'T re-request it every dashboard tick (~1/sec). Cold-start
# fetches are also paced through a small semaphore so warming N symbols doesn't
# burst N simultaneous HTTP calls at Schwab.
_next_try: dict[str, float] = {}
_FAIL_BACKOFF_S = 300.0
_sem = asyncio.Semaphore(2)


def _today() -> date:
    return datetime.now(MARKET_TZ).date()


def reset_backoff() -> None:
    """Clear all per-symbol failure backoffs so the next dashboard tick re-fetches
    immediately. Called on re-auth/profile switch: the old token's failures (which
    parked every symbol for 5 min) shouldn't stall the fresh token's recovery."""
    _next_try.clear()


def _ensure(symbol: str) -> dict | None:
    """Return the cached stats for `symbol`, scheduling a non-blocking background
    refresh when missing or stale (not computed yet today). Guarded by `_inflight`
    so concurrent reads (mean + median in one row build) schedule at most one
    fetch/symbol/day. Safe to call from the hot dashboard path."""
    entry = _cache.get(symbol)
    fresh = entry and entry["asof"] == _today()
    if not fresh and symbol not in _inflight and time.monotonic() >= _next_try.get(symbol, 0.0):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None:
            _inflight.add(symbol)
            loop.create_task(_refresh(symbol))
    return entry


def get(symbol: str) -> float | None:
    """52-week MEAN close (None until warmed / too new). Non-blocking."""
    entry = _ensure(symbol.upper())
    return entry["mean"] if entry else None


def median(symbol: str) -> float | None:
    """52-week MEDIAN close (None until warmed / too new). Non-blocking."""
    entry = _ensure(symbol.upper())
    return entry["median"] if entry else None


def _median(xs: list[float]) -> float:
    s = sorted(xs)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


async def _refresh(symbol: str) -> None:
    try:
        async with _sem:  # pace concurrent cold-start fetches
            hist = await market_data.price_history(symbol, "1Y")
        closes = [
            float(c["close"])
            for c in hist.get("candles", [])
            if c.get("close") is not None
        ]
        # No candles at all = throttle/error/no-token: leave the last-known values in
        # place and BACK OFF (don't re-request every tick); retry after the window.
        if not closes:
            _next_try[symbol] = time.monotonic() + _FAIL_BACKOFF_S
            return
        _next_try.pop(symbol, None)
        days = len(closes)
        enough = days >= _MIN_DAYS
        _cache[symbol] = {
            "mean": round(sum(closes) / days, 4) if enough else None,
            "median": round(_median(closes), 4) if enough else None,
            "days": days,
            "asof": _today(),
        }
    finally:
        _inflight.discard(symbol)
