"""The avg/median/high/low reference window: 13 weeks for leveraged/inverse ETFs
(daily-rebalancing decay makes a full year stale), 52 weeks for everything else.

Covers avg52.short_stats() reading the cached quarter figures and dashboard._ref_window
choosing the window by instrument type — including the honest fallback to 52wk when the
short window hasn't warmed yet."""
from __future__ import annotations

from types import SimpleNamespace

from app import avg52
from app.dashboard import _ref_window


def _seed(symbol: str, **vals) -> None:
    """Populate avg52's cache for a symbol as if a refresh had just run today."""
    base = {"mean": None, "median": None, "s_mean": None, "s_median": None,
            "s_high": None, "s_low": None, "days": 200, "asof": avg52._today()}
    base.update(vals)
    avg52._cache[symbol] = base


def test_short_stats_reads_quarter_window():
    _seed("LEVX", mean=10.0, median=10.0, s_mean=5.0, s_median=5.1, s_high=6.0, s_low=4.0)
    assert avg52.short_stats("levx") == {"mean": 5.0, "median": 5.1, "high": 6.0, "low": 4.0}
    avg52._cache.pop("LEVX", None)


def test_short_stats_none_until_warm():
    avg52._cache.pop("COLD", None)
    assert avg52.short_stats("COLD") is None


def test_ref_window_leveraged_etf_uses_13wk():
    _seed("RCATX", mean=10.0, median=10.0, s_mean=5.0, s_median=5.0, s_high=6.0, s_low=4.0)
    tk = SimpleNamespace(name="DEFIANCE DAILY TARGET 2X LONG RCAT ETF", industry=None, year_high=12.0)
    avg, med, hi, lo, weeks = _ref_window("RCATX", tk, {"yearHigh": 12.0, "yearLow": 3.0})
    assert (avg, med, hi, lo, weeks) == (5.0, 5.0, 6.0, 4.0, 13)  # 13wk figures, NOT the year
    avg52._cache.pop("RCATX", None)


def test_ref_window_plain_stock_uses_52wk():
    _seed("AAPL", mean=150.0, median=148.0, s_mean=170.0, s_median=170.0, s_high=175.0, s_low=165.0)
    tk = SimpleNamespace(name="Apple Inc", industry="Consumer Electronics", year_high=200.0)
    avg, med, hi, lo, weeks = _ref_window("AAPL", tk, {"yearHigh": 198.0, "yearLow": 120.0})
    # 52wk mean/median from the cache; high/low straight from the quote (true intraday).
    assert (avg, med, hi, lo, weeks) == (150.0, 148.0, 198.0, 120.0, 52)
    avg52._cache.pop("AAPL", None)


def test_ref_window_leveraged_but_cold_falls_back_to_52wk():
    avg52._cache.pop("NEWLEV", None)  # short window not warmed
    tk = SimpleNamespace(name="Tradr 2X Long QBTS Daily ETF", industry=None, year_high=None)
    avg, med, hi, lo, weeks = _ref_window("NEWLEV", tk, {"yearHigh": 9.0, "yearLow": 2.0})
    # No candles yet -> honest 52wk labeling with whatever the quote/cache give (avg/med None).
    assert (avg, med, hi, lo, weeks) == (None, None, 9.0, 2.0, 52)
