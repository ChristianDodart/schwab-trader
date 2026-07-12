"""The global appearance endpoint: theme + font size persist in the DB (NOT
localStorage, which resets each launch in the packaged app), are NOT profile-scoped,
and support partial updates."""
import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app import accounts as accounts_svc
from app.db import SessionLocal, init_db
from app.db.models import AppSetting
from app.main import app

THEME_KEY = "ui:appearance:theme"
FS_KEY = "ui:appearance:fontsize"


def _run(c):
    return asyncio.run(c)


@pytest.fixture()
def client():
    async def clear():
        await init_db()
        async with SessionLocal() as s:
            await s.execute(delete(AppSetting).where(AppSetting.key.in_([THEME_KEY, FS_KEY])))
            await s.commit()
    _run(clear())
    with TestClient(app) as c:
        yield c
    _run(clear())


def test_unset_reads_null(client):
    assert client.get("/api/appearance").json() == {"theme": None, "fontsize": None}


def test_round_trip_persists(client):
    client.post("/api/appearance", json={"theme": "tron", "fontsize": "large"})
    assert client.get("/api/appearance").json() == {"theme": "tron", "fontsize": "large"}


def test_partial_update_leaves_the_other_field(client):
    client.post("/api/appearance", json={"theme": "nord", "fontsize": "medium"})
    client.post("/api/appearance", json={"theme": "dracula"})   # only theme
    assert client.get("/api/appearance").json() == {"theme": "dracula", "fontsize": "medium"}


def test_is_global_not_profile_scoped(client):
    # Stored under a fixed key with no profile prefix, so switching the active profile
    # can't change the saved theme (unlike /api/prefs).
    client.post("/api/appearance", json={"theme": "midnight"})
    stored = _run(accounts_svc.get_setting(THEME_KEY))
    assert stored == "midnight"
    # and there's no profile-scoped copy masking it
    assert not _run(accounts_svc.get_setting(f"p:whatever:{THEME_KEY}"))
