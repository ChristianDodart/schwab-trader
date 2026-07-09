"""Cash journals count as contributions; share journals (with a ticker) don't.
A cash journal moves money into/out of THIS account, so per-account cash identity
needs it — but a journal that carries a symbol is a share transfer (no cash)."""
import asyncio

from sqlalchemy import delete, select

from app.db import SessionLocal, init_db
from app.db.models import CashFlow
from app.ledger import import_cashflows_csv

ACCT = "TEST_CASHFLOW_JOURNAL"

CSV = '''"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"07/06/2026","Journal","","JOURNAL FRM ...896","","","","$1500.00"
"07/05/2026","MoneyLink Transfer","","Tfr CAPITAL ONE","","","","$500.00"
"07/04/2026","Journal","RCAT","JOURNALED SHARES IN","100","","","$0.00"
"07/03/2026","Buy","RCAT","RED CAT","10","$9.00","","-$90.00"
'''


def _run(c):
    return asyncio.run(c)


def _rows():
    async def go():
        async with SessionLocal() as s:
            return (await s.execute(
                select(CashFlow.amount, CashFlow.memo).where(CashFlow.account_hash == ACCT)
            )).all()
    return _run(go())


def _cleanup():
    async def go():
        async with SessionLocal() as s:
            await s.execute(delete(CashFlow).where(CashFlow.account_hash == ACCT))
            await s.commit()
    _run(go())


def test_cash_journal_counts_share_journal_and_trade_do_not():
    _run(init_db())
    _cleanup()
    try:
        res = _run(import_cashflows_csv(ACCT, CSV))
        assert res["ok"]
        assert res["added"] == 2                     # cash journal + MoneyLink transfer
        rows = _rows()
        amts = sorted(float(a) for a, _ in rows)
        assert amts == [500.0, 1500.0]               # trade + share-journal excluded
        assert any("896" in (m or "") for _, m in rows)   # the cash journal, by memo
    finally:
        _cleanup()


# Funds Received/Paid (cashier's/Schwab One checks) and MoneyLink Adj are real external
# cash movements — they must count as deposits/withdrawals, not fall through as "other".
FUNDS_CSV = '''"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"07/02/2024","Funds Received","","CASHIERS CHECK","","","","$100000.00"
"11/09/2023","Funds Paid","","SCHWAB ONE CHECK 000202","","","","-$10000.00"
"11/25/2025","MoneyLink Adj","","Tfr STATE BANK","","","","-$100000.00"
"07/03/2026","Buy","RCAT","RED CAT","10","$9.00","","-$90.00"
'''


def test_funds_and_moneylink_adj_count_as_transfers():
    _run(init_db())
    _cleanup()
    try:
        res = _run(import_cashflows_csv(ACCT, FUNDS_CSV))
        assert res["ok"]
        assert res["added"] == 3                      # funds in, funds out, moneylink adj
        amts = sorted(float(a) for a, _ in _rows())
        assert amts == [-100000.0, -10000.0, 100000.0]   # trade excluded
    finally:
        _cleanup()
