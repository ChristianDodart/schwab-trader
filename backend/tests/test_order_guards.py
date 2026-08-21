"""Pre-trade guard rails — exercised directly through the interface that runs in
production (place_order / replace_order both call these), no broker needed."""
from app.order_guards import (
    GuardConfig,
    OrderIntent,
    SINGLE_ORDER_GUARDS,
    check_held,
    evaluate_order,
)


def _intent(**kw):
    base = dict(symbol="ABC", side="BUY", quantity=10, order_type="LIMIT", limit_price=100.0)
    base.update(kw)
    return OrderIntent(**base)


# ---- fat-finger --------------------------------------------------------------
def test_limit_within_band_is_ok():
    assert evaluate_order(_intent(limit_price=100.0), ref_price=100.0).ok


def test_limit_far_from_market_asks_confirm():
    v = evaluate_order(_intent(limit_price=125.0), ref_price=100.0)  # +25% > 20%
    assert v.action == "confirm" and "typo" in v.reason


def test_limit_no_trusted_quote_asks_confirm():
    v = evaluate_order(_intent(limit_price=100.0), ref_price=None)
    assert v.action == "confirm" and "No live quote" in v.reason


def test_confirm_skips_the_soft_rails():
    assert evaluate_order(_intent(limit_price=125.0), ref_price=100.0, confirm=True).ok


def test_custom_config_widens_the_band():
    wide = GuardConfig(fatfinger_pct=0.25, notional_confirm=25_000.0)
    assert evaluate_order(_intent(limit_price=124.0), ref_price=100.0, cfg=wide).ok  # +24% < 25%


# ---- notional ----------------------------------------------------------------
def test_oversized_buy_asks_confirm():
    v = evaluate_order(_intent(side="BUY", quantity=200, limit_price=60.0), ref_price=60.0)  # $12k
    assert v.action == "confirm" and "quantity" in v.reason


def test_reasonable_buy_is_ok():
    assert evaluate_order(_intent(side="BUY", quantity=50, limit_price=60.0), ref_price=60.0).ok


def test_market_buy_without_a_quote_asks_confirm():
    v = evaluate_order(_intent(side="BUY", order_type="MARKET", limit_price=None), ref_price=None)
    assert v.action == "confirm" and "size this market order" in v.reason


# ---- stop-direction ----------------------------------------------------------
def test_wrong_side_sell_stop_is_rejected():
    v = evaluate_order(_intent(side="SELL", order_type="STOP", limit_price=None, stop_price=105.0), ref_price=100.0)
    assert v.action == "reject" and "trigger immediately" in v.reason


def test_wrong_side_buy_stop_is_rejected():
    v = evaluate_order(_intent(side="BUY", order_type="STOP", limit_price=None, stop_price=95.0), ref_price=100.0)
    assert v.action == "reject" and "trigger immediately" in v.reason


def test_correct_side_sell_stop_is_ok():
    assert evaluate_order(_intent(side="SELL", order_type="STOP", limit_price=None, stop_price=95.0), ref_price=100.0).ok


def test_wrong_side_stop_rejects_even_when_confirmed():
    # The hard wrong-side reject is not overridable by confirm.
    v = evaluate_order(_intent(side="SELL", order_type="STOP", limit_price=None, stop_price=105.0), ref_price=100.0, confirm=True)
    assert v.action == "reject"


def test_stop_without_a_quote_asks_confirm_then_passes_on_confirm():
    i = _intent(side="SELL", order_type="STOP", limit_price=None, stop_price=105.0)
    assert evaluate_order(i, ref_price=None).action == "confirm"
    assert evaluate_order(i, ref_price=None, confirm=True).ok


# ---- held-shares -------------------------------------------------------------
def test_sell_within_held_is_ok():
    assert check_held(10, held=10).ok


def test_sell_beyond_held_is_rejected():
    v = check_held(15, held=10)
    assert v.action == "reject" and "avoid a short" in v.reason


def test_unverifiable_held_is_rejected_with_the_verb():
    assert "sell refused" in check_held(10, held=None, verb="sell").reason
    assert "modify refused" in check_held(10, held=None, verb="modify").reason


def test_single_order_defaults_are_the_documented_thresholds():
    assert SINGLE_ORDER_GUARDS.fatfinger_pct == 0.20
    assert SINGLE_ORDER_GUARDS.notional_confirm == 10_000.0
