"""Lock in the strategy math against the values validated from the sheet."""
from app.strategy import StrategyConfig, rules

cfg = StrategyConfig.load()


def test_buy_ladder_tier_drops_match_sheet():
    # RCAT rung 1 = 18.23 -> rung 2 is 10% down (Tier 1) = 16.41 (sheet's Buy Sug)
    assert round(rules.next_buy_price(18.23, 2, cfg), 2) == 16.41
    # rungs 3-7 use 13%; rungs 8-10 use 16%
    assert round(rules.next_buy_price(16.41, 3, cfg), 4) == round(16.41 * 0.87, 4)
    assert round(rules.next_buy_price(10.0, 8, cfg), 4) == round(10.0 * 0.84, 4)


def test_sizing_tiers_by_filled_rungs():
    assert rules.sizing_dollars(0, cfg) == 500    # next is rung 1
    assert rules.sizing_dollars(1, cfg) == 500    # next is rung 2
    assert rules.sizing_dollars(2, cfg) == 1000   # next is rung 3
    assert rules.sizing_dollars(6, cfg) == 1000   # next is rung 7
    assert rules.sizing_dollars(7, cfg) == 1500   # next is rung 8


def test_lilo_pct():
    # current above cheapest lot -> positive; below -> negative
    assert round(rules.lilo_pct(10.63, 10.85), 4) == round(10.63 / 10.85 - 1, 4)
    assert round(rules.lilo_pct(12.0, 10.0), 4) == 0.2


def test_sell_target_modes():
    # dollar-gain: buy 10, 5 shares, +$50 target -> 10 + 50/5 = 20
    assert rules.sell_target_price(10.0, 5, cfg, mode="dollar_gain") == 10.0 + cfg.sell.dollar_gain / 5
    # pct-above: 10 * (1 + 11%) = 11.1
    assert round(rules.sell_target_price(10.0, 5, cfg, mode="pct_above"), 4) == round(10.0 * (1 + cfg.sell.pct_above), 4)


def test_basis_per_share():
    assert rules.basis_per_share(1000.0, 100.0) == 10.0
    assert rules.basis_per_share(0.0, 0.0) == 0.0  # no divide-by-zero


def test_deployment_scaling_identity_when_unknown_or_disabled():
    # Unknown deployment (None) must never change the trigger, even with scaling enabled.
    assert rules.deployment_drop_multiplier(None, cfg) == 1.0
    assert rules.next_buy_price(18.23, 2, cfg, deployed_pct=None) == rules.next_buy_price(18.23, 2, cfg)
    # An explicitly-disabled config is a pure fixed ladder regardless of deployment.
    m = cfg.to_mapping()
    m["deployment_scaling"]["enabled"] = False
    disabled = StrategyConfig.from_mapping(m)
    assert rules.deployment_drop_multiplier(95.0, disabled) == 1.0
    assert rules.next_buy_price(18.23, 2, disabled, deployed_pct=95.0) == rules.next_buy_price(18.23, 2, disabled)


def test_deployment_scaling_when_enabled_scales_drops():
    m = cfg.to_mapping()
    m["deployment_scaling"] = {
        "enabled": True,
        "tiers": [
            {"min_deployed_pct": 90, "drop_multiplier": 1.4},
            {"min_deployed_pct": 70, "drop_multiplier": 1.15},
            {"min_deployed_pct": 0, "drop_multiplier": 1.0},
        ],
    }
    c = StrategyConfig.from_mapping(m)
    # tiers sorted descending on load
    assert [t.min_deployed_pct for t in c.deployment_scaling.tiers] == [90, 70, 0]
    # multiplier picks the first floor reached
    assert rules.deployment_drop_multiplier(95.0, c) == 1.4
    assert rules.deployment_drop_multiplier(75.0, c) == 1.15
    assert rules.deployment_drop_multiplier(10.0, c) == 1.0
    assert rules.deployment_drop_multiplier(None, c) == 1.0   # unknown deployment ⇒ no change
    # rung-2 base drop is 10%; at 95% deployed it's 10% * 1.4 = 14% ⇒ price * 0.86
    assert round(rules.next_buy_price(100.0, 2, c, deployed_pct=95.0), 4) == round(100.0 * (1 - 0.10 * 1.4), 4)
    # under the lowest floor, identical to the fixed ladder
    assert rules.next_buy_price(100.0, 2, c, deployed_pct=10.0) == rules.next_buy_price(100.0, 2, c)


def test_from_mapping_sorts_tiers_and_drops():
    # Engine matches the first tier in ascending order, so unsorted input (e.g. a
    # rung-3 tier added after rung-10 in the UI) must be normalized on load.
    m = cfg.to_mapping()
    m["sizing_tiers"] = [{"up_to_rungs": 10, "dollars": 1500},
                         {"up_to_rungs": 2, "dollars": 500},
                         {"up_to_rungs": 7, "dollars": 1000}]
    m["buy_ladder"]["drops"] = [{"up_to_rung": 10, "drop_pct": 0.16},
                                {"up_to_rung": 2, "drop_pct": 0.10}]
    c2 = StrategyConfig.from_mapping(m)
    assert [t.up_to_rungs for t in c2.sizing_tiers] == [2, 7, 10]
    assert [d.up_to_rung for d in c2.ladder_drops] == [2, 10]
    # and sizing still resolves correctly: 1 filled -> next rung 2 -> $500
    assert rules.sizing_dollars(1, c2) == 500
