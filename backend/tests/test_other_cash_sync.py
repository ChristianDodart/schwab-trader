"""The other-cash log under BOTH writers: the live activity sync (API) and the CSV
import. TRADE FEES and MARGIN INTEREST are replace-by-coverage types — each source is
authoritative for its day range — so an API pull followed by a CSV import covering the
same days must never double-count, and re-imports/re-pulls must be no-ops."""
import asyncio

from sqlalchemy import delete

from app.activity import merge_window_rows, parse_margin_interest, parse_trade_fees
from app.db import SessionLocal, init_db
from app.db.models import AppSetting
from app.ledger import get_other_cash, import_other_cash_csv
from app.ledger.income import _OTHER_CASH_KEY, _save_other_cash

ACCT = "TEST_OTHER_CASH_SYNC"

# One sell with SEC+TAF fees on 07-09 and a margin-interest debit on 07-01 — as the
# Schwab transactions API serves them (fees ride TRADE transferItems with a feeType).
RAW_API = [
    {"type": "TRADE", "netAmount": 902.94, "tradeDate": "2026-07-09T15:00:00+0000",
     "transferItems": [
         {"instrument": {"symbol": "LUNR"}, "amount": -90, "cost": 903.00},
         {"feeType": "SEC_FEE", "cost": -0.04, "amount": -0.04},
         {"feeType": "TAF_FEE", "cost": -0.02, "amount": -0.02},
     ]},
    {"type": "DIVIDEND_OR_INTEREST", "netAmount": -12.34,
     "tradeDate": "2026-07-01T12:00:00+0000", "description": "MARGIN INTEREST ADJUSTMENT"},
]

# The SAME activity as a Schwab Transactions CSV export (fees in "Fees & Comm",
# margin interest as its own row).
CSV = '''"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"07/09/2026","Sell","LUNR","INTUITIVE MACHINES","90","$10.0333","$0.06","$902.94"
"07/01/2026","Margin Interest","","MARGIN INTEREST ADJUSTMENT","","","","-$12.34"
"06/20/2026","Foreign Tax Paid","","ADR FEE","","","","-$1.11"
'''


def _run(c):
    return asyncio.run(c)


def _cleanup():
    async def go():
        async with SessionLocal() as s:
            await s.execute(delete(AppSetting).where(AppSetting.key == _OTHER_CASH_KEY + ACCT))
            await s.commit()
    _run(go())


def _api_pull():
    """The other-cash portion of sync_activity, minus the network."""
    async def go():
        fresh = parse_trade_fees(RAW_API) + parse_margin_interest(RAW_API)
        existing = (await get_other_cash(ACCT))["rows"]
        merged, net_new = merge_window_rows(existing, fresh, "2026-05-15", "2026-07-11")
        await _save_other_cash(ACCT, merged)
        return net_new
    return _run(go())


def test_api_pull_then_csv_import_never_double_counts():
    _run(init_db())
    _cleanup()
    try:
        # 1. Live pull lands fees + interest.
        assert _api_pull() == 2
        total_after_api = _run(get_other_cash(ACCT))["total"]
        assert total_after_api == round(-0.06 - 12.34, 2)

        # 2. A CSV covering the same days replaces — not stacks — those rows,
        #    and adds only what the API couldn't classify (the foreign tax).
        res = _run(import_other_cash_csv(ACCT, CSV))
        assert res["ok"]
        d = _run(get_other_cash(ACCT))
        assert d["total"] == round(-0.06 - 12.34 - 1.11, 2)
        assert len([r for r in d["rows"] if r["type"] == "TRADE FEES"]) == 1
        assert len([r for r in d["rows"] if r["type"] == "MARGIN INTEREST"]) == 1

        # 3. Re-import: byte-identical totals, reported as a no-op.
        res2 = _run(import_other_cash_csv(ACCT, CSV))
        assert res2["ok"] and res2["added"] == 0
        assert _run(get_other_cash(ACCT))["total"] == d["total"]

        # 4. Re-pull after the CSV: still a no-op (sources agree on the sums).
        assert _api_pull() == 0
        assert _run(get_other_cash(ACCT))["total"] == d["total"]
    finally:
        _cleanup()
