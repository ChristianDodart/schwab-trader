"""The rebuild safety gates that prevent data loss. Both short-circuit BEFORE any
DB access, so they're testable without a database."""
import asyncio
from datetime import datetime, timezone

from app import rebuild
from app.rebuild import _write, rebuild_account
from app.reconstruct import Fill


def _run(coro):
    return asyncio.run(coro)


def test_empty_fills_is_skip_never_wipes():
    # API succeeded with zero fills → safe skip (may re-route to positions-mirror).
    r = _run(rebuild_account("SOME_ACCOUNT_HASH", []))
    assert r["ok"] is True and r.get("skipped")


def test_none_fills_is_error_not_skip():
    # None = fetch ERROR. Must be an error, NOT a {skipped} — a {skipped} would let
    # the router positions-flatten a full-access account on a transient outage.
    r = _run(rebuild_account("SOME_ACCOUNT_HASH", None))
    assert r["ok"] is False and not r.get("skipped")


def test_no_account_hash_refused():
    r = _run(rebuild_account("", [Fill("RCAT", "BUY", 1, 10.0, datetime(2026, 6, 30, tzinfo=timezone.utc))]))
    assert r["ok"] is False


def test_oversold_refuses_to_commit():
    # A SELL with no matching BUY (incomplete history) => oversold => refuse,
    # so we never replace good rows with a truncated reconstruction.
    at = datetime(2026, 6, 30, tzinfo=timezone.utc)
    sell_only = [Fill("RCAT", "SELL", 5, 10.0, at)]
    r = _run(rebuild_account("SOME_ACCOUNT_HASH", sell_only))
    assert r["ok"] is False and r.get("oversold")


def test_empty_positions_map_treated_as_no_positions():
    # An empty positions map ({}) is indistinguishable from a degraded read, so
    # _write must treat it like 'no positions' (fills-only), NOT 'hold nothing'.
    # With empty fills too, that yields the safe skip — never a wipe (short-circuits
    # before any DB access).
    r = _run(_write("SOME_ACCOUNT_HASH", [], {}))
    assert r["ok"] is True and r.get("skipped")


def test_empty_positions_map_with_oversold_fills_refuses():
    # {} positions falls back to the fills-only path, so an oversold reconstruction
    # still refuses (rather than reconciling the oversell away).
    at = datetime(2026, 6, 30, tzinfo=timezone.utc)
    r = _run(_write("SOME_ACCOUNT_HASH", [Fill("RCAT", "SELL", 5, 10.0, at)], {}))
    assert r["ok"] is False and r.get("oversold")


def test_empty_fills_with_history_refuses(monkeypatch):
    # fills==[] on an account that ALREADY has fill-derived history is an anomaly (a
    # full-access account's sells are themselves fills). Reconciling would wipe real
    # completed trades and flatten the ladder → must refuse and leave data intact.
    async def _has_history(_h):
        return True
    monkeypatch.setattr(rebuild, "_has_fill_derived_data", _has_history)
    r = _run(_write("SOME_ACCOUNT_HASH", [], {"RCAT": (10, 5.0)}))
    assert r["ok"] is False and r.get("refused")
