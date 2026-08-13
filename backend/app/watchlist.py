"""Add/remove watchlist tickers — symbols the user wants to track (and can
first-buy). Adding validates the symbol via a Schwab quote, seeds an initial
price, enriches name/52-wk, and subscribes the live feed dynamically.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

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
    return {"ok": True, "symbol": symbol, "live": live}


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
