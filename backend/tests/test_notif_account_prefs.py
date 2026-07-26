"""Notification prefs are per-account (v0.62): keyed by account_hash, a brand-new
account seeds from the legacy global blob, and accounts don't bleed into each other."""
import asyncio

import pytest
from sqlalchemy import delete

from app import notifications as n
from app.db import SessionLocal, init_db
from app.db.models import AppSetting


def _run(c):
    return asyncio.run(c)


@pytest.fixture(autouse=True)
def clean():
    async def clear():
        await init_db()
        async with SessionLocal() as s:
            await s.execute(delete(AppSetting).where(AppSetting.key.like("%notif_prefs")))
            await s.commit()
    n._prefs_cache.clear()
    _run(clear())
    yield
    n._prefs_cache.clear()
    _run(clear())


def test_key_scoping():
    assert n._prefs_key("ABC") == "a:ABC:notif_prefs"
    assert n._prefs_key(None) == "notif_prefs"


def test_accounts_are_independent():
    _run(n.set_notif_prefs({"categories": {"fill": {"sound": True}}}, account_hash="ACC1"))
    a1 = _run(n.get_notif_prefs("ACC1"))
    a2 = _run(n.get_notif_prefs("ACC2"))
    assert a1["categories"]["fill"]["sound"] is True
    assert a2["categories"]["fill"]["sound"] is False   # untouched → default off


def test_new_account_seeds_from_global():
    # A legacy global blob (muted) should carry into a fresh account's first read.
    _run(n.set_notif_prefs({"muted": True}, account_hash=None))
    n._prefs_cache.clear()                  # force a cold read for the account
    fresh = _run(n.get_notif_prefs("NEWACC"))
    assert fresh["muted"] is True
