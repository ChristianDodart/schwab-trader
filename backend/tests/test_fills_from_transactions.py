"""fills_from_transactions: map Schwab TRADE transactions → long-only Fills.
Shapes mirror the live probe of Christian's account (2026-07)."""
from app.fills import fills_from_transactions


def _trade(sym, amount, price, pe, asset="EQUITY", oid="1", time="2026-07-20T19:53:52+0000",
           fees=(("SEC_FEE", -0.01),)):
    items = [{"instrument": {"assetType": "CURRENCY", "symbol": "CURRENCY_USD"}, "feeType": ft, "cost": c}
             for ft, c in fees]
    items.append({"instrument": {"assetType": asset, "symbol": sym},
                  "amount": amount, "cost": -amount * price, "price": price, "positionEffect": pe})
    return {"type": "TRADE", "orderId": oid, "time": time, "tradeDate": time, "transferItems": items}


def test_buy_and_sell_sides_from_amount_and_position_effect():
    txns = [
        _trade("QBTS", 18.0, 16.795, "OPENING"),    # +/OPENING → BUY
        _trade("RCAT", -50.0, 7.766, "CLOSING"),    # -/CLOSING → SELL
    ]
    fills = fills_from_transactions(txns)
    assert [(f.symbol, f.side, f.shares, f.price) for f in fills] == [
        ("QBTS", "BUY", 18.0, 16.795), ("RCAT", "SELL", 50.0, 7.766)]


def test_collective_investment_etf_is_included():
    # The bug the reconcile harness caught: ETFs are assetType COLLECTIVE_INVESTMENT,
    # not EQUITY — they must still produce fills (the ladder is share-based).
    fills = fills_from_transactions([_trade("LUNR", -6.0, 74.8, "CLOSING", asset="COLLECTIVE_INVESTMENT")])
    assert [(f.symbol, f.side, f.shares) for f in fills] == [("LUNR", "SELL", 6.0)]


def test_shorts_and_covers_skipped_long_only():
    txns = [
        _trade("XYZ", -10.0, 5.0, "OPENING"),   # short open  (-/OPENING) → skip
        _trade("XYZ", 10.0, 4.0, "CLOSING"),    # cover       (+/CLOSING) → skip
    ]
    assert fills_from_transactions(txns) == []


def test_options_futures_forex_skipped():
    assert fills_from_transactions([_trade("SPY 250101C", 1.0, 5.0, "OPENING", asset="OPTION")]) == []


def test_price_and_time_carry_through_for_fill_key_parity():
    # at must come from execution `time` so the derived fill_key matches the orders path.
    f = fills_from_transactions([_trade("AAPL", 3.0, 100.0, "OPENING", oid="42",
                                        time="2026-07-07T15:07:35+0000")])[0]
    assert f.order_id == "42" and f.order_type == "TRADE"
    assert f.at.isoformat() == "2026-07-07T15:07:35+00:00"


def test_non_trade_and_legless_records_ignored():
    txns = [
        {"type": "DIVIDEND_OR_INTEREST", "netAmount": 5.0, "transferItems": []},
        {"type": "TRADE", "orderId": "9", "time": "2026-07-01T14:00:00+0000",
         "transferItems": [{"instrument": {"assetType": "CURRENCY"}, "feeType": "COMMISSION", "cost": 0}]},
    ]
    assert fills_from_transactions(txns) == []


def test_recovered_qbtx_buys_the_orders_api_missed():
    # The 2 fills orders dropped but transactions has (validated live).
    txns = [
        _trade("QBTX", 5.0, 10.61, "OPENING", oid="a", time="2026-07-08T14:00:00+0000"),
        _trade("QBTX", 38.0, 10.62, "OPENING", oid="b", time="2026-07-08T14:05:00+0000"),
    ]
    fills = fills_from_transactions(txns)
    assert len(fills) == 2 and all(f.side == "BUY" and f.symbol == "QBTX" for f in fills)
