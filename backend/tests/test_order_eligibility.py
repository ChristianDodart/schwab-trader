"""Broker combo rules — the single (order type, session, duration) validity gate that
orders._build_order enforces on every path (single ticket, replace, bulk)."""
from app.order_eligibility import combo_error


# ---- valid combinations pass (None) -----------------------------------------
def test_market_in_normal_is_ok():
    assert combo_error("MARKET", "NORMAL", "DAY") is None


def test_limit_in_extended_is_ok():
    assert combo_error("LIMIT", "SEAMLESS", "DAY") is None
    assert combo_error("LIMIT", "AM", "DAY") is None
    assert combo_error("LIMIT", "PM", "DAY") is None


def test_gtc_in_normal_is_ok():
    assert combo_error("LIMIT", "NORMAL", "GOOD_TILL_CANCEL") is None


def test_every_type_is_fine_in_the_normal_session():
    for ot in ("MARKET", "STOP", "STOP_LIMIT", "TRAILING_STOP", "LIMIT"):
        assert combo_error(ot, "NORMAL", "DAY") is None


# ---- non-LIMIT can't ride an extended session -------------------------------
def test_market_in_extended_is_rejected():
    err = combo_error("MARKET", "AM", "DAY")
    assert err and "extended-hours session" in err and "limit order" in err


def test_stop_limit_in_extended_is_rejected():
    # STOP_LIMIT is limit-priced but still a triggered order — extended is plain LIMIT only.
    assert combo_error("STOP_LIMIT", "SEAMLESS", "DAY") is not None
    assert combo_error("TRAILING_STOP", "PM", "DAY") is not None


# ---- GTC can't ride an extended session -------------------------------------
def test_gtc_in_extended_is_rejected():
    for sess in ("AM", "PM", "SEAMLESS"):
        err = combo_error("LIMIT", sess, "GOOD_TILL_CANCEL")
        assert err and "good-till-canceled" in err


# ---- input hygiene: case-insensitive, blanks read as the safe defaults ------
def test_case_insensitive_and_blank_defaults():
    assert combo_error("market", "am", "day") is not None      # lowercased still rejected
    assert combo_error("MARKET", "", "") is None                # blank session/duration -> NORMAL/DAY
    assert combo_error("LIMIT", None, None) is None             # type: ignore[arg-type]
