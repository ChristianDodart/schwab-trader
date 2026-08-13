"""parse_transfers derives DIRECTION from netAmount's sign, not the transaction type.

The Andrew ...580 bug: Schwab filed two withdrawals under ELECTRONIC_FUND (a type in
_TRANSFER_IN). The old code forced the sign from the type, flipping −$20,000 and −$12,000
withdrawals into phantom +$20,000 / +$12,000 deposits that overstated deposits by $32k.
"""
from app.accounts import parse_transfers


def _txn(ty, net, txid="x", date="2024-11-06"):
    return {"type": ty, "netAmount": net, "activityId": txid, "tradeDate": date}


def test_electronic_fund_withdrawal_stays_a_withdrawal():
    # The exact bug: ELECTRONIC_FUND is in _TRANSFER_IN, but the money LEFT (net < 0).
    rows = parse_transfers([_txn("ELECTRONIC_FUND", -20000)])
    assert len(rows) == 1
    assert rows[0]["amount"] == -20000.0
    assert rows[0]["kind"] == "withdrawal"


def test_electronic_fund_deposit_stays_a_deposit():
    rows = parse_transfers([_txn("ELECTRONIC_FUND", 247)])
    assert rows[0]["amount"] == 247.0
    assert rows[0]["kind"] == "deposit"


def test_one_way_types_keep_their_direction():
    rows = parse_transfers([
        _txn("CASH_RECEIPT", 3000, txid="a"),
        _txn("CASH_DISBURSEMENT", -2709.59, txid="b"),
        _txn("WIRE_IN", 5000, txid="c"),
        _txn("ACH_DISBURSEMENT", -750, txid="d"),
    ])
    kinds = {r["schwab_txn_id"]: (r["amount"], r["kind"]) for r in rows}
    assert kinds["a"] == (3000.0, "deposit")
    assert kinds["b"] == (-2709.59, "withdrawal")
    assert kinds["c"] == (5000.0, "deposit")
    assert kinds["d"] == (-750.0, "withdrawal")


def test_one_way_out_type_with_unsigned_amount_is_defended():
    # Defensive guard: a DISBURSEMENT that somehow arrives positive is still a withdrawal,
    # so an unsigned amount can never read as a deposit.
    rows = parse_transfers([_txn("CASH_DISBURSEMENT", 6500)])
    assert rows[0]["amount"] == -6500.0
    assert rows[0]["kind"] == "withdrawal"


def test_non_transfer_and_zero_rows_skipped():
    rows = parse_transfers([
        _txn("TRADE", -936.20),      # not a transfer type
        _txn("JOURNAL", 1500),       # internal transfer — intentionally excluded
        _txn("CASH_RECEIPT", 0),     # zero net — skipped
    ])
    assert rows == []
