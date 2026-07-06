"""Unit tests for the pure dividend parsing/merge (app/dividends.py)."""
from app.dividends import merge_dividends, parse_dividends, summarize


def _txn(ty, amount, day="2026-03-01", sym="AAPL", tid="1"):
    return {
        "type": ty, "netAmount": amount, "tradeDate": f"{day}T00:00:00+0000",
        "activityId": tid,
        "transferItems": [{"instrument": {"symbol": sym}}] if sym else [],
    }


def test_parse_keeps_dividend_credits_only():
    data = [
        _txn("CASH_DIVIDEND", 12.34, sym="MSFT", tid="a"),
        _txn("ACH_RECEIPT", 1000.0, tid="b"),          # a transfer, not a dividend
        _txn("DIVIDEND_OR_INTEREST", 5.0, sym="KO", tid="c"),
        _txn("CASH_DIVIDEND", -2.0, tid="d"),           # negative → skip
    ]
    out = parse_dividends(data)
    assert [r["symbol"] for r in out] == ["MSFT", "KO"]
    assert out[0]["amount"] == 12.34
    assert out[0]["day"] == "2026-03-01"


def test_parse_matches_unknown_dividend_variant_by_substring():
    out = parse_dividends([_txn("FOREIGN_DIVIDEND_TAX_ADJ", 3.0, sym="TSM", tid="x")])
    assert len(out) == 1 and out[0]["symbol"] == "TSM"


def test_parse_handles_missing_symbol_and_ids():
    out = parse_dividends([{"type": "DIVIDEND", "netAmount": 4.5, "tradeDate": "2026-01-02"}])
    assert out == [{"schwab_txn_id": None, "day": "2026-01-02", "amount": 4.5,
                    "symbol": None, "type": "DIVIDEND"}]


def test_merge_dedups_by_txn_id():
    existing = parse_dividends([_txn("CASH_DIVIDEND", 5.0, tid="a")])
    fresh = parse_dividends([_txn("CASH_DIVIDEND", 5.0, tid="a"),   # dup
                             _txn("CASH_DIVIDEND", 9.0, tid="b")])  # new
    merged, added = merge_dividends(existing, fresh)
    assert added == 1
    assert len(merged) == 2


def test_merge_dedups_idless_by_day_amount_symbol():
    existing = [{"schwab_txn_id": None, "day": "2026-02-01", "amount": 3.0, "symbol": "KO"}]
    fresh = [{"schwab_txn_id": None, "day": "2026-02-01", "amount": 3.0, "symbol": "KO"}]
    merged, added = merge_dividends(existing, fresh)
    assert added == 0 and len(merged) == 1


def test_merge_sorts_desc_by_day():
    merged, _ = merge_dividends(
        [{"schwab_txn_id": "1", "day": "2026-01-01", "amount": 1, "symbol": "A"}],
        [{"schwab_txn_id": "2", "day": "2026-05-01", "amount": 2, "symbol": "B"}],
    )
    assert [r["day"] for r in merged] == ["2026-05-01", "2026-01-01"]


def test_summarize_all_time_and_ytd():
    rows = [
        {"day": "2026-03-01", "amount": 10.0},
        {"day": "2026-06-01", "amount": 5.0},
        {"day": "2025-11-01", "amount": 7.0},
    ]
    s = summarize(rows, year=2026)
    assert s["total"] == 22.0
    assert s["ytd"] == 15.0
    assert s["count"] == 3
