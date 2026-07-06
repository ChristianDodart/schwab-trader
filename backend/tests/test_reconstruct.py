from datetime import date

from app.reconstruct import Fill, reconstruct


def test_lifo_sell_retires_most_recent_lot():
    fills = [
        Fill("RCAT", "BUY", 10, 10.0, date(2026, 1, 1)),
        Fill("RCAT", "BUY", 5, 12.0, date(2026, 1, 2)),
        Fill("RCAT", "SELL", 5, 15.0, date(2026, 1, 3)),
    ]
    r = reconstruct(fills)
    # LIFO: the 12.0 lot (most recent) is sold
    assert len(r["closed"]) == 1
    t = r["closed"][0]
    assert t.buy_price == 12.0 and t.sell_price == 15.0 and t.shares == 5
    assert round(t.profit, 2) == 15.0
    # one open lot remains: the original 10@10, now rung 1
    assert list(r["open_lots"].keys()) == ["RCAT"]
    lot = r["open_lots"]["RCAT"][0]
    assert lot.shares == 10 and lot.price == 10.0 and lot.rung == 1
    assert r["oversold"] == []


def test_partial_sell_splits_a_lot():
    fills = [
        Fill("X", "BUY", 10, 10.0, date(2026, 1, 1)),
        Fill("X", "SELL", 4, 11.0, date(2026, 1, 2)),
    ]
    r = reconstruct(fills)
    assert r["closed"][0].shares == 4
    assert r["open_lots"]["X"][0].shares == 6  # remainder still open


def test_same_day_daytrade_buy_before_sell():
    fills = [
        Fill("Y", "SELL", 5, 10.0, date(2026, 1, 1)),  # listed first but BUY wins tie
        Fill("Y", "BUY", 5, 9.0, date(2026, 1, 1)),
    ]
    r = reconstruct(fills)
    assert "Y" not in r["open_lots"]            # fully closed
    assert round(r["closed"][0].profit, 2) == 5.0
    assert r["oversold"] == []


def test_oversell_is_flagged_not_crashed():
    r = reconstruct([Fill("Z", "SELL", 3, 10.0, date(2026, 1, 1))])
    assert r["oversold"] and r["oversold"][0][0] == "Z"
    assert r["closed"] == []


def test_rungs_assigned_oldest_first():
    fills = [
        Fill("A", "BUY", 1, 20.0, date(2026, 1, 1)),
        Fill("A", "BUY", 1, 18.0, date(2026, 1, 2)),
        Fill("A", "BUY", 1, 16.0, date(2026, 1, 3)),
    ]
    lots = reconstruct(fills)["open_lots"]["A"]
    assert [l.rung for l in lots] == [1, 2, 3]
    assert [l.price for l in lots] == [20.0, 18.0, 16.0]
