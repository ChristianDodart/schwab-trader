"""Market discovery & screening (account-agnostic market-data endpoints):

  market_hours()      -> is the equity market in pre / regular / post / closed?
  movers(index, sort) -> top gainers/losers/most-active for an index or all equities
  vet(symbol)         -> fundamentals for one symbol + pass/fail vs strategy guardrails

All read-only market-data calls. Lightly cached because Schwab throttles bursts.
NOTE: Schwab exposes no balance-sheet items (debt/cash), so true Enterprise Value
is NOT computable here; we screen on market cap (sharesOutstanding * price) instead.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

from .schwab.auth import get_client

_MOVER_INDEXES = {
    "EQUITY_ALL", "$DJI", "$COMPX", "$SPX", "NYSE", "NASDAQ", "OTCBB",
}
_MOVER_SORTS = {"VOLUME", "TRADES", "PERCENT_CHANGE_UP", "PERCENT_CHANGE_DOWN"}

_cache: dict[str, dict] = {}  # key -> {"at": ts, "payload": {...}}
_TTL = {"hours": 600, "movers": 60, "vet": 300}


def _client_or_none():
    try:
        return get_client()
    except Exception:
        return None


def _cached(key: str, ttl: int):
    c = _cache.get(key)
    if c and (time.time() - c["at"]) < ttl:
        return c["payload"]
    return None


def _store(key: str, payload: dict) -> dict:
    _cache[key] = {"at": time.time(), "payload": payload}
    return payload


# ---------------- market hours ----------------

def _parse(iso: str) -> datetime | None:
    try:
        return datetime.fromisoformat(iso)
    except (ValueError, TypeError):
        return None


def _session_now(session_hours: dict, now: datetime) -> tuple[str, str | None]:
    """Return (session, next_change_iso). session ∈ pre|regular|post|closed."""
    label_for = {"preMarket": "pre", "regularMarket": "regular", "postMarket": "post"}
    boundaries: list[datetime] = []
    current = "closed"
    for api_key, label in label_for.items():
        for w in session_hours.get(api_key, []) or []:
            start, end = _parse(w.get("start")), _parse(w.get("end"))
            if start:
                boundaries.append(start)
            if end:
                boundaries.append(end)
            if start and end and start <= now < end:
                current = label
    future = sorted(b for b in boundaries if b > now)
    next_change = future[0].isoformat() if future else None
    return current, next_change


async def market_hours() -> dict:
    cached = _cached("hours", _TTL["hours"])
    client = _client_or_none()

    # We cache the raw API payload, but recompute the session from "now" each call.
    raw = cached["_raw"] if cached else None
    if raw is None:
        if client is None:
            return {"session": "unknown", "is_open": False, "error": "no Schwab token"}

        from schwab.client.base import BaseClient as C

        def fetch():
            return client.get_market_hours([C.MarketHours.Market.EQUITY])

        try:
            resp = await asyncio.to_thread(fetch)
            raw = resp.json() if resp.status_code == 200 else None
        except Exception as e:
            return {"session": "unknown", "is_open": False, "error": repr(e)}
        if raw is None:
            return {"session": "unknown", "is_open": False, "error": "market-hours unavailable"}

    eq = raw.get("equity") or {}
    prod = next(iter(eq.values()), {}) if isinstance(eq, dict) else {}
    now = datetime.now(timezone.utc)
    session, next_change = _session_now(prod.get("sessionHours") or {}, now)
    payload = {
        "session": session,                 # pre | regular | post | closed
        "is_open": session == "regular",
        "extended_open": session in ("pre", "post"),
        "date": prod.get("date"),
        "next_change": next_change,
        "_raw": raw,                         # kept only to drive the cache
    }
    _store("hours", payload)
    return {k: v for k, v in payload.items() if k != "_raw"}


# ---------------- movers ----------------

async def movers(index: str = "EQUITY_ALL", sort: str = "PERCENT_CHANGE_UP") -> dict:
    index = (index or "EQUITY_ALL").upper()
    sort = (sort or "PERCENT_CHANGE_UP").upper()
    if index not in _MOVER_INDEXES:
        index = "EQUITY_ALL"
    if sort not in _MOVER_SORTS:
        sort = "PERCENT_CHANGE_UP"
    key = f"movers:{index}:{sort}"
    cached = _cached(key, _TTL["movers"])
    if cached:
        return cached

    client = _client_or_none()
    if client is None:
        return {"index": index, "sort": sort, "movers": [], "error": "no Schwab token"}

    from schwab.client.base import BaseClient as C

    def fetch():
        return client.get_movers(
            C.Movers.Index(index), sort_order=C.Movers.SortOrder(sort)
        )

    try:
        resp = await asyncio.to_thread(fetch)
    except Exception as e:
        return {"index": index, "sort": sort, "movers": [], "error": repr(e)}
    if resp.status_code != 200:
        return {"index": index, "sort": sort, "movers": [],
                "error": f"HTTP {resp.status_code}"}

    rows = []
    for it in resp.json().get("screeners", []) or []:
        pct = it.get("netPercentChange")
        rows.append({
            "symbol": it.get("symbol"),
            "name": it.get("description"),
            "last": it.get("lastPrice"),
            "change": it.get("netChange"),
            # movers reports netPercentChange as a FRACTION (0.59 = 59%);
            # the quote endpoint reports it already as a percent — normalize here.
            "pct_change": pct * 100 if isinstance(pct, (int, float)) else None,
            "volume": it.get("volume"),
        })
    return _store(key, {"index": index, "sort": sort, "movers": rows})


# ---------------- candidate-pool screen (free: movers + watchlist, FMP-classified) ----------------

async def screen_candidates(account_hash: str = "", index: str = "EQUITY_ALL",
                            sort: str = "PERCENT_CHANGE_UP", pool_limit: int = 40) -> dict:
    """Screen a POOL — today's movers (index/sort) + the watchlist — against the strategy
    universe (cap band, country, excluded sectors, no ETFs). Each name is classified via
    an FMP profile (day-cached). This is NOT a whole-market scan (Schwab has no screener
    and FMP's is paywalled) — it's a free filter over names already in front of you."""
    from . import config_store, credentials, fmp
    from .db import SessionLocal
    from .db.models import Ticker
    from sqlalchemy import select as _select

    if not await credentials.get_fmp_key():
        return {"ok": False, "candidates": [],
                "error": "Add a free FMP key under Settings — it classifies each name (sector/country/cap) so the filter can run."}

    cfg = await config_store.get_strategy(account_hash)
    uni = cfg.universe
    cap_min, cap_max = uni.get("market_cap_min"), uni.get("market_cap_max")
    want_country = str(uni.get("country", "US")).upper()
    excl = [x.lower() for x in (uni.get("exclude") or [])]

    mv = await movers(index, sort)
    mv_rows = {m["symbol"]: m for m in mv.get("movers", []) if m.get("symbol")}
    async with SessionLocal() as s:
        watch = (await s.execute(_select(Ticker.symbol).where(Ticker.watch.is_(True)))).scalars().all()
    symbols = list(dict.fromkeys([*mv_rows.keys(), *watch]))[:pool_limit]

    sem = asyncio.Semaphore(5)  # be polite to FMP; day-cache makes re-runs cheap

    async def _profile(sym: str):
        async with sem:
            return sym, await fmp.profile(sym)

    profiles = dict(await asyncio.gather(*[_profile(s) for s in symbols])) if symbols else {}

    candidates = []
    for sym in symbols:
        p = profiles.get(sym) or {}
        mvr = mv_rows.get(sym, {})
        mc, sector, industry = p.get("market_cap"), p.get("sector"), p.get("industry")
        country, is_etf = p.get("country"), p.get("is_etf")
        blob = " ".join(filter(None, [sector, industry])).lower()
        excl_hit = next((x for x in excl if x in blob), None) if blob else None
        cap_ok = mc is not None and cap_min is not None and cap_max is not None and cap_min <= mc <= cap_max
        country_ok = bool(country) and country.upper() == want_country
        reasons = [
            {"label": "Market cap band", "status": "pass" if cap_ok else ("fail" if mc is not None else "manual"),
             "detail": f"${mc/1e9:.2f}B" if mc else "unknown"},
            {"label": f"Country {want_country}", "status": "pass" if country_ok else ("fail" if country else "manual"),
             "detail": country or "unknown"},
            {"label": "Sector allowed", "status": "fail" if excl_hit else ("pass" if blob else "manual"),
             "detail": (sector or "unknown") + (f" — excluded ({excl_hit})" if excl_hit else "")},
        ]
        if is_etf:
            reasons.append({"label": "Individual stock", "status": "fail", "detail": "ETF, not a company"})
        passes = bool(cap_ok and country_ok and not excl_hit and not is_etf)
        candidates.append({
            "symbol": sym, "name": p.get("name") or mvr.get("name"),
            "sector": sector, "industry": industry, "country": country,
            "market_cap": mc, "beta": p.get("beta"), "is_etf": bool(is_etf),
            "last": mvr.get("last"), "pct_change": mvr.get("pct_change"),
            "in_movers": sym in mv_rows,
            "passes": passes, "reasons": reasons,
        })
    # passing first, then biggest cap (a proxy for "most established")
    candidates.sort(key=lambda c: (not c["passes"], -(c["market_cap"] or 0)))
    return {"ok": True, "index": index, "sort": sort, "count": len(candidates),
            "passing": sum(1 for c in candidates if c["passes"]),
            "pool_note": f"{len(mv_rows)} movers + {len(watch)} watchlist (deduped, capped at {pool_limit})",
            # The active universe rules, so the UI can show WHY names pass/fail as chips.
            "filters": {
                "market_cap_min": cap_min, "market_cap_max": cap_max,
                "country": want_country, "exclude": uni.get("exclude") or [], "no_etfs": True,
            },
            "candidates": candidates}


# ---------------- fundamentals / guardrail vet ----------------

def _num(x):
    return x if isinstance(x, (int, float)) else None


async def _fetch_fundamental(client, symbol: str) -> dict:
    """Rich fundamentals from the Instruments endpoint (margins, ROE, debt/equity, PEG,
    P/B, growth, beta, book value, short interest). Best-effort: any failure returns {}
    so the vet still works off the quote block alone."""
    from schwab.client.base import BaseClient as C

    def fetch():
        return client.get_instruments([symbol], C.Instrument.Projection.FUNDAMENTAL)

    try:
        resp = await asyncio.to_thread(fetch)
        if resp.status_code != 200:
            return {}
        insts = resp.json().get("instruments") or []
        return (insts[0].get("fundamental") or {}) if insts else {}
    except Exception:
        return {}


async def vet(symbol: str, account_hash: str = "") -> dict:
    symbol = (symbol or "").strip().upper()
    if not symbol:
        return {"ok": False, "error": "symbol required"}
    key = f"vet:{symbol}"
    cached = _cached(key, _TTL["vet"])
    base = cached if cached else None

    if base is None:
        client = _client_or_none()
        if client is None:
            return {"ok": False, "symbol": symbol, "error": "no Schwab token"}

        def fetch():
            return client.get_quotes([symbol])

        try:
            resp = await asyncio.to_thread(fetch)
        except Exception as e:
            return {"ok": False, "symbol": symbol, "error": repr(e)}
        data = (resp.json() or {}).get(symbol) if resp.status_code == 200 else None
        if not data:
            return {"ok": False, "symbol": symbol, "error": f"unknown symbol '{symbol}'"}

        q = data.get("quote", {}) or {}
        f = data.get("fundamental", {}) or {}
        ref = data.get("reference", {}) or {}
        last = _num(q.get("lastPrice")) or _num(q.get("mark"))
        # Deeper fundamentals come from the Instruments endpoint (the quote block is lean).
        fund = await _fetch_fundamental(client, symbol)
        shares = _num(fund.get("sharesOutstanding")) or _num(f.get("sharesOutstanding"))
        market_cap = last * shares if (last and shares) else None
        yr_high = _num(q.get("52WeekHigh")) or _num(fund.get("high52"))
        yr_low = _num(q.get("52WeekLow")) or _num(fund.get("low52"))
        # first non-None of several candidate field names (Schwab naming varies a bit)
        pick = lambda *ks: next((_num(fund.get(k)) for k in ks if _num(fund.get(k)) is not None), None)
        base = {
            "ok": True,
            "symbol": symbol,
            "name": ref.get("description"),
            "last": last,
            "market_cap": market_cap,
            "pe_ratio": pick("peRatio") or _num(f.get("peRatio")),
            "eps": pick("epsTTM", "eps") or _num(f.get("eps")),
            "div_yield": pick("dividendYield") or _num(f.get("divYield")),
            "shares_outstanding": shares,
            "avg_volume": pick("avg10DaysVolume") or _num(f.get("avg10DaysVolume")),
            "year_high": yr_high,
            "year_low": yr_low,
            "pct_of_high": (last / yr_high) if (last and yr_high) else None,
            # --- deeper fundamentals (Instruments/fundamental; None-safe, hidden if absent) ---
            "peg_ratio": pick("pegRatio"),
            "pb_ratio": pick("pbRatio"),
            "beta": pick("beta"),
            "roe": pick("returnOnEquity"),
            "roa": pick("returnOnAssets"),
            "net_margin": pick("netProfitMarginTTM", "netProfitMargin"),
            "gross_margin": pick("grossMarginTTM", "grossMargin"),
            "operating_margin": pick("operatingMarginTTM", "operatingMargin"),
            "debt_to_equity": pick("totalDebtToEquity", "ltDebtToEquity"),
            "current_ratio": pick("currentRatio"),
            "quick_ratio": pick("quickRatio"),
            "rev_growth": pick("revChangeTTM", "revChangeYear"),
            "eps_growth": pick("epsChangePercentTTM", "epsChangeYear"),
            "book_value_ps": pick("bookValuePerShare"),
            "short_pct_float": pick("shortIntToFloat"),
        }
        _store(key, base)

    # Guardrail checks use the SELECTED account's strategy universe.
    from . import config_store
    cfg = await config_store.get_strategy(account_hash)
    uni = cfg.universe
    cap_min, cap_max = uni.get("market_cap_min"), uni.get("market_cap_max")
    mc = base.get("market_cap")
    checks = []
    if mc is not None and cap_min is not None and cap_max is not None:
        ok = cap_min <= mc <= cap_max
        checks.append({
            "label": f"Market cap in ${cap_min/1e9:g}B–${cap_max/1e9:g}B band",
            "status": "pass" if ok else "fail",
            "detail": f"${mc/1e9:.2f}B",
        })
    else:
        checks.append({"label": "Market cap band", "status": "manual",
                       "detail": "market cap unavailable"})
    # Classification (sector/industry/country) isn't in Schwab data. Prefer a live FMP
    # profile (works for ANY symbol), falling back to the stored tag (Ticker.sector).
    from . import fmp
    from .db import SessionLocal
    from .db.models import Ticker
    prof = await fmp.profile(symbol)
    async with SessionLocal() as s:
        trow = await s.get(Ticker, symbol)
    sector = (prof.get("sector") if prof else None) or (trow.sector if trow else None)
    industry = (prof.get("industry") if prof else None) or (trow.industry if trow else None)
    country = (prof.get("country") if prof else None) or (trow.country if trow else None)
    base = {**base, "sector": sector, "industry": industry, "country": country}

    want_country = str(uni.get("country", "US")).upper()
    if country:
        checks.append({"label": f"Country = {want_country}",
                       "status": "pass" if country.upper() == want_country else "fail",
                       "detail": country})
    else:
        checks.append({"label": f"Country = {want_country}", "status": "manual",
                       "detail": "unknown — add an FMP key to auto-classify"})
    excl = uni.get("exclude") or []
    if excl:
        blob = " ".join(filter(None, [sector, industry]))
        if blob:
            hit = next((x for x in excl if x.lower() in blob.lower()), None)
            checks.append({
                "label": f"Not in: {', '.join(excl)}",
                "status": "fail" if hit else "pass",
                "detail": (sector or industry) + (f" — matches excluded “{hit}”" if hit else ""),
            })
        else:
            checks.append({"label": f"Not in: {', '.join(excl)}", "status": "manual",
                           "detail": "no sector — add an FMP key or tag it on the dashboard"})

    # Profitability (LAW: prefer companies motivated/able to grow value) — pass when
    # earnings or net margin are positive; only shown when we have the data.
    prof = base.get("net_margin")
    eps = base.get("eps")
    if prof is not None or eps is not None:
        is_prof = (prof is not None and prof > 0) or (eps is not None and eps > 0)
        checks.append({
            "label": "Profitable (positive earnings)",
            "status": "pass" if is_prof else "fail",
            "detail": (f"net margin {prof:.1f}%" if prof is not None else f"EPS {eps:.2f}"),
        })
    # Dividend policy (RULE 7: dividends usually stunt growth — you favor non-payers).
    dy = base.get("div_yield")
    if dy is not None:
        checks.append({
            "label": "Non-dividend growth name",
            "status": "pass" if dy <= 0 else "manual",
            "detail": "no dividend" if dy <= 0 else f"pays {dy:.2f}% — you generally avoid dividend payers",
        })

    return {**base, "checks": checks, "ev_note": "Deep fundamentals are Schwab’s (margins, "
            "ROE, debt/equity, growth). True Enterprise Value needs absolute debt/cash, which "
            "Schwab doesn’t expose — market cap + debt/equity are the proxies here."}
