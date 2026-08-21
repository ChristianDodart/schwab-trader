"""Order-status classification — the one taxonomy the badge, cancel/edit guards, and the
fill poll all read from."""
from app.order_status import is_cancelable, is_settled, is_working


def test_working_is_the_live_allowlist():
    for s in ("WORKING", "QUEUED", "ACCEPTED", "PENDING_ACTIVATION",
              "AWAITING_PARENT_ORDER", "AWAITING_CONDITION", "AWAITING_MANUAL_REVIEW"):
        assert is_working(s)
    for s in ("FILLED", "CANCELED", "REJECTED", "EXPIRED", "REPLACED",
              "PENDING_CANCEL", "PENDING_REPLACE", "UNKNOWN", "SOMETHING_NEW", None):
        assert not is_working(s)


def test_settled_is_only_the_truly_final_states():
    for s in ("FILLED", "CANCELED", "REJECTED", "EXPIRED", "REPLACED"):
        assert is_settled(s)
    for s in ("WORKING", "PENDING_CANCEL", "PENDING_REPLACE", "UNKNOWN", None):
        assert not is_settled(s)


def test_cancelable_is_a_denylist_robust_to_new_statuses():
    assert is_cancelable("WORKING")
    assert not is_cancelable("FILLED")
    assert not is_cancelable("PENDING_CANCEL")
    assert not is_cancelable("UNKNOWN")
    # A live status Schwab adds later stays cancelable — the broker is the final authority.
    assert is_cancelable("SOME_NEW_LIVE_STATUS")
    # A missing status must not block the cancel (matches the prior behavior).
    assert is_cancelable(None)


def test_working_and_settled_never_overlap():
    for s in ("WORKING", "FILLED", "PENDING_CANCEL", "UNKNOWN"):
        assert not (is_working(s) and is_settled(s))
