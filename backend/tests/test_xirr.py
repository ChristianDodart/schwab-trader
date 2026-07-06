"""Unit tests for the pure XIRR solver (app/xirr.py)."""
from datetime import date

from app.xirr import _npv, xirr


def test_simple_10pct_over_one_year():
    # -100 in, +110 out exactly a (non-leap) year later → 10%/yr.
    r = xirr([(date(2023, 1, 1), -100.0), (date(2024, 1, 1), 110.0)])
    assert r is not None
    assert abs(r - 0.10) < 1e-4


def test_flat_is_zero():
    r = xirr([(date(2023, 1, 1), -100.0), (date(2024, 1, 1), 100.0)])
    assert r is not None
    assert abs(r) < 1e-4


def test_loss_is_negative():
    r = xirr([(date(2023, 1, 1), -100.0), (date(2024, 1, 1), 90.0)])
    assert r is not None
    assert abs(r - (-0.10)) < 1e-4


def test_multiple_contributions_roundtrips_to_zero_npv():
    flows = [
        (date(2023, 1, 1), -100.0),
        (date(2023, 7, 1), -100.0),
        (date(2024, 1, 1), 230.0),
    ]
    r = xirr(flows)
    assert r is not None and r > 0
    # The defining property: NPV at the solved rate is ~0.
    t0 = min(d for d, _ in flows)
    shifted = [((d - t0).days / 365.0, a) for d, a in flows]
    assert abs(_npv(r, shifted)) < 1e-3


def test_withdrawal_counts_as_positive_flow():
    # Deposit, partial withdrawal, then terminal value — should still solve.
    r = xirr([
        (date(2022, 1, 1), -1000.0),
        (date(2023, 1, 1), 200.0),     # withdrawal (cash back to investor)
        (date(2024, 1, 1), 1100.0),    # liquidation value
    ])
    assert r is not None and r > 0


def test_no_sign_change_returns_none():
    assert xirr([(date(2023, 1, 1), -100.0), (date(2024, 1, 1), -50.0)]) is None


def test_too_few_flows_returns_none():
    assert xirr([(date(2023, 1, 1), -100.0)]) is None
    assert xirr([]) is None


def test_all_same_day_still_handles_gracefully():
    # Everything today: t=0 for all → 1/(1+r)^0 = 1, NPV = sum(amounts), independent
    # of rate. Sum here is +10 (no root) → None rather than a bogus number.
    r = xirr([(date(2024, 1, 1), -100.0), (date(2024, 1, 1), 110.0)])
    assert r is None
