"""Audit-log retention: prune only rows that are BOTH old AND beyond the newest N."""
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from app.db import SessionLocal, init_db
from app.db.models import AuditEvent
from app.notifications import prune_audit_log


def _run(coro):
    return asyncio.run(coro)


def _seed(n_old: int, n_recent: int):
    async def run():
        await init_db()
        async with SessionLocal() as s:
            await s.execute(delete(AuditEvent).where(AuditEvent.kind == "test"))
            old = datetime.now(timezone.utc) - timedelta(days=400)
            recent = datetime.now(timezone.utc) - timedelta(days=1)
            for i in range(n_old):
                s.add(AuditEvent(kind="test", message=f"old{i}", created_at=old, fill_key=f"t-old-{i}"))
            for i in range(n_recent):
                s.add(AuditEvent(kind="test", message=f"new{i}", created_at=recent, fill_key=f"t-new-{i}"))
            await s.commit()
    _run(run())


def _count():
    async def run():
        async with SessionLocal() as s:
            return (await s.execute(select(func.count()).select_from(AuditEvent)
                                    .where(AuditEvent.kind == "test"))).scalar()
    return _run(run())


def _cleanup():
    async def run():
        async with SessionLocal() as s:
            await s.execute(delete(AuditEvent).where(AuditEvent.kind == "test"))
            await s.commit()
    _run(run())


def test_keeps_min_rows_even_when_all_old():
    # 10 rows, all 400 days old, min_rows=5 → keep 5 (age alone can't drop below the floor)
    _seed(n_old=10, n_recent=0)
    try:
        pruned = _run(prune_audit_log(retention_days=180, min_rows=5))
        assert pruned == 5
        assert _count() == 5
    finally:
        _cleanup()


def test_keeps_recent_even_when_beyond_floor():
    # 4 old + 4 recent, min_rows=3. Beyond-newest-3 = 5 rows (the 4 oldest + 1); of those
    # only the 4 OLD ones are also older than cutoff → prune 4, keep 4 recent + the newest old.
    _seed(n_old=4, n_recent=4)
    try:
        pruned = _run(prune_audit_log(retention_days=180, min_rows=3))
        assert pruned == 4          # only old-AND-beyond-floor rows go
        assert _count() == 4        # 4 recent survive (all newer than cutoff)
    finally:
        _cleanup()


def test_no_prune_when_under_min_rows():
    _seed(n_old=3, n_recent=0)
    try:
        assert _run(prune_audit_log(retention_days=180, min_rows=5000)) == 0
        assert _count() == 3
    finally:
        _cleanup()
