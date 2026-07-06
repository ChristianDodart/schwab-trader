"""Strategy-trigger edge detection — fire once per crossing, re-arm after it clears."""
from app.strategy_triggers import new_triggers


def test_only_new_crossings_fire():
    prev = {("A", "RCAT", "buy")}
    cur = {("A", "RCAT", "buy"), ("A", "IREN", "sell")}
    # RCAT was already triggered → not fresh; IREN just crossed → fresh
    assert new_triggers(cur, prev) == {("A", "IREN", "sell")}


def test_cleared_then_recrossed_fires_again():
    # crossed
    assert new_triggers({("A", "X", "buy")}, set()) == {("A", "X", "buy")}
    # cleared (drops out of state), then re-crosses from empty → fires again
    assert new_triggers({("A", "X", "buy")}, set()) == {("A", "X", "buy")}


def test_no_change_no_fire():
    s = {("A", "X", "buy"), ("A", "Y", "sell")}
    assert new_triggers(s, s) == set()
