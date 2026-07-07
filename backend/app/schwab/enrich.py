"""Best-effort enrichment of ticker names + 52-week range from Schwab quotes.

Runs once on startup (if a token exists). Non-fatal: the dashboard works without
it (it falls back to streamer 52wk data and shows symbols without names).
"""
from __future__ import annotations

import asyncio
import logging

log = logging.getLogger(__name__)


async def enrich_tickers(client) -> None:
    from sqlalchemy import select

    from ..db import SessionLocal
    from ..db.models import Ticker

    async with SessionLocal() as s:
        symbols = [
            t.symbol for t in (await s.execute(select(Ticker))).scalars().all()
        ]
        if not symbols:
            return
        try:
            resp = await asyncio.to_thread(client.get_quotes, symbols)
            data = resp.json()
        except Exception as e:
            log.warning(f"quote fetch failed: {e!r}")
            return

        for sym, payload in data.items():
            t = await s.get(Ticker, sym)
            if not t:
                continue
            ref = payload.get("reference", {}) or {}
            q = payload.get("quote", {}) or {}
            t.name = ref.get("description") or t.name
            t.year_high = q.get("52WeekHigh") or t.year_high
            t.year_low = q.get("52WeekLow") or t.year_low
        await s.commit()
    log.info(f"updated {len(symbols)} tickers")
