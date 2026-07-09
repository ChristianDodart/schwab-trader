"""Unit tests for reconstruct.reconcile_open_lots — aligning the fill-reconstructed
ladder to Schwab's authoritative current positions. Pure logic, no DB/API."""
from datetime import date

from app.reconstruct import OpenLot, reconcile_open_lots

H = date(2025, 7, 1)  # synthetic-lot horizon stamp


def _lot(sym, shares, price, rung=1):
    return OpenLot(sym, shares, price, date(2026, 6, 1), rung=rung)


def _total(lots):
    return round(sum(l.shares for l in lots), 4)


def test_match_is_unchanged():
    out = reconcile_open_lots({"RCAT": [_lot("RCAT", 10, 12.0)]}, {"RCAT": (10, 12.0)}, H)
    assert _total(out["RCAT"]) == 10
    assert all(l.source == "fill" for l in out["RCAT"])  # no backfill


def test_shortfall_backfills_prior_lot():
    # Schwab holds 30, fills only account for 10 → backfill 20 as a 'prior' lot.
    out = reconcile_open_lots({"RCAT": [_lot("RCAT", 10, 12.0)]}, {"RCAT": (30, 10.0)}, H)
    lots = out["RCAT"]
    assert _total(lots) == 30                          # total matches Schwab
    prior = [l for l in lots if l.source == "position"]
    assert len(prior) == 1 and prior[0].shares == 20
    assert prior[0].rung == 1                            # oldest → rung 1
    # residual cost: 30*10 - 10*12 = 180 over 20 shares = $9.00
    assert prior[0].price == 9.0


def test_fully_missing_position_becomes_one_prior_lot():
    # No fills at all (e.g. a managed account) → one prior lot = the whole position at avg.
    out = reconcile_open_lots({}, {"QBTX": (15, 14.99)}, H)
    lots = out["QBTX"]
    assert len(lots) == 1 and lots[0].shares == 15
    assert lots[0].source == "position" and lots[0].price == 14.99 and lots[0].rung == 1


def test_overage_trims_newest_first():
    # Reconstructed 15 but Schwab holds 12 (a missed sell) → trim the newest lot.
    out = reconcile_open_lots(
        {"RCAT": [_lot("RCAT", 10, 10.0, rung=1), _lot("RCAT", 5, 11.0, rung=2)]},
        {"RCAT": (12, 10.5)}, H,
    )
    assert _total(out["RCAT"]) == 12
    assert all(l.source == "fill" for l in out["RCAT"])  # no backfill on overage


def test_zero_position_drops_symbol():
    # EXPLICITLY present with ~0 shares → genuinely sold out → drop.
    out = reconcile_open_lots({"RCAT": [_lot("RCAT", 10, 10.0)]}, {"RCAT": (0, 0.0)}, H)
    assert "RCAT" not in out


def test_absent_from_positions_keeps_fill_lots():
    # A symbol reconstructed from fills but MISSING from the positions snapshot (a
    # partial/degraded read) must NOT be dropped — omission is not authoritative-zero.
    out = reconcile_open_lots(
        {"RCAT": [_lot("RCAT", 10, 12.0)], "QBTX": [_lot("QBTX", 5, 15.0)]},
        {"RCAT": (10, 12.0)},   # QBTX omitted from the read
        H,
    )
    assert _total(out["RCAT"]) == 10
    assert "QBTX" in out and _total(out["QBTX"]) == 5      # kept, not silently deleted
    assert all(l.source == "fill" for l in out["QBTX"])    # untouched fill lots


def test_empty_positions_keeps_all_fill_lots():
    # An entirely empty positions map (degraded read) must not zero out the ladder.
    out = reconcile_open_lots(
        {"RCAT": [_lot("RCAT", 10, 12.0)], "QBTX": [_lot("QBTX", 5, 15.0)]},
        {}, H,
    )
    assert _total(out["RCAT"]) == 10 and _total(out["QBTX"]) == 5
    assert all(l.source == "fill" for lots in out.values() for l in lots)


def test_drop_absent_removes_sold_out_symbol():
    # With drop_absent=True the caller vouches for a VERIFIED, non-empty snapshot, so a
    # symbol Schwab omits is genuinely sold out → dropped instead of kept as a phantom.
    out = reconcile_open_lots(
        {"RCAT": [_lot("RCAT", 10, 12.0)], "QBTX": [_lot("QBTX", 5, 15.0)]},
        {"RCAT": (10, 12.0)},   # QBTX omitted from the read → sold out
        H, drop_absent=True,
    )
    assert _total(out["RCAT"]) == 10
    assert "QBTX" not in out                               # dropped, no phantom holding


def test_symbol_only_in_positions_is_added():
    out = reconcile_open_lots({"AAA": [_lot("AAA", 5, 5.0)]}, {"AAA": (5, 5.0), "BBB": (3, 20.0)}, H)
    assert _total(out["AAA"]) == 5
    assert _total(out["BBB"]) == 3 and out["BBB"][0].source == "position"
