"""Trade-journal analytics — win-rate / profit-factor / hold math against a fixture.

Exercises build_trades end-to-end on a throwaway account in the real (SQLite) DB,
so the SQL query + Python aggregation are both covered.
"""
import asyncio
from datetime import date

from sqlalchemy import delete

from app.db import SessionLocal, init_db
from app.db.models import CompletedTrade
from app.ledger import build_trades

ACCT = "TEST_TRADE_STATS"


def _seed():
    async def run():
        await init_db()
        async with SessionLocal() as s:
            await s.execute(delete(CompletedTrade).where(CompletedTrade.account_hash == ACCT))
            # 3 wins (+100,+50,+30), 2 losses (-40,-10); one day trade; varied holds
            rows = [
                dict(symbol="AAA", shares=10, buy_price=10, sell_price=20, cost=100, profit=100,
                     opened_at=date(2026, 6, 1), completed_at=date(2026, 6, 5)),   # +100, 4d
                dict(symbol="AAA", shares=5, buy_price=10, sell_price=20, cost=50, profit=50,
                     opened_at=date(2026, 6, 10), completed_at=date(2026, 6, 10)),  # +50, day trade
                dict(symbol="BBB", shares=3, buy_price=10, sell_price=20, cost=30, profit=30,
                     opened_at=date(2026, 6, 2), completed_at=date(2026, 6, 4)),   # +30, 2d
                dict(symbol="BBB", shares=4, buy_price=20, sell_price=10, cost=80, profit=-40,
                     opened_at=date(2026, 6, 3), completed_at=date(2026, 6, 9)),   # -40, 6d
                dict(symbol="CCC", shares=1, buy_price=20, sell_price=10, cost=20, profit=-10,
                     opened_at=None, completed_at=date(2026, 6, 8)),               # -10, hold unknown
            ]
            for r in rows:
                s.add(CompletedTrade(account_hash=ACCT, **r))
            await s.commit()
    asyncio.run(run())


def _cleanup():
    async def run():
        async with SessionLocal() as s:
            await s.execute(delete(CompletedTrade).where(CompletedTrade.account_hash == ACCT))
            await s.commit()
    asyncio.run(run())


def test_trade_summary_math():
    _seed()
    try:
        d = asyncio.run(build_trades(ACCT))
    finally:
        _cleanup()
    s = d["summary"]
    assert s["count"] == 5
    assert s["wins"] == 3 and s["losses"] == 2
    assert s["win_rate"] == round(3 / 5, 4)
    assert s["total_profit"] == 130.0            # 100+50+30-40-10
    assert s["avg_win"] == round(180 / 3, 2)     # 60.0
    assert s["avg_loss"] == round(-50 / 2, 2)    # -25.0
    assert s["profit_factor"] == round(180 / 50, 2)  # 3.6
    assert s["avg_hold_days"] == round((4 + 0 + 2 + 6) / 4, 1)  # unknown-hold excluded → 3.0
    assert s["day_trade_count"] == 1
    assert s["best"] == {"symbol": "AAA", "profit": 100.0}
    assert s["worst"] == {"symbol": "BBB", "profit": -40.0}
    # by_symbol sorted by total_profit desc: AAA(150) > BBB(-10) > CCC(-10) — AAA first
    assert d["by_symbol"][0]["symbol"] == "AAA"
    assert d["by_symbol"][0]["total_profit"] == 150.0
    assert d["by_symbol"][0]["win_rate"] == 1.0
    # newest-first ordering
    assert d["trades"][0]["completed_at"] >= d["trades"][-1]["completed_at"]


def test_profit_factor_none_without_losses():
    async def run():
        await init_db()
        async with SessionLocal() as s:
            await s.execute(delete(CompletedTrade).where(CompletedTrade.account_hash == ACCT))
            s.add(CompletedTrade(account_hash=ACCT, symbol="ZZZ", shares=1, buy_price=1,
                                 sell_price=2, cost=1, profit=1.0,
                                 opened_at=date(2026, 6, 1), completed_at=date(2026, 6, 1)))
            await s.commit()
        return await build_trades(ACCT)
    d = asyncio.run(run())
    _cleanup()
    assert d["summary"]["profit_factor"] is None  # no losses
    assert d["summary"]["win_rate"] == 1.0
