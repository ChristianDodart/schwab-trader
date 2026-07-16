"""select_tradable_funds: pick the amount actually deployable now, preferring the
conservative non-marginable-trade availability over Reg-T buying power (which overstates
it and gets orders rejected — the reported bug)."""
from app.accounts import select_tradable_funds


def test_prefers_non_marginable_available_over_reg_t():
    # The reported account: Reg-T buying power ~620 but only ~155 truly usable.
    b = {
        "buying_power": 620.80,
        "available_funds": 620.00,
        "available_funds_non_marginable": 154.86,
        "buying_power_non_marginable": 155.00,
    }
    assert select_tradable_funds(b) == 154.86


def test_falls_back_through_the_chain():
    assert select_tradable_funds({"buying_power_non_marginable": 200.0, "buying_power": 800.0}) == 200.0
    assert select_tradable_funds({"available_funds": 300.0, "buying_power": 800.0}) == 300.0
    assert select_tradable_funds({"buying_power": 800.0}) == 800.0


def test_ignores_non_numeric_and_missing():
    assert select_tradable_funds({"available_funds_non_marginable": None, "buying_power": 500.0}) == 500.0
    assert select_tradable_funds({"available_funds_non_marginable": "n/a", "buying_power": 500.0}) == 500.0
    assert select_tradable_funds({}) is None


def test_zero_is_a_valid_answer_not_skipped():
    # A fully-deployed account legitimately has $0 to trade — must return 0.0, not fall
    # through to buying_power (which would wrongly say there's room).
    assert select_tradable_funds({"available_funds_non_marginable": 0, "buying_power": 800.0}) == 0.0
