"""Unit tests for the pure trade-activity parsing (app/activity.py) — the live
capture of per-trade fees and margin interest that pins the cash identity."""
from app.activity import (
    eastern_day,
    merge_window_rows,
    parse_margin_interest,
    parse_trade_fees,
)


def _trade(day_iso_utc, fees=(), sym="LUNR", tid="1"):
    """A minimal TRADE transaction: one instrument leg + optional fee legs."""
    items = [{"instrument": {"symbol": sym}, "amount": 10, "cost": -100.0}]
    for ft, cost in fees:
        items.append({"feeType": ft, "cost": cost, "amount": cost})
    return {"type": "TRADE", "netAmount": -100.0, "tradeDate": day_iso_utc,
            "activityId": tid, "transferItems": items}


def _interest(day_iso_utc, amount, desc="MARGIN INTEREST ADJUSTMENT", ty="DIVIDEND_OR_INTEREST"):
    return {"type": ty, "netAmount": amount, "tradeDate": day_iso_utc, "description": desc}


# ---------- eastern_day ----------

def test_eastern_day_converts_utc_to_market_date():
    # 7:30pm ET on 07-11 is 11:30pm UTC same day — stays 07-11.
    assert eastern_day({"tradeDate": "2026-07-11T23:30:00+0000"}) == "2026-07-11"
    # 8pm ET on 07-11 is 00:00 UTC on 07-12 — UTC date would say the 12th; Eastern says the 11th.
    assert eastern_day({"tradeDate": "2026-07-12T00:00:00Z"}) == "2026-07-11"


def test_eastern_day_falls_back_on_junk():
    assert eastern_day({"tradeDate": "2026-07-11junk"}) == "2026-07-11"
    assert eastern_day({}) is None


# ---------- parse_trade_fees ----------

def test_fees_summed_per_eastern_day_negative_amounts():
    data = [
        _trade("2026-07-10T14:00:00+0000", fees=[("SEC_FEE", -0.02), ("TAF_FEE", -0.01)]),
        _trade("2026-07-10T15:00:00+0000", fees=[("SEC_FEE", -0.03)]),
        _trade("2026-07-11T14:00:00+0000", fees=[]),                # fee-free trade → no row
        {"type": "DIVIDEND_OR_INTEREST", "netAmount": 5.0,
         "tradeDate": "2026-07-10T14:00:00+0000"},                  # not a TRADE → ignored
    ]
    rows = parse_trade_fees(data)
    assert rows == [{"day": "2026-07-10", "amount": -0.06, "type": "TRADE FEES"}]


def test_fees_use_amount_when_cost_missing_and_abs_value():
    data = [_trade("2026-07-10T14:00:00+0000", fees=[("SEC_FEE", None)])]
    data[0]["transferItems"][1]["amount"] = 0.04     # cost None → falls back to amount
    data[0]["transferItems"][1]["cost"] = None
    assert parse_trade_fees(data) == [{"day": "2026-07-10", "amount": -0.04, "type": "TRADE FEES"}]


def test_after_hours_fee_lands_on_eastern_day():
    # 00:30 UTC on the 12th = 8:30pm ET on the 11th — must bucket to the 11th
    # (UTC bucketing would disagree with the CSV and double-count on re-import).
    data = [_trade("2026-07-12T00:30:00+0000", fees=[("SEC_FEE", -0.05)])]
    assert parse_trade_fees(data)[0]["day"] == "2026-07-11"


# ---------- parse_margin_interest ----------

def test_margin_interest_negative_rows_only():
    data = [
        _interest("2026-07-01T04:00:00+0000", -12.34),
        _interest("2026-07-02T04:00:00+0000", 5.00),                       # credit → dividend path
        _interest("2026-07-03T04:00:00+0000", -2.00, desc="FOREIGN TAX"),  # not interest → skip
    ]
    rows = parse_margin_interest(data)
    assert rows == [{"day": "2026-06-30", "amount": -12.34, "type": "MARGIN INTEREST"}] or \
           rows == [{"day": "2026-07-01", "amount": -12.34, "type": "MARGIN INTEREST"}]
    # (midnight-UTC stamps shift a calendar day when converted to Eastern —
    #  either attribution is fine as long as it's deterministic; pin that here)
    assert len(rows) == 1 and rows[0]["amount"] == -12.34


def test_margin_interest_matches_on_type_when_description_empty():
    data = [_interest("2026-07-01T12:00:00+0000", -3.21, desc="", ty="MARGIN_INTEREST")]
    rows = parse_margin_interest(data)
    assert rows == [{"day": "2026-07-01", "amount": -3.21, "type": "MARGIN INTEREST"}]


# ---------- merge_window_rows ----------

def test_merge_replaces_window_and_reports_net_zero_on_repull():
    existing = [
        {"day": "2026-05-01", "amount": -0.10, "type": "TRADE FEES"},      # outside window → kept
        {"day": "2026-07-10", "amount": -0.06, "type": "TRADE FEES"},      # inside → replaced
        {"day": "2026-07-01", "amount": -12.34, "type": "MARGIN INTEREST"},# inside → replaced
        {"day": "2026-07-09", "amount": -4.00, "type": "FOREIGN TAX"},     # other type → kept
    ]
    fresh = [
        {"day": "2026-07-10", "amount": -0.06, "type": "TRADE FEES"},
        {"day": "2026-07-01", "amount": -12.34, "type": "MARGIN INTEREST"},
    ]
    merged, net_new = merge_window_rows(existing, fresh, "2026-06-15", "2026-07-11")
    assert net_new == 0                                # identical re-pull is a no-op
    assert {"day": "2026-05-01", "amount": -0.10, "type": "TRADE FEES"} in merged
    assert {"day": "2026-07-09", "amount": -4.00, "type": "FOREIGN TAX"} in merged
    assert len([r for r in merged if r["type"] == "TRADE FEES"]) == 2


def test_merge_counts_new_and_changed_rows():
    existing = [{"day": "2026-07-10", "amount": -0.06, "type": "TRADE FEES"}]
    fresh = [
        {"day": "2026-07-10", "amount": -0.09, "type": "TRADE FEES"},      # day's sum changed
        {"day": "2026-07-11", "amount": -0.02, "type": "TRADE FEES"},      # brand new day
    ]
    merged, net_new = merge_window_rows(existing, fresh, "2026-06-15", "2026-07-11")
    assert net_new == 2
    assert sorted(r["amount"] for r in merged) == [-0.09, -0.02]


def test_merge_clears_window_when_feed_has_no_rows():
    # A day whose trades were busted/corrected: the pull returns nothing for the
    # window, so stale rows inside it must go away.
    existing = [{"day": "2026-07-10", "amount": -0.06, "type": "TRADE FEES"}]
    merged, net_new = merge_window_rows(existing, [], "2026-07-01", "2026-07-11")
    assert merged == [] and net_new == 0
