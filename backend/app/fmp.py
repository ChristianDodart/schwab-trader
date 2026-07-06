"""Financial Modeling Prep — optional, per-install (key entered in Settings).

Schwab exposes no sector/industry/country classification, so we use FMP's company
PROFILE endpoint to auto-tag tickers. That makes the Screener's sector-exclusion and
country guardrails work automatically instead of by hand.

NOTE: FMP's free tier serves `profile` but NOT the market-wide `company-screener`
(paywalled). So this fills classification/enrichment only — a true whole-market screen
would need a paid plan. Profiles are cached for the day to respect the free quota.
"""
from __future__ import annotations

import time

import httpx

from . import credentials

_BASE = "https://financialmodelingprep.com/stable"
_cache: dict[str, tuple[float, dict | None]] = {}
_TTL_S = 86400.0  # a company's sector/country doesn't change intraday


def _n(x):
    return x if isinstance(x, (int, float)) else None


async def profile(symbol: str) -> dict | None:
    """Company profile for one symbol → {sector, industry, country, market_cap, beta,
    is_etf, name} — or None if no key / not found / API error. Cached for the day."""
    symbol = (symbol or "").strip().upper()
    if not symbol:
        return None
    hit = _cache.get(symbol)
    if hit and (time.monotonic() - hit[0]) < _TTL_S:
        return hit[1]
    key = await credentials.get_fmp_key()
    if not key:
        return None
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(f"{_BASE}/profile", params={"symbol": symbol, "apikey": key})
        if r.status_code != 200:
            return None
        data = r.json()
        row = data[0] if isinstance(data, list) and data else None
    except Exception:
        return None
    if not row:
        _cache[symbol] = (time.monotonic(), None)
        return None
    out = {
        "sector": row.get("sector") or None,
        "industry": row.get("industry") or None,
        "country": row.get("country") or None,
        "market_cap": _n(row.get("marketCap")),
        "beta": _n(row.get("beta")),
        "is_etf": bool(row.get("isEtf")),
        "name": row.get("companyName") or None,
    }
    _cache[symbol] = (time.monotonic(), out)
    return out
