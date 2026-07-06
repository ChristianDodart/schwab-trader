from datetime import date, datetime, timezone

from app.fill_store import (api_trade_date, day_key, dedupe_incoming, group_key,
                            parse_csv_trades, resolve_group_conflicts)

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


def test_group_conflicts_resolved_by_share_totals():
    d = date(2026, 7, 6)
    # Partial fill: ONE 11-share CSV row vs TWO API legs (5+6). Totals equal → API
    # wins the group, CSV row dropped.
    csv_fill = {"trade_date": d, "symbol": "IREN", "side": "SELL", "shares": 11.0, "price": 43.8}
    other_day = {"trade_date": date(2026, 7, 2), "symbol": "IREN", "side": "SELL", "shares": 3.0, "price": 40.0}
    other_side = {"trade_date": d, "symbol": "IREN", "side": "BUY", "shares": 2.0, "price": 43.0}
    api_totals = {group_key(d, "IREN", "SELL"): 11.0}   # 5 + 6
    kept, dropped = resolve_group_conflicts([csv_fill, other_day, other_side], api_totals)
    assert dropped == 1
    assert kept == [other_day, other_side]   # different day / side untouched


def test_partial_api_group_does_not_evict_complete_csv():
    # The live GVH case: the API's first-sync window starts MID-DAY (it queries by
    # entered time), so on the boundary day it returned the 13,903-share sell but
    # MISSED the 1,000-share sell entered before the cutoff. CSV total (14,903) >
    # API total (13,903) → the CSV keeps the group; blind 'API owns it' would have
    # deleted a real 1,000-share sell.
    d = date(2025, 7, 10)
    csv_rows = [
        {"trade_date": d, "symbol": "GVH", "side": "SELL", "shares": 13903.0, "price": 0.0821},
        {"trade_date": d, "symbol": "GVH", "side": "SELL", "shares": 1000.0, "price": 0.0825},
    ]
    api_totals = {group_key(d, "GVH", "SELL"): 13903.0}
    kept, dropped = resolve_group_conflicts(csv_rows, api_totals)
    assert dropped == 0 and len(kept) == 2   # CSV is the more complete source — keep it


def test_reimport_is_idempotent_by_construction():
    # Import #1's fills become the existing keys for import #2 of the SAME file →
    # everything is skipped.
    p = parse_csv_trades(CSV)
    existing = [f["dkey"] for f in p["fills"]]
    fresh, skipped = dedupe_incoming(p["fills"], existing)
    assert fresh == [] and skipped == 4


def test_api_trade_date_is_eastern_not_utc():
    # An after-hours fill at 7:30pm ET on Jan 9 is 00:30 UTC on Jan 10. Schwab's
    # ledger (and the CSV) date it Jan 9 — the trade_date must match or the
    # cross-source dedup group misses and the trade double-counts (live bug, v0.22.1).
    evening = datetime(2026, 1, 10, 0, 30, tzinfo=timezone.utc)
    assert api_trade_date(evening) == date(2026, 1, 9)
    # A regular-hours fill (2pm ET = 19:00 UTC) stays on its own day.
    midday = datetime(2026, 1, 9, 19, 0, tzinfo=timezone.utc)
    assert api_trade_date(midday) == date(2026, 1, 9)
    # Naive datetimes are assumed UTC (that's how the DB stores them).
    assert api_trade_date(datetime(2026, 1, 10, 0, 30)) == date(2026, 1, 9)
    # DST: July — 7:30pm ET = 23:30 UTC same day; 8:30pm ET = 00:30 UTC next day.
    assert api_trade_date(datetime(2026, 7, 7, 0, 30, tzinfo=timezone.utc)) == date(2026, 7, 6)


# --- corporate actions + shorts (shapes taken verbatim from a real export) ---

SPLIT_CSV = '''"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"05/19/2026","Cash In Lieu","PPCB","PROPANC BIOPHARMA INC","","","","$0.68"
"05/18/2026","Reverse Split","PPCB","PROPANC BIOPHARMA INC","587","","",""
"05/18/2026","Reverse Split","74346N701","PROPANC BIOPHARMA INCXXXREVERSE SPLIT EFF: 05/18/26","-14,684","","",""
"05/01/2026","Buy","PPCB","PROPANC BIOPHARMA INC","14,684","$0.034","","-$499.26"
'''


def test_reverse_split_pairs_and_rescales():
    p = parse_csv_trades(SPLIT_CSV)
    assert p["ok"] and p["splits"] == 1 and p["unmatched_splits"] == 0
    splt = next(f for f in p["fills"] if f["side"] == "SPLT")
    assert splt["symbol"] == "PPCB" and splt["shares"] == 14684 * 0 + 587 and splt["price"] == 14684

    # Reconstruction: 14,684 @ $0.034 then a 25:1-ish reverse split → 587 shares at
    # a rescaled price; COST BASIS IS PRESERVED (no realized P/L).
    from app.reconstruct import Fill, reconstruct
    fills = [Fill(symbol=f["symbol"], side=f["side"], shares=f["shares"], price=f["price"], at=f["at"])
             for f in p["fills"]]
    r = reconstruct(fills)
    assert r["closed"] == [] and r["oversold"] == []
    lots = r["open_lots"]["PPCB"]
    assert len(lots) == 1
    assert abs(lots[0].shares - 587.0) < 0.5           # fractional remainder is cash-in-lieu
    basis = lots[0].shares * lots[0].price
    assert abs(basis - 14684 * 0.034) < 0.01           # basis invariant


def test_split_applies_before_same_day_sell():
    csv = '''"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"05/18/2026","Sell","PPCB","PROPANC BIOPHARMA INC","587","$1.00","","$587.00"
"05/18/2026","Reverse Split","PPCB","PROPANC BIOPHARMA INC","587","","",""
"05/18/2026","Reverse Split","74346N701","PROPANCXXXREVERSE SPLIT EFF: 05/18/26","-14,684","","",""
"05/01/2026","Buy","PPCB","PROPANC BIOPHARMA INC","14,684","$0.034","","-$499.26"
'''
    from app.reconstruct import Fill, reconstruct
    p = parse_csv_trades(csv)
    fills = [Fill(symbol=f["symbol"], side=f["side"], shares=f["shares"], price=f["price"], at=f["at"])
             for f in p["fills"]]
    r = reconstruct(fills)
    # Split rescales FIRST, so the same-day 587-share sell closes the whole position.
    assert not r["oversold"]
    assert "PPCB" not in r["open_lots"] or sum(l.shares for l in r["open_lots"]["PPCB"]) < 1


SHORT_CSV = '''"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"01/30/2026","Buy","RUN","SUNRUN INC","100","$19.50","","-$1950.00"
"01/28/2026","Sell Short","RUN","SUNRUN INC","100","$21.62","$0.02","$2161.98"
"01/10/2026","Sell","IREN","IREN LTD F","5","$50.00","","$250.00"
"01/05/2026","Buy","IREN","IREN LTD F","5","$45.00","","-$225.00"
'''


def test_short_cover_netting():
    p = parse_csv_trades(SHORT_CSV)
    assert p["shorts_excluded"] == 1
    assert p["covers_netted"] == 100          # the 100-share buy covered the short
    assert p["short_still_open"] == {}
    # RUN contributes NO long fills; IREN's real long round-trip is intact.
    syms = [(f["symbol"], f["side"], f["shares"]) for f in p["fills"]]
    assert ("RUN", "BUY", 100) not in syms
    assert ("IREN", "BUY", 5) in syms and ("IREN", "SELL", 5) in syms


def test_partial_cover_leaves_long_remainder():
    csv = '''"Date","Action","Symbol","Description","Quantity","Price","Fees & Comm","Amount"
"01/30/2026","Buy","RUN","SUNRUN INC","150","$19.50","","-$2925.00"
"01/28/2026","Sell Short","RUN","SUNRUN INC","100","$21.62","","$2162.00"
'''
    p = parse_csv_trades(csv)
    assert p["covers_netted"] == 100
    runs = [f for f in p["fills"] if f["symbol"] == "RUN"]
    assert len(runs) == 1 and runs[0]["side"] == "BUY" and runs[0]["shares"] == 50
