"""The one canonical capital-deployment definition (LMV / equity), pure so the account-band
meter, the glossary, and ladder deployment-scaling all read the same number."""
from app.accounts import deployment_pct


def test_unknown_when_a_balance_is_missing_or_equity_is_zero():
    assert deployment_pct(None, 1000.0) is None
    assert deployment_pct(1000.0, None) is None
    assert deployment_pct(1000.0, 0.0) is None       # zero equity → unknown, not a div-by-zero


def test_fully_invested_reads_about_100():
    assert deployment_pct(1000.0, 1000.0) == 100.0


def test_partial_deployment():
    assert deployment_pct(2500.0, 10_000.0) == 25.0


def test_over_100_on_margin_and_uncapped():
    # $15k of longs on $10k equity = 150% deployed (stretched via margin) — never capped.
    assert deployment_pct(15_000.0, 10_000.0) == 150.0
