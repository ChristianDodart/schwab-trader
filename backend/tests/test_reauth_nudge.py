"""The proactive re-auth nudge ladder (soon → today → expired).

One notification per stage per token issuance, escalation-only, re-armed by a new
token. All external touchpoints (token status, settings store, notification post)
are monkeypatched so this exercises pure ladder logic.
"""
import asyncio

import app.schwab.auth as auth_mod
from app import main


def _run(coro):
    return asyncio.run(coro)


class Harness:
    """Fake token status + settings + notification sink around _maybe_reauth_nudge."""

    def __init__(self, monkeypatch):
        self.status = {}
        self.settings = {}
        self.posted = []
        monkeypatch.setattr(auth_mod, "token_status", lambda: dict(self.status))

        async def get_setting(key):
            return self.settings.get(key)

        async def set_setting(key, value):
            self.settings[key] = value

        async def post(account_hash, message, **kw):
            self.posted.append(message)

        monkeypatch.setattr(main.accounts_svc, "get_setting", get_setting)
        monkeypatch.setattr(main.accounts_svc, "set_setting", set_setting)
        monkeypatch.setattr(main.notifications_svc, "post_system_notification", post)

    def tick(self, issued_at=1000, days_left=None, expired=False):
        self.status = {"issued_at": issued_at, "days_left": days_left, "expired": expired}
        _run(main._maybe_reauth_nudge())


def test_healthy_token_no_nudge(monkeypatch):
    h = Harness(monkeypatch)
    h.tick(days_left=5.0)
    assert h.posted == []


def test_no_token_no_nudge(monkeypatch):
    h = Harness(monkeypatch)
    h.tick(issued_at=None, expired=True)
    assert h.posted == []


def test_soon_fires_once_then_dedups(monkeypatch):
    h = Harness(monkeypatch)
    h.tick(days_left=1.8)
    h.tick(days_left=1.6)  # same stage, same token → silent
    assert len(h.posted) == 1 and "2 days" in h.posted[0]


def test_ladder_escalates_each_stage_once(monkeypatch):
    h = Harness(monkeypatch)
    h.tick(days_left=1.8)                 # soon
    h.tick(days_left=0.4)                 # today
    h.tick(days_left=0.3)                 # today again → silent
    h.tick(days_left=0.0, expired=True)   # expired
    h.tick(days_left=0.0, expired=True)   # still expired → silent
    assert len(h.posted) == 3
    assert "expires today" in h.posted[1]
    assert "has expired" in h.posted[2]


def test_skipping_straight_to_expired_fires(monkeypatch):
    h = Harness(monkeypatch)
    h.tick(expired=True)
    assert len(h.posted) == 1


def test_new_token_rearms_the_ladder(monkeypatch):
    h = Harness(monkeypatch)
    h.tick(issued_at=1000, expired=True)
    h.tick(issued_at=2000, days_left=1.9)  # fresh issuance, back at "soon"
    assert len(h.posted) == 2 and "2 days" in h.posted[1]
