"""Schwab-style position day change (v0.31.x): shares held since yesterday move
from the prior close; shares bought today move from their purchase price."""
from app.dashboard import position_day_change


def test_no_trades_today_is_prior_close_times_shares():
    # Held 100 from before today, up $0.50/sh vs prior close → +$50.
    assert position_day_change(0.50, 20.0, 100, 0.0, 0.0) == 50.0


def test_bought_today_measured_from_purchase_not_prior_close():
    # Bought 100 today at $19 (all still held); now $20. Day change = (20−19)*100 = +100,
    # NOT netChange*shares (which would over/under-count vs the prior close).
    # net_change here (vs prior close) is irrelevant to today's-bought shares.
    assert position_day_change(2.0, 20.0, 100, 100, 1900.0) == 100.0


def test_mixed_open_and_today():
    # 50 held from yesterday (net +$0.40 = +$20) + 50 bought today @ $19 now $20 (+$50) = +$70.
    r = position_day_change(0.40, 20.0, 100, 50, 950.0)
    assert round(r, 2) == 70.0


def test_bought_more_than_currently_held_clamps():
    # Bought 100 today but only 70 held now (sold 30 intraday). Treat the 70 as today's
    # (from avg cost); no negative "at open" shares.
    r = position_day_change(5.0, 20.0, 70, 100, 1900.0)   # avg today = 19
    assert round(r, 2) == round((20.0 - 19.0) * 70, 2)     # = 70.0


def test_loss_on_the_day():
    assert position_day_change(-0.75, 10.0, 40, 0.0, 0.0) == -30.0
