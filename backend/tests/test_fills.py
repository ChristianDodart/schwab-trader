"""Unit tests for fills._fills_from_order — the REST-order → Fill mapping.
Pure logic, no API. The critical invariant: the fill price comes from
orderActivityCollection.executionLegs[].price (the real exec price), NOT the
top-level order `price` (the limit/working price)."""
from app.fills import _fills_from_order, _normalize_side


def _order(**over):
    o = {
        "status": "FILLED",
        "orderId": 1,
        "quantity": 3,
        "filledQuantity": 3,
        "price": 10.00,  # limit/working price — must NOT be used as the fill price
        "orderLegCollection": [{
            "instruction": "BUY",
            "instrument": {"symbol": "RCAT", "assetType": "EQUITY"},
        }],
        "orderActivityCollection": [{
            "activityType": "EXECUTION",
            "executionLegs": [{"quantity": 3, "price": 9.87, "time": "2026-06-30T15:30:00+00:00"}],
        }],
    }
    o.update(over)
    return o


def test_fill_uses_execution_price_not_limit():
    fills = _fills_from_order(_order())
    assert len(fills) == 1
    f = fills[0]
    assert f.symbol == "RCAT" and f.side == "BUY"
    assert f.shares == 3
    assert f.price == 9.87  # NOT 10.00 (the top-level limit)


def test_partial_fills_become_multiple_fills():
    o = _order(orderActivityCollection=[{
        "activityType": "EXECUTION",
        "executionLegs": [
            {"quantity": 2, "price": 9.80, "time": "2026-06-30T15:30:00+00:00"},
            {"quantity": 1, "price": 9.95, "time": "2026-06-30T15:31:00+00:00"},
        ],
    }])
    fills = _fills_from_order(o)
    assert [f.shares for f in fills] == [2, 1]
    assert [f.price for f in fills] == [9.80, 9.95]


def test_fallback_when_no_execution_detail():
    o = _order(orderActivityCollection=[], filledQuantity=5, price=12.34,
               closeTime="2026-06-30T16:00:00+00:00")
    fills = _fills_from_order(o)
    assert len(fills) == 1
    assert fills[0].shares == 5 and fills[0].price == 12.34


def test_short_instructions_are_skipped():
    # Long-only ladder: SELL_SHORT/BUY_TO_COVER must NOT fold into SELL/BUY
    # (that would corrupt LIFO). They're skipped; an anomaly surfaces as oversold.
    for instr in ("SELL_SHORT", "BUY_TO_COVER"):
        o = _order(orderLegCollection=[{
            "instruction": instr, "instrument": {"symbol": "RCAT", "assetType": "EQUITY"},
        }])
        assert _fills_from_order(o) == []


def test_fallback_prefers_realized_avg_over_limit():
    o = _order(orderActivityCollection=[], filledQuantity=4, price=20.00,
               averagePrice=18.50, closeTime="2026-06-30T16:00:00+00:00")
    f = _fills_from_order(o)[0]
    assert f.price == 18.50  # realized avg, not the 20.00 limit


def test_multileg_resolves_symbol_by_legid():
    o = {
        "status": "FILLED", "orderId": 9,
        "orderLegCollection": [
            {"legId": 1, "instruction": "BUY", "instrument": {"symbol": "AAA", "assetType": "EQUITY"}},
            {"legId": 2, "instruction": "BUY", "instrument": {"symbol": "BBB", "assetType": "EQUITY"}},
        ],
        "orderActivityCollection": [{
            "activityType": "EXECUTION",
            "executionLegs": [
                {"legId": 2, "quantity": 7, "price": 5.00, "time": "2026-06-30T15:30:00+00:00"},
            ],
        }],
    }
    fills = _fills_from_order(o)
    assert len(fills) == 1 and fills[0].symbol == "BBB" and fills[0].shares == 7


def test_option_is_skipped():
    o = _order(orderLegCollection=[{
        "instruction": "BUY",  # valid side, but OPTION asset → not a share lot → skipped
        "instrument": {"symbol": "RCAT  260101C00010000", "assetType": "OPTION"},
    }])
    assert _fills_from_order(o) == []


def test_collective_investment_is_kept():
    # ETFs/funds (Schwab classifies some as COLLECTIVE_INVESTMENT) ARE share-based
    # and must be kept — regression for the QBTX bug where such fills were dropped.
    o = _order(orderLegCollection=[{
        "instruction": "BUY",
        "instrument": {"symbol": "QBTX", "assetType": "COLLECTIVE_INVESTMENT"},
    }])
    fills = _fills_from_order(o)
    assert len(fills) == 1 and fills[0].symbol == "QBTX"


def test_missing_symbol_is_skipped():
    o = _order(orderLegCollection=[{"instruction": "BUY", "instrument": {}}])
    assert _fills_from_order(o) == []


def test_normalize_side():
    assert _normalize_side("BUY") == "BUY"
    assert _normalize_side("SELL") == "SELL"
    # long-only: shorts are NOT folded into long sides
    assert _normalize_side("BUY_TO_COVER") is None
    assert _normalize_side("SELL_SHORT") is None
    assert _normalize_side("EXERCISE") is None
