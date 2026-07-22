"""backfill_activity + sync_activity: one-time full-history pull paged in <=1yr windows
to the account's API ceiling, feeding deposits/dividends/fees. Idempotent; gated by a
per-account done-flag so later syncs are the cheap incremental window."""
import asyncio

import pytest
from sqlalchemy import delete

from app import accounts as accounts_svc
from app.db import SessionLocal, init_db
from app.db.models import AppSetting, CashFlow
from app.ledger import get_dividends, get_other_cash, list_cashflows, sync_activity
from app.ledger.income import _BACKFILL_KEY

ACCT = "TEST_BACKFILL_ACCT"


def _run(c): return asyncio.run(c)


def _transfer(txid, day, amt):
    return {"type": "ACH_RECEIPT", "netAmount": amt, "tradeDate": f"{day}T05:00:00+0000", "activityId": txid}

def _dividend(txid, day, amt, sym="KO"):
    return {"type": "CASH_DIVIDEND", "netAmount": amt, "tradeDate": f"{day}T05:00:00+0000",
            "activityId": txid, "transferItems": [{"instrument": {"symbol": sym}}]}

def _trade_with_fee(day, fee, sym="AAA"):
    return {"type": "TRADE", "tradeDate": f"{day}T14:00:00+0000", "transferItems": [
        {"instrument": {"assetType": "CURRENCY", "symbol": "CURRENCY_USD"}, "feeType": "SEC_FEE", "cost": fee},
        {"instrument": {"assetType": "EQUITY", "symbol": sym}, "amount": 10, "cost": -100.0,
         "price": 10.0, "positionEffect": "OPENING"}]}

# Newest window (this year), an older window (last year), then the ceiling (empty).
WINDOWS = [
    [_transfer("t1", "2026-05-01", 1000.0), _dividend("d1", "2026-05-02", 12.34), _trade_with_fee("2026-05-03", -0.02)],
    [_transfer("t2", "2025-05-01", 500.0), _trade_with_fee("2025-05-03", -0.05)],
    [],
]


@pytest.fixture()
def patched(monkeypatch):
    async def clear():
        await init_db()
        async with SessionLocal() as s:
            await s.execute(delete(CashFlow).where(CashFlow.account_hash == ACCT))
            await s.execute(delete(AppSetting).where(AppSetting.key.like(f"%{ACCT}%")))
            await s.commit()
    _run(clear())
    calls = {"n": 0}
    async def fake_window(acct, start, end):
        i = calls["n"]; calls["n"] += 1
        return WINDOWS[i] if i < len(WINDOWS) else []
    monkeypatch.setattr(accounts_svc, "fetch_transactions_window", fake_window)
    # incremental path shouldn't be hit on the backfill run, but stub it safely
    monkeypatch.setattr(accounts_svc, "fetch_transactions_raw", lambda *a, **k: _noop())
    yield calls
    _run(clear())

async def _noop(): return []


def test_backfill_pulls_all_windows_then_marks_done(patched):
    r = _run(sync_activity(ACCT))
    assert r["ok"] and r.get("backfilled") is True
    assert r["windows"] == 2                      # stopped at the empty (ceiling) window

    cf = _run(list_cashflows(ACCT))
    amts = sorted(row["amount"] for row in cf["rows"])
    assert amts == [500.0, 1000.0]                # both years' deposits recovered

    oc = _run(get_other_cash(ACCT))
    fees = sorted(r["amount"] for r in oc["rows"] if r["type"] == "TRADE FEES")
    assert fees == [-0.05, -0.02]                 # fees from BOTH windows kept (disjoint coverage)

    div = _run(get_dividends(ACCT))
    assert div["summary"]["total"] == 12.34

    # done-flag set → a second sync does NOT re-backfill (it throttles/incrementals)
    assert _run(accounts_svc.get_setting(_BACKFILL_KEY + ACCT))
    r2 = _run(sync_activity(ACCT))
    assert r2.get("backfilled") is not True


def test_backfill_aborts_without_marking_done_on_fetch_error(patched, monkeypatch):
    async def failing(acct, start, end): return None   # transient API failure
    monkeypatch.setattr(accounts_svc, "fetch_transactions_window", failing)
    _run(sync_activity(ACCT, force=True))
    # backfill failed → not marked done (so it retries next time), fell through to incremental
    assert not _run(accounts_svc.get_setting(_BACKFILL_KEY + ACCT))
