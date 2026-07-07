"""Pure math behind the Trades streak/drawdown stats (W26-2)."""
from datetime import date

from app.ledger import _best_worst_periods, compute_drawdown, compute_streaks


# ---- streaks ----

def test_streaks_empty():
    assert compute_streaks([]) == {"longest_win": 0, "longest_loss": 0, "current": 0}


def test_streaks_all_wins():
    s = compute_streaks([10, 5, 1])
    assert s == {"longest_win": 3, "longest_loss": 0, "current": 3}


def test_streaks_mixed_and_current_loss():
    # W W L W W W W L L
    s = compute_streaks([1, 1, -1, 2, 2, 2, 2, -3, -3])
    assert s["longest_win"] == 4
    assert s["longest_loss"] == 2
    assert s["current"] == -2


def test_streaks_zero_breaks_both():
    s = compute_streaks([5, 5, 0, 5])
    assert s["longest_win"] == 2 and s["current"] == 1


# ---- drawdown ----

def _d(day):
    return date(2026, 1, day)


def test_drawdown_needs_two_points():
    assert compute_drawdown([]) is None
    assert compute_drawdown([(_d(1), 100.0)]) is None


def test_drawdown_monotonic_rise_is_zero():
    dd = compute_drawdown([(_d(1), 100.0), (_d(2), 110.0), (_d(3), 120.0)])
    assert dd["max_dd"] == 0.0 and dd["current_dd"] == 0.0
    assert dd["peak_date"] == _d(3).isoformat()


def test_drawdown_peak_trough_recovery():
    # 100 → 130 → 91 (deepest: 39 off the 130 peak) → 120 (current: 10 below)
    dd = compute_drawdown([(_d(1), 100.0), (_d(2), 130.0), (_d(3), 91.0), (_d(4), 120.0)])
    assert dd["max_dd"] == 39.0
    assert dd["max_dd_pct"] == 0.3
    assert dd["max_dd_date"] == _d(3).isoformat()
    assert dd["current_dd"] == 10.0
    assert dd["peak_date"] == _d(2).isoformat()
    assert dd["as_of"] == _d(4).isoformat()


def test_drawdown_new_high_resets_current():
    dd = compute_drawdown([(_d(1), 100.0), (_d(2), 80.0), (_d(3), 140.0)])
    assert dd["max_dd"] == 20.0 and dd["current_dd"] == 0.0


# ---- best/worst day + week ----

def test_periods_empty():
    p = _best_worst_periods({})
    assert p == {"best_day": None, "worst_day": None, "best_week": None, "worst_week": None}


def test_periods_days_and_weeks():
    # Mon Jan 5 + Tue Jan 6 (same ISO week), Mon Jan 12 (next week)
    profits = {date(2026, 1, 5): 100.0, date(2026, 1, 6): -40.0, date(2026, 1, 12): 30.0}
    p = _best_worst_periods(profits)
    assert p["best_day"] == {"period": "2026-01-05", "profit": 100.0}
    assert p["worst_day"] == {"period": "2026-01-06", "profit": -40.0}
    assert p["best_week"] == {"period": "2026-01-05", "profit": 60.0}   # 100 - 40
    assert p["worst_week"] == {"period": "2026-01-12", "profit": 30.0}
