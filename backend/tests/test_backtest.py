"""Ladder backtest simulator — hand-computed against the default strategy config
(rung-2 drop 10%, sizing $500 for rungs 1-2, sell dollar_gain $50, deployment
scaling on)."""
from __future__ import annotations

import pytest

from app.strategy.backtest import simulate
from app.strategy.config import StrategyConfig

CFG = StrategyConfig.load()


def test_single_round_trip():
    # Buy rung 1 at $10 ($500 -> 50 sh); target = 10 + 50/50 = $11; sell at $12.
    r = simulate([10.0, 12.0], CFG, start_cash=1000.0)
    assert r["ok"] is True
    assert r["round_trips"] == 1 and r["win_rate"] == 1.0
    assert r["realized"] == pytest.approx(100.0)          # (12-10)*50
    assert r["ending_equity"] == pytest.approx(1100.0)
    assert r["total_return"] == pytest.approx(0.10)
    assert r["buy_hold_equity"] == pytest.approx(1200.0)  # same $ all-in and held
    assert r["buy_hold_return"] == pytest.approx(0.20)
    assert r["max_lots_deep"] == 1 and r["open_lots"] == 0
    assert r["max_drawdown"] == pytest.approx(0.0)


def test_ladder_down_then_lifo_cascade_sell():
    # $10 -> $9 (triggers rung 2 at 10*(1-10%)=9.0) -> $12 sells BOTH lots LIFO.
    r = simulate([10.0, 9.0, 12.0], CFG, start_cash=2000.0)
    assert r["max_lots_deep"] == 2
    assert r["round_trips"] == 2 and r["win_rate"] == 1.0
    # rung2: 500/9=55.55sh, sold @12 -> +166.67; rung1: 50sh @10 sold @12 -> +100.
    assert r["realized"] == pytest.approx(266.67, abs=0.01)
    assert r["ending_equity"] == pytest.approx(2266.67, abs=0.01)
    assert r["open_lots"] == 0
    assert r["max_drawdown"] == pytest.approx(0.025, abs=0.001)   # -2.5% at the $9 bar


def test_cash_dry_blocks_further_buys():
    # $700 bankroll funds only the first $500 rung; deeper dips can't be bought.
    r = simulate([10.0, 9.0, 8.1, 7.29], CFG, start_cash=700.0)
    assert r["max_lots_deep"] == 1          # never affords rung 2
    assert r["open_lots"] == 1
    assert r["round_trips"] == 0 and r["win_rate"] is None
    assert r["ending_equity"] < r["start_cash"]
    assert r["max_drawdown"] > 0


def test_curve_has_equity_and_hold():
    r = simulate([10.0, 11.0, 12.0], CFG, start_cash=1000.0, labels=["a", "b", "c"])
    assert [pt["t"] for pt in r["curve"]] == ["a", "b", "c"]
    assert r["curve"][0]["hold"] == pytest.approx(1000.0)   # base bar
    assert r["curve"][-1]["hold"] == pytest.approx(1200.0)  # +20% at $12


def test_guards():
    assert simulate([], CFG, 1000.0)["ok"] is False
    assert simulate([10.0, 11.0], CFG, 0.0)["ok"] is False
    assert simulate([0.0, 0.0], CFG, 1000.0)["ok"] is False
