"""Watchlist board pure helpers — universe verdict + ladder fitness scoring."""
from __future__ import annotations

from app.screener import ladder_fitness, universe_verdict

UNI = {"market_cap_min": 1e9, "market_cap_max": 3e10, "country": "US",
       "exclude": ["china", "biotech"]}


# --- universe_verdict --------------------------------------------------------
def test_universe_pass():
    v = universe_verdict(5e9, "Technology", False, UNI)
    assert v == {"passes": True, "reasons": []}


def test_universe_flags_etf_and_cap_and_sector():
    assert universe_verdict(5e9, "Technology", True, UNI)["reasons"] == ["ETF (outside your stock universe)"]
    assert "below" in universe_verdict(5e8, "Technology", False, UNI)["reasons"][0]
    assert "above" in universe_verdict(5e10, "Technology", False, UNI)["reasons"][0]
    # "biotech" is a substring of the sector name → excluded.
    assert any("excluded sector" in r for r in universe_verdict(5e9, "Biotechnology", False, UNI)["reasons"])


# --- ladder_fitness ----------------------------------------------------------
def test_fitness_too_few_bars():
    assert ladder_fitness([100.0] * 10, [1_000_000] * 10) == {"ok": False}


def test_fitness_quiet_low_vol():
    # +0.5%/day, liquid → very low volatility → "quiet"; last bar is the high.
    closes = [100 * (1.005 ** i) for i in range(40)]
    r = ladder_fitness(closes, [2_000_000] * 40)
    assert r["ok"] and r["label"] == "quiet"
    assert r["volatility"] < 0.25 and r["pct_off_high"] == 0.0


def test_fitness_hot_high_vol():
    # alternating +/-8% daily → very high annualized volatility → "hot".
    closes, p = [100.0], 100.0
    for i in range(40):
        p *= 1.08 if i % 2 == 0 else 0.92
        closes.append(p)
    r = ladder_fitness(closes, [5_000_000] * len(closes))
    assert r["ok"] and r["label"] == "hot" and r["volatility"] > 0.80


def test_fitness_thin_illiquid():
    closes = [100 * (1.01 ** i) for i in range(40)]
    r = ladder_fitness(closes, [200] * 40)          # ~$20k/day → thin wins regardless of vol
    assert r["ok"] and r["label"] == "thin" and r["avg_dollar_vol"] < 500_000


def test_fitness_pct_off_high():
    closes = [100.0] * 30 + [80.0]                  # dropped 20% from its high on the last bar
    r = ladder_fitness(closes, [3_000_000] * 31)
    assert r["pct_off_high"] == 0.2
