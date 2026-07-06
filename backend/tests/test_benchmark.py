"""Unit tests for the pure buy-and-hold benchmark math (app/benchmark.py)."""
from datetime import date

from app.benchmark import price_on_or_before, simulate, value_series
from app.xirr import xirr

CLOSES = [
    (date(2023, 1, 3), 100.0),
    (date(2023, 6, 1), 120.0),
    (date(2024, 1, 2), 150.0),
]


def test_price_on_or_before_exact_and_between():
    assert price_on_or_before(CLOSES, date(2023, 1, 3)) == 100.0
    assert price_on_or_before(CLOSES, date(2023, 3, 1)) == 100.0   # latest <= day
    assert price_on_or_before(CLOSES, date(2023, 6, 15)) == 120.0
    assert price_on_or_before(CLOSES, date(2025, 1, 1)) == 150.0   # after last → last


def test_price_before_history_is_none():
    assert price_on_or_before(CLOSES, date(2022, 12, 31)) is None


def test_simulate_single_deposit_doubles():
    # $1000 in at 100 → 10 shares; last price 200 → $2000.
    closes = [(date(2023, 1, 1), 100.0), (date(2024, 1, 1), 200.0)]
    r = simulate([(date(2023, 1, 1), 1000.0)], closes, 200.0)
    assert r is not None
    assert r["shares"] == 10.0
    assert r["value"] == 2000.0
    # terminal flow present, deposit is negative
    assert (date(2023, 1, 1), -1000.0) in r["flows"]


def test_simulate_roundtrips_through_xirr():
    closes = [(date(2023, 1, 1), 100.0), (date(2024, 1, 1), 110.0)]
    r = simulate([(date(2023, 1, 1), 1000.0)], closes, 110.0)
    assert r is not None
    rate = xirr(r["flows"])
    assert rate is not None and abs(rate - 0.10) < 1e-3   # 10% over the year


def test_simulate_bails_when_deposit_predates_history():
    closes = [(date(2023, 6, 1), 120.0)]
    # deposit in January but earliest close is June → can't price it → None
    assert simulate([(date(2023, 1, 1), 1000.0)], closes, 120.0) is None


def test_simulate_handles_withdrawal():
    closes = [(date(2023, 1, 1), 100.0), (date(2023, 6, 1), 100.0), (date(2024, 1, 1), 100.0)]
    # +1000 (10sh), then -500 (-5sh) → 5 shares, flat price → $500.
    r = simulate([(date(2023, 1, 1), 1000.0), (date(2023, 6, 1), -500.0)], closes, 100.0)
    assert r is not None
    assert r["shares"] == 5.0
    assert r["value"] == 500.0


def test_simulate_empty_or_no_price_is_none():
    assert simulate([], CLOSES, 150.0) is None
    assert simulate([(date(2023, 1, 3), 100.0)], CLOSES, None) is None
    assert simulate([(date(2023, 1, 3), 100.0)], [], 150.0) is None


def test_value_series_tracks_shares_and_marks_to_close():
    closes = [(date(2023, 1, 1), 100.0), (date(2023, 6, 1), 200.0), (date(2024, 1, 1), 400.0)]
    # $1000 in at 100 → 10 shares. Value marks up with the close.
    s = value_series([(date(2023, 1, 1), 1000.0)], closes)
    assert s == [(date(2023, 1, 1), 1000.0), (date(2023, 6, 1), 2000.0), (date(2024, 1, 1), 4000.0)]


def test_value_series_starts_at_first_contribution():
    closes = [(date(2023, 1, 1), 100.0), (date(2023, 6, 1), 100.0), (date(2024, 1, 1), 100.0)]
    s = value_series([(date(2023, 6, 1), 500.0)], closes)
    # nothing before the June deposit
    assert [d for d, _ in s] == [date(2023, 6, 1), date(2024, 1, 1)]
    assert s[0][1] == 500.0


def test_value_series_empty_inputs():
    assert value_series([], CLOSES) == []
    assert value_series([(date(2023, 1, 3), 100.0)], []) == []
