from app.config_store import _DEFAULTS, _sanitize_override, apply_symbol_override


def test_no_override_returns_global():
    assert apply_symbol_override(_DEFAULTS, None) is _DEFAULTS
    assert apply_symbol_override(_DEFAULTS, {}) is _DEFAULTS


def test_sell_override_dollar_gain():
    eff = apply_symbol_override(_DEFAULTS, {"sell_mode": "dollar_gain", "sell_value": 25.0})
    assert eff.sell.default_mode == "dollar_gain" and eff.sell.dollar_gain == 25.0
    assert eff.ladder_drops == _DEFAULTS.ladder_drops        # dips untouched
    assert _DEFAULTS.sell.dollar_gain == 50.0                # global unchanged (frozen)


def test_sell_override_pct_above():
    eff = apply_symbol_override(_DEFAULTS, {"sell_mode": "pct_above", "sell_value": 0.05})
    assert eff.sell.default_mode == "pct_above" and eff.sell.pct_above == 0.05
    # the other field keeps the global value
    assert eff.sell.dollar_gain == _DEFAULTS.sell.dollar_gain


def test_dip_scale_halves_every_drop():
    eff = apply_symbol_override(_DEFAULTS, {"dip_scale": 0.5})
    for orig, scaled in zip(_DEFAULTS.ladder_drops, eff.ladder_drops):
        assert abs(scaled.drop_pct - orig.drop_pct * 0.5) < 1e-9
        assert scaled.up_to_rung == orig.up_to_rung
    assert eff.sell == _DEFAULTS.sell                        # sell untouched


def test_dip_scale_clamped():
    eff = apply_symbol_override(_DEFAULTS, {"dip_scale": 99})
    assert abs(eff.ladder_drops[0].drop_pct - _DEFAULTS.ladder_drops[0].drop_pct * 3.0) < 1e-9


def test_sanitize_rejects_junk_and_keeps_valid():
    assert _sanitize_override({}) is None
    assert _sanitize_override({"sell_mode": "banana", "sell_value": 10}) is None
    assert _sanitize_override({"sell_mode": "dollar_gain", "sell_value": -5}) is None
    assert _sanitize_override({"dip_scale": 1.0}) is None    # 1.0 = global, not an override
    ov = _sanitize_override({"sell_mode": "pct_above", "sell_value": 0.06, "dip_scale": 0.5})
    assert ov == {"sell_mode": "pct_above", "sell_value": 0.06, "dip_scale": 0.5}
