"""Unit tests for the pure ticker risk classifier (app/risk.py)."""
from app.risk import classify


def test_broad_etf_is_low():
    assert classify("SPDR S&P 500 ETF Trust", "Asset Management", 5e11) == "low"
    assert classify("Vanguard Total Stock Market ETF", "", None) == "low"


def test_leveraged_inverse_etf_is_high():
    assert classify("ProShares UltraPro QQQ", "", 1e10) == "high"
    assert classify("Direxion Daily Semiconductor Bull 3X Shares", "", 5e9) == "high"
    assert classify("ProShares Short S&P500", "Exchange Traded Fund", 1e9) == "high"


def test_large_cap_stock_is_low():
    assert classify("Apple Inc.", "Consumer Electronics", 3e12) == "low"


def test_mid_cap_stock_is_medium():
    assert classify("Some Mid Co", "Software", 5e9) == "medium"


def test_small_cap_is_elevated():
    assert classify("Small Co", "Biotech", 1e9) == "elevated"


def test_micro_cap_is_high():
    assert classify("Tiny Co", "Mining", 1e8) == "high"


def test_unknown_is_medium():
    assert classify(None, None, None) == "medium"
    assert classify("Mystery Co", "", 0) == "medium"
