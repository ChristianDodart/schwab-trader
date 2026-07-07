"""Strategy-trigger edge detection — fire once per crossing, re-arm after it clears."""
from app.strategy_triggers import new_triggers, triggers_to_fire


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


def test_first_pass_for_account_seeds_silently():
    # No account seeded yet → the very first pass fires nothing, even if positions
    # are already sitting at a trigger.
    cur = {("A", "X", "buy"), ("A", "Y", "sell")}
    assert triggers_to_fire(cur, set(), "A", None) == set()


def test_account_switch_reseeds_no_burst():
    # Was seeded on account A; user switches to B whose positions are already
    # triggered. Comparing B's set against A's memory must NOT burst — re-seed instead.
    a_state = {("A", "X", "buy")}
    b_current = {("B", "P", "buy"), ("B", "Q", "sell")}
    assert triggers_to_fire(b_current, a_state, "B", "A") == set()


def test_same_account_still_fires_new_crossings():
    prev = {("A", "X", "buy")}
    cur = {("A", "X", "buy"), ("A", "Z", "sell")}
    assert triggers_to_fire(cur, prev, "A", "A") == {("A", "Z", "sell")}
