"""fills_capable hint — parse/format round-trip + the probe decision (fail-safe)."""
from datetime import date

from app.fills_hint import format_hint, parse_hint, should_probe


def test_parse_format_roundtrip():
    assert parse_hint(format_hint(True, date(2026, 7, 5))) == (True, date(2026, 7, 5))
    assert parse_hint(format_hint(False, date(2026, 1, 2))) == (False, date(2026, 1, 2))


def test_parse_bad_values_are_unknown():
    for bad in (None, "", "nope", "2:2026-07-05", "1", "1:not-a-date"):
        cap, d = parse_hint(bad)
        # unknown flag ⇒ (None, None); a valid flag with a bad date keeps the flag, no date
        if bad == "1:not-a-date":
            assert cap is True and d is None
        else:
            assert cap is None and d is None


def test_should_probe_failsafe():
    today = date(2026, 7, 20)
    # Unknown → always probe (never skip on missing/garbled state)
    assert should_probe(None, None, today) is True
    # Known-capable → always probe (fills flow here)
    assert should_probe(True, today, today) is True
    # Known not-capable, probed today → skip
    assert should_probe(False, today, today) is False
    # Known not-capable, but stale (≥7d) → re-probe to rediscover
    assert should_probe(False, date(2026, 7, 12), today) is True   # 8 days
    assert should_probe(False, date(2026, 7, 14), today) is False  # 6 days
    # Known not-capable but NO date → probe (can't trust a dateless skip)
    assert should_probe(False, None, today) is True
