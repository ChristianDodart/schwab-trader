"""Notification delivery gate (W29-2): mute / per-category channel / per-symbol,
non-destructively (muted → recorded read, never badges). Pure-logic coverage."""
from app import notifications as n


def test_defaults_deliver_everything_except_fill_desktop():
    p = n._merge_prefs(None)
    assert n._gate(p, "alert", "AAA") == {"read": False, "desktop": True, "phone": True}
    assert n._gate(p, "trigger", "AAA") == {"read": False, "desktop": True, "phone": True}
    # Fills: bell + phone on, desktop OFF by default (frequent, low-urgency).
    assert n._gate(p, "fill", "AAA") == {"read": False, "desktop": False, "phone": True}


def test_global_mute_records_read_and_silences_channels():
    p = n._merge_prefs({"muted": True})
    g = n._gate(p, "trigger", "AAA")
    assert g == {"read": True, "desktop": False, "phone": False}


def test_symbol_mute_only_that_symbol():
    p = n._merge_prefs({"muted_symbols": ["tsla"]})   # case-insensitive
    assert n._gate(p, "alert", "TSLA") == {"read": True, "desktop": False, "phone": False}
    assert n._gate(p, "alert", "AAPL")["read"] is False


def test_category_bell_off_lands_read_but_channels_independent():
    # Bell off for triggers, desktop still on → recorded read (no badge) yet still pops.
    p = n._merge_prefs({"categories": {"trigger": {"bell": False, "desktop": True, "phone": False}}})
    g = n._gate(p, "trigger", "AAA")
    assert g["read"] is True and g["desktop"] is True and g["phone"] is False


def test_system_category_always_delivers():
    p = n._merge_prefs({"muted": True, "muted_symbols": ["AAA"]})
    # Re-auth nudges (system) bypass every mute.
    assert n._gate(p, "system", "AAA") == {"read": False, "desktop": True, "phone": True}


def test_merge_fills_partial_and_uppercases_symbols():
    p = n._merge_prefs({"muted_symbols": ["aaa", "bbb"], "categories": {"alert": {"desktop": False}}})
    assert p["muted_symbols"] == ["AAA", "BBB"]
    assert p["categories"]["alert"]["desktop"] is False      # patched
    assert p["categories"]["alert"]["bell"] is True          # default preserved
    assert p["categories"]["fill"]["desktop"] is False       # untouched default
