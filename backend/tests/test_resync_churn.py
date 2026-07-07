"""Anti-churn on API resync (W27-5): don't insert API fills into a (day, symbol,
side) group that CSV currently owns — heal would evict them, the eviction deletes
their fill_keys, and the next resync would re-insert them forever."""
import asyncio
from datetime import date, datetime, timezone

from sqlalchemy import delete, func, select

from app.db import SessionLocal, init_db
from app.db.models import FillRecord
from app.fill_store import upsert_api_fills
from app.reconstruct import Fill

ACCT = "TEST_CHURN"
DAY = date(2026, 6, 2)
AT = datetime(2026, 6, 2, 15, 30, tzinfo=timezone.utc)


def _run(coro):
    return asyncio.run(coro)


def _seed_csv(shares_each: list[float], side="SELL", symbol="GVH"):
    async def run():
        await init_db()
        async with SessionLocal() as s:
            await s.execute(delete(FillRecord).where(FillRecord.account_hash == ACCT))
            for i, sh in enumerate(shares_each):
                s.add(FillRecord(account_hash=ACCT, source="csv", symbol=symbol, side=side,
                                 shares=sh, price=10.0, at=datetime(2026, 6, 2, 0, 0, i),
                                 trade_date=DAY, fill_key=f"csv|{ACCT}|{symbol}|{side}|{i}"))
            await s.commit()
    _run(run())


def _counts():
    async def run():
        async with SessionLocal() as s:
            rows = (await s.execute(
                select(FillRecord.source, func.count()).where(FillRecord.account_hash == ACCT)
                .group_by(FillRecord.source))).all()
            return dict(rows)
    return _run(run())


def _cleanup():
    async def run():
        async with SessionLocal() as s:
            await s.execute(delete(FillRecord).where(FillRecord.account_hash == ACCT))
            await s.commit()
    _run(run())


def _api_fill(shares, order_id="o1", side="SELL", symbol="GVH"):
    return Fill(symbol, side, shares, 10.05, AT, order_type="LIMIT", order_id=order_id)


def test_csv_owned_group_skips_partial_api_fill():
    # CSV knows the full 1,000-share sell; the API window only sees 400 of it
    # (the GVH boundary-day case). Inserting would just churn — skip.
    _seed_csv([1000.0])
    try:
        r = _run(upsert_api_fills(ACCT, [_api_fill(400.0)]))
        assert r["added"] == 0 and r["csv_owned"] == 1
        assert _counts() == {"csv": 1}
    finally:
        _cleanup()


def test_api_meeting_csv_total_inserts_and_lets_heal_flip():
    # API now accounts for the whole group (tie) → tie goes to API for leg
    # fidelity, so the fills must be inserted (heal evicts the CSV afterwards).
    _seed_csv([600.0, 400.0])
    try:
        r = _run(upsert_api_fills(ACCT, [_api_fill(600.0, "o1"), _api_fill(400.0, "o2")]))
        assert r["added"] == 2 and r["csv_owned"] == 0
        assert _counts() == {"csv": 2, "api": 2}
    finally:
        _cleanup()


def test_unrelated_group_untouched_by_skip():
    # CSV owns the SELL group; a BUY the same day is a different group and inserts.
    _seed_csv([1000.0], side="SELL")
    try:
        r = _run(upsert_api_fills(ACCT, [_api_fill(400.0, side="SELL"),
                                         _api_fill(50.0, "o2", side="BUY")]))
        assert r["added"] == 1 and r["csv_owned"] == 1
        assert _counts() == {"csv": 1, "api": 1}
    finally:
        _cleanup()


def test_exact_fill_key_still_idempotent():
    _cleanup()
    try:
        first = _run(upsert_api_fills(ACCT, [_api_fill(400.0)]))
        again = _run(upsert_api_fills(ACCT, [_api_fill(400.0)]))
        assert first["added"] == 1
        assert again["added"] == 0 and again["skipped"] == 1
    finally:
        _cleanup()
