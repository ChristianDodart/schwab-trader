"""Add/remove watchlist tickers — symbols the user wants to track (and can
first-buy). Adding validates the symbol via a Schwab quote, seeds an initial
price, enriches name/52-wk, and subscribes the live feed dynamically.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import select

from .db import SessionLocal, dialect_insert as pg_insert
from .db.models import Ticker
from .schwab import hub, subscribe
from .schwab.auth import get_client


def _quote_sync(client, symbol: str) -> dict:
    try:
        return (client.get_quotes([symbol]).json() or {}).get(symbol, {})
    except Exception:
        return {}


async def add_ticker(symbol: str) -> dict:
    symbol = (symbol or "").strip().upper()
    if not symbol or len(symbol) > 16 or not symbol.isalnum():
        return {"ok": False, "error": "invalid symbol"}

    client = get_client()
    payload = await asyncio.to_thread(_quote_sync, client, symbol) if client else {}
    if client is not None and not payload:
        return {"ok": False, "error": f"unknown symbol '{symbol}'"}

    ref = payload.get("reference", {}) or {}
    q = payload.get("quote", {}) or {}

    async with SessionLocal() as s:
        await s.execute(
            pg_insert(Ticker)
            .values(symbol=symbol, watch=True, name=ref.get("description"),
                    year_high=q.get("52WeekHigh"), year_low=q.get("52WeekLow"))
            .on_conflict_do_update(index_elements=[Ticker.symbol], set_={"watch": True})
        )
        await s.commit()

    # seed an immediate quote so a price shows before the first stream tick
    last = q.get("lastPrice") or q.get("mark")
    if last:
        hub.publish({
            "symbol": symbol, "last": last,
            "yearHigh": q.get("52WeekHigh"), "yearLow": q.get("52WeekLow"),
            "dayHigh": q.get("highPrice"), "dayLow": q.get("lowPrice"),
            "source": hub.mode, "ts": datetime.now(timezone.utc).isoformat(),
        })

    live = await subscribe(symbol)
    try:  # best-effort auto-tag sector/industry/country (no-op without an FMP key)
        await enrich_ticker(symbol)
    except Exception:
        pass
    return {"ok": True, "symbol": symbol, "live": live}


async def enrich_ticker(symbol: str, force: bool = False) -> dict:
    """Auto-fill a ticker's sector/industry/country from FMP. Fills only EMPTY fields
    unless force=True (so a manual tag isn't clobbered). No-op without an FMP key."""
    from . import fmp
    symbol = (symbol or "").strip().upper()
    async with SessionLocal() as s:
        t = await s.get(Ticker, symbol)
        if t is None:
            return {"ok": False, "symbol": symbol, "error": "unknown ticker"}
        if not force and t.sector and t.country:
            return {"ok": True, "symbol": symbol, "skipped": True}
    p = await fmp.profile(symbol)
    if not p:
        return {"ok": False, "symbol": symbol, "error": "no FMP data (check the key / symbol)"}
    async with SessionLocal() as s:
        t = await s.get(Ticker, symbol)
        if t is None:
            return {"ok": False, "symbol": symbol, "error": "unknown ticker"}
        if p.get("sector") and (force or not t.sector):
            t.sector = p["sector"][:48]
        if p.get("industry") and (force or not t.industry):
            t.industry = p["industry"][:64]
        if p.get("country") and (force or not t.country):
            t.country = p["country"][:8]
        await s.commit()
    return {"ok": True, "symbol": symbol, "sector": p.get("sector"),
            "industry": p.get("industry"), "country": p.get("country")}


async def enrich_all(force: bool = False) -> dict:
    """Auto-tag every known ticker (fills missing classification; force re-fetches all).
    Profiles are day-cached so re-running is cheap on the free FMP quota."""
    from . import credentials
    if not await credentials.get_fmp_key():
        return {"ok": False, "error": "No FMP key set — add one under Settings."}
    async with SessionLocal() as s:
        symbols = (await s.execute(select(Ticker.symbol))).scalars().all()
    updated = 0
    for sym in symbols:
        r = await enrich_ticker(sym, force=force)
        if r.get("ok") and not r.get("skipped"):
            updated += 1
    return {"ok": True, "checked": len(symbols), "updated": updated}


async def set_sector(symbol: str, sector: str | None) -> dict:
    """Tag a ticker's sector (user-maintained — Schwab omits it). Empty clears it.
    Upserts so a sector can be set on a symbol not yet on the watchlist."""
    symbol = (symbol or "").strip().upper()
    if not symbol:
        return {"ok": False, "error": "invalid symbol"}
    sec = (sector or "").strip()[:48] or None
    async with SessionLocal() as s:
        await s.execute(
            pg_insert(Ticker)
            .values(symbol=symbol, sector=sec)
            .on_conflict_do_update(index_elements=[Ticker.symbol], set_={"sector": sec})
        )
        await s.commit()
    return {"ok": True, "symbol": symbol, "sector": sec}


async def remove_ticker(symbol: str) -> dict:
    symbol = (symbol or "").strip().upper()
    async with SessionLocal() as s:
        t = await s.get(Ticker, symbol)
        if t:
            t.watch = False
            await s.commit()
    return {"ok": True, "symbol": symbol}
