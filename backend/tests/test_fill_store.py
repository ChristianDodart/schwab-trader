from datetime import date

from app.fill_store import day_key, dedupe_incoming, drop_api_owned, group_key, parse_csv_trades

CSV = '''"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"07/06/2026","Buy","RCAX","DEFIANCE DAILY TARGET 2XLONG RCAT ETF","90","$5.525","","-$497.25"
"07/06/2026","Sell","IREN","IREN LTD F","11","$43.80","$0.01","$481.79"
"07/01/2026 as of 06/30/2026","MoneyLink Transfer","","Tfr CAPITAL ONE","","","","$1000.00"
"06/30/2026","Sell","PLUG","PLUG PWR INC","1","$2.7401","","$2.74"
"06/30/2026","Buy","PLUG","PLUG PWR INC","1","$2.6919","","-$2.69"
"06/15/2026","Qualified Dividend","IREN","IREN LTD F","","","","$12.40"
'''


def test_parse_routes_trades_only():
    p = parse_csv_trades(CSV)
    assert p["ok"]
    fills = p["fills"]
    assert len(fills) == 4                       # 2 transfers/dividends excluded
    assert {f["side"] for f in fills} == {"BUY", "SELL"}
    assert p["other_actions"] == {"MoneyLink Transfer": 1, "Qualified Dividend": 1}
    assert p["coverage"]["from"] == date(2026, 6, 30)
    assert p["coverage"]["to"] == date(2026, 7, 6)
    rcax = next(f for f in fills if f["symbol"] == "RCAX")
    assert rcax["shares"] == 90 and rcax["price"] == 5.525
    assert rcax["trade_date"] == date(2026, 7, 6)


def test_parse_same_day_duplicates_get_distinct_occurrences():
    dup = CSV + '"06/30/2026","Buy","PLUG","PLUG PWR INC","1","$2.6919","","-$2.69"\n'
    p = parse_csv_trades(dup)
    keys = [f["fill_key"] for f in p["fills"] if f["symbol"] == "PLUG" and f["side"] == "BUY"]
    assert len(keys) == 2 and len(set(keys)) == 2   # #0 and #1 — both kept, distinct


def test_parse_rejects_garbage():
    assert not parse_csv_trades("")["ok"]
    assert not parse_csv_trades("hello,world\n1,2")["ok"]


def test_dedupe_multiset_counting():
    d = date(2026, 6, 30)
    k = day_key(d, "PLUG", "BUY", 1, 2.6919)
    incoming = [{"dkey": k, "n": 1}, {"dkey": k, "n": 2},
                {"dkey": day_key(d, "PLUG", "SELL", 1, 2.7401), "n": 3}]
    # Ledger already knows ONE of the two identical buys (e.g. from the API) → skip
    # exactly one occurrence, keep the second + the sell.
    fresh, skipped = dedupe_incoming(incoming, [k])
    assert skipped == 1
    assert [f["n"] for f in fresh] == [2, 3]
    # Knowing both → both skipped.
    fresh2, skipped2 = dedupe_incoming(incoming, [k, k])
    assert skipped2 == 2 and [f["n"] for f in fresh2] == [3]
    # Knowing none → nothing skipped.
    fresh3, skipped3 = dedupe_incoming(incoming, [])
    assert skipped3 == 0 and len(fresh3) == 3


def test_api_owns_its_day_groups():
    # An order that partially filled shows as ONE 11-share CSV row but TWO API legs
    # (5 + 6) — exact matching can't pair them. The group rule drops the CSV row
    # because the API covers (day, symbol, side) completely.
    d = date(2026, 7, 6)
    csv_fill = {"trade_date": d, "symbol": "IREN", "side": "SELL", "shares": 11.0, "price": 43.8}
    other_day = {"trade_date": date(2026, 7, 2), "symbol": "IREN", "side": "SELL", "shares": 3.0, "price": 40.0}
    other_side = {"trade_date": d, "symbol": "IREN", "side": "BUY", "shares": 2.0, "price": 43.0}
    api_groups = {group_key(d, "IREN", "SELL")}
    kept, dropped = drop_api_owned([csv_fill, other_day, other_side], api_groups)
    assert dropped == 1
    assert kept == [other_day, other_side]   # different day / side untouched


def test_reimport_is_idempotent_by_construction():
    # Import #1's fills become the existing keys for import #2 of the SAME file →
    # everything is skipped.
    p = parse_csv_trades(CSV)
    existing = [f["dkey"] for f in p["fills"]]
    fresh, skipped = dedupe_incoming(p["fills"], existing)
    assert fresh == [] and skipped == 4
