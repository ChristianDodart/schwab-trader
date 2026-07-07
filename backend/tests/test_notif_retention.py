"""Notification-feed retention (W27-1): same both-conditions rule as the audit log,
plus the app_setting caps (notes symbol limit)."""
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from app import ledger
from app.db import SessionLocal, init_db
from app.db.models import AppSetting, Notification
from app.notifications import prune_notifications

MARK = "[retention-test]"
ACCT = "TEST_NOTIF_RETENTION"


def _run(coro):
    return asyncio.run(coro)


def _seed(n_old: int, n_recent: int):
    async def run():
        await init_db()
        async with SessionLocal() as s:
            await s.execute(delete(Notification).where(Notification.message.like(f"{MARK}%")))
            old = datetime.now(timezone.utc) - timedelta(days=400)
            recent = datetime.now(timezone.utc) - timedelta(days=1)
            for i in range(n_old):
                s.add(Notification(message=f"{MARK} old{i}", created_at=old))
            for i in range(n_recent):
                s.add(Notification(message=f"{MARK} new{i}", created_at=recent))
            await s.commit()
    _run(run())


def _count():
    async def run():
        async with SessionLocal() as s:
            return (await s.execute(select(func.count()).select_from(Notification)
                                    .where(Notification.message.like(f"{MARK}%")))).scalar()
    return _run(run())


def _cleanup():
    async def run():
        async with SessionLocal() as s:
            await s.execute(delete(Notification).where(Notification.message.like(f"{MARK}%")))
            await s.commit()
    _run(run())


def test_keeps_floor_even_when_all_old():
    _seed(n_old=10, n_recent=0)
    try:
        pruned = _run(prune_notifications(retention_days=180, min_rows=5))
        assert pruned == 5
        assert _count() == 5
    finally:
        _cleanup()


def test_recent_survive_beyond_floor():
    _seed(n_old=4, n_recent=4)
    try:
        pruned = _run(prune_notifications(retention_days=180, min_rows=3))
        assert pruned == 4
        assert _count() == 4
    finally:
        _cleanup()


def test_no_prune_under_floor():
    _seed(n_old=3, n_recent=0)
    try:
        assert _run(prune_notifications(retention_days=180, min_rows=2000)) == 0
        assert _count() == 3
    finally:
        _cleanup()


def test_note_cap_refuses_net_new_but_allows_update_and_delete(monkeypatch):
    async def run():
        await init_db()
        async with SessionLocal() as s:
            await s.execute(delete(AppSetting).where(AppSetting.key == ledger._NOTES_KEY + ACCT))
            await s.commit()
        monkeypatch.setattr(ledger, "_NOTES_MAX_SYMBOLS", 2)
        assert (await ledger.set_note(ACCT, "AAA", "one"))["ok"]
        assert (await ledger.set_note(ACCT, "BBB", "two"))["ok"]
        r = await ledger.set_note(ACCT, "CCC", "three")          # net-new past cap
        assert not r["ok"] and "limit" in r["error"]
        assert (await ledger.set_note(ACCT, "AAA", "edited"))["ok"]   # update fine
        assert (await ledger.set_note(ACCT, "BBB", ""))["ok"]          # delete fine
        assert (await ledger.set_note(ACCT, "CCC", "now fits"))["ok"]  # room freed
        async with SessionLocal() as s:
            await s.execute(delete(AppSetting).where(AppSetting.key == ledger._NOTES_KEY + ACCT))
            await s.commit()
    _run(run())
