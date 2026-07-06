"""Market-data (price history) via the Schwab Market Data API.

Account-agnostic — works regardless of which (or whether an) account is linked,
so it's reliable foundation work. Powers the price charts.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone

from .schwab.auth import get_client

# range key -> (fetcher method name, lookback timedelta or None for the API default)
_RANGES = {
    "1D": ("get_price_history_every_five_minutes", timedelta(days=1)),
    "5D": ("get_price_history_every_thirty_minutes", timedelta(days=5)),
    "1M": ("get_price_history_every_day", timedelta(days=31)),
    "6M": ("get_price_history_every_day", timedelta(days=183)),
    "1Y": ("get_price_history_every_day", timedelta(days=365)),
    "5Y": ("get_price_history_every_day", timedelta(days=1830)),  # benchmark history
}

# The Schwab market-data API throttles bursts (returns HTTP 200 with empty
# candles, not 429). Cache results so normal use makes few calls and a transient
# throttle serves the last good data instead of a blank chart.
_TTL = {"1D": 60, "5D": 60, "1M": 600, "6M": 600, "1Y": 600, "5Y": 3600}
_cache: dict[tuple[str, str], dict] = {}  # (symbol, range) -> {"at": ts, "payload": {...}}


async def price_history(symbol: str, range_key: str = "6M") -> dict:
    symbol = symbol.upper()
    if range_key not in _RANGES:
        range_key = "6M"
    key = (symbol, range_key)

    # Fresh cache hit -> serve without hitting Schwab.
    cached = _cache.get(key)
    if cached and (time.time() - cached["at"]) < _TTL[range_key]:
        return cached["payload"]

    method_name, lookback = _RANGES[range_key]
    client = get_client()
    if client is None:
        return {"symbol": symbol, "range": range_key, "candles": [], "error": "no Schwab token"}

    def fetch():
        method = getattr(client, method_name)
        kwargs = {}
        if lookback is not None:
            kwargs["start_datetime"] = datetime.now(timezone.utc) - lookback
            kwargs["end_datetime"] = datetime.now(timezone.utc)
        intraday = range_key in ("1D", "5D")
        if intraday:
            kwargs["need_extended_hours_data"] = True  # include pre/post-market candles
        return method(symbol, **kwargs)

    def _stale_or(empty_payload: dict) -> dict:
        """On a throttle/empty/error, serve the last good data (flagged stale)."""
        if cached:
            return {**cached["payload"], "stale": True}
        return empty_payload

    try:
        resp = await asyncio.to_thread(fetch)
    except Exception as e:
        return _stale_or({"symbol": symbol, "range": range_key, "candles": [], "error": repr(e)})

    if resp.status_code != 200:
        return _stale_or({"symbol": symbol, "range": range_key, "candles": [],
                          "error": f"HTTP {resp.status_code}: {resp.text[:200]}"})

    data = resp.json()
    candles = [
        {
            "time": int(c["datetime"] // 1000),  # ms -> unix seconds (lightweight-charts)
            "open": c["open"],
            "high": c["high"],
            "low": c["low"],
            "close": c["close"],
            "volume": c.get("volume"),
        }
        for c in data.get("candles", [])
    ]
    if not candles:
        # HTTP 200 + empty = Schwab throttling. Don't cache it; serve last good.
        return _stale_or({"symbol": symbol, "range": range_key, "candles": [],
                          "error": "rate-limited; showing last available"})

    payload = {"symbol": symbol, "range": range_key, "candles": candles}
    _cache[key] = {"at": time.time(), "payload": payload}
    return payload
