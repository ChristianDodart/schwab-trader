"""Schwab-style position day change (v0.31.x): value_now + today's sell proceeds
− today's buy cost − value at yesterday's close. Covers holds, same-day buys, and
intraday round-trips (realized-today must be included — the RCAX case)."""
from app.dashboard import position_day_change


def test_no_trades_today_is_prior_close_times_shares():
    # Held 100 from before today, up $0.50/sh vs prior close → +$50.
    assert position_day_change(0.50, 20.0, 100, 0.0, 0.0) == 50.0


def test_bought_today_measured_from_purchase_not_prior_close():
    # Bought 100 today at $19 (all still held); now $20. Day change = (20−19)*100 = +100.
    # net_change (vs prior close) is irrelevant to today's-bought shares.
    assert position_day_change(2.0, 20.0, 100, 100, 1900.0) == 100.0


def test_mixed_open_and_today():
    # 50 held from yesterday (net +$0.40 = +$20) + 50 bought today @ $19 now $20 (+$50) = +$70.
    r = position_day_change(0.40, 20.0, 100, 50, 950.0)
    assert round(r, 2) == 70.0


def test_intraday_round_trip_books_realized_even_when_flat():
    # Held 0 at open. Bought 100 @ $10 (cost 1000), sold 100 @ $11 (proceeds 1100),
    # net position 0. Realized +$100 must show as day change though shares_now == 0.
    r = position_day_change(0.0, 11.0, 0, 100, 1000.0, 100, 1100.0)
    assert round(r, 2) == 100.0


def test_partial_sell_then_still_holding():
    # Open 0; bought 200 @ $10 (2000), sold 100 @ $12 (1200), hold 100, now $11.
    # value_now 1100 + proceeds 1200 − cost 2000 − open 0 = +300.
    r = position_day_change(1.0, 11.0, 100, 200, 2000.0, 100, 1200.0)
    assert round(r, 2) == 300.0


def test_sold_some_of_yesterdays_shares():
    # Held 100 at open (prior close $10 → net +$1 now $11). Sold 40 @ $11 today, hold 60.
    # value_now 660 + proceeds 440 − cost 0 − open(100*10=1000) = +100 = net_change*100.
    r = position_day_change(1.0, 11.0, 60, 0.0, 0.0, 40, 440.0)
    assert round(r, 2) == 100.0


def test_loss_on_the_day():
    assert position_day_change(-0.75, 10.0, 40, 0.0, 0.0) == -30.0
