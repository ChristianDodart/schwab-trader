"""Pure-function tests for the money math the Ledger/Predictive views rely on:
progressive federal tax + income stacking, trading-day counts, period bucketing,
the 52wk median, and credential-secret encryption. All DB-free."""
from datetime import date

import pytest

from app.avg52 import _median
from app.ledger import _period_key, _progressive_federal, _tax, _weekdays


# ---------- progressive federal brackets (2025, single) ----------

def test_progressive_zero_income():
    assert _progressive_federal(0.0) == 0.0


def test_progressive_first_bracket_only():
    # Entirely inside the 10% bracket.
    assert _progressive_federal(10_000, "single") == pytest.approx(1_000.0)


def test_progressive_spans_brackets_single():
    # 50,000 single: 10% to 11,925 + 12% to 48,475 + 22% on the rest.
    expect = 11_925 * 0.10 + (48_475 - 11_925) * 0.12 + (50_000 - 48_475) * 0.22
    assert _progressive_federal(50_000, "single") == pytest.approx(expect)


def test_progressive_unknown_filing_falls_back_to_single():
    assert _progressive_federal(50_000, "nope") == _progressive_federal(50_000, "single")


# ---------- _tax: gains stack ON TOP of other income ----------

def test_tax_stacking_is_marginal_not_average():
    t = _tax(10_000, 0.045, "single", other_income=50_000)
    # Federal on the gain == tax(60k) - tax(50k), i.e. the gain lands in the 22% bracket.
    expect_fed = _progressive_federal(60_000, "single") - _progressive_federal(50_000, "single")
    assert t["federal_tax"] == pytest.approx(round(expect_fed, 2))
    assert t["state_tax"] == pytest.approx(450.0)      # flat 4.5% on the gain only
    assert t["total_tax"] == pytest.approx(round(expect_fed + 450.0, 2))
    assert t["after_tax_gain"] == pytest.approx(round(10_000 - expect_fed - 450.0, 2))


def test_tax_no_other_income_matches_plain_progressive():
    t = _tax(20_000, 0.0, "single")
    assert t["federal_tax"] == pytest.approx(round(_progressive_federal(20_000, "single"), 2))


def test_tax_negative_gain_yields_zero_never_negative():
    t = _tax(-5_000, 0.045, "single", other_income=100_000)
    assert t["federal_tax"] == 0.0
    assert t["state_tax"] == 0.0
    assert t["total_tax"] == 0.0
    assert t["effective_rate"] == 0.0


def test_tax_zero_gain_no_divide_by_zero():
    t = _tax(0.0, 0.045, "joint")
    assert t["effective_rate"] == 0.0 and t["total_tax"] == 0.0


# ---------- _weekdays: inclusive Mon-Fri counting ----------

def test_weekdays_single_weekday_and_weekend():
    assert _weekdays(date(2026, 7, 1), date(2026, 7, 1)) == 1   # Wednesday
    assert _weekdays(date(2026, 7, 4), date(2026, 7, 5)) == 0   # Sat-Sun


def test_weekdays_full_week_and_reversed_range():
    assert _weekdays(date(2026, 6, 29), date(2026, 7, 5)) == 5  # Mon..Sun
    assert _weekdays(date(2026, 7, 5), date(2026, 6, 29)) == 0  # b < a


def test_weekdays_full_year_2026():
    # 2026 starts on a Thursday: 52 full weeks (260) + 1 extra weekday.
    assert _weekdays(date(2026, 1, 1), date(2026, 12, 31)) == 261


def test_weekdays_partition_elapsed_plus_left_equals_year():
    # The projection splits the year at `today`; the two halves must tile exactly.
    from datetime import timedelta
    y0, y_end = date(2026, 1, 1), date(2026, 12, 31)
    for today in (date(2026, 1, 1), date(2026, 7, 1), date(2026, 12, 31)):
        assert (_weekdays(y0, today) + _weekdays(today + timedelta(days=1), y_end)
                == _weekdays(y0, y_end))


# ---------- _period_key: dialect-neutral bucketing ----------

def test_period_key_formats():
    d = date(2026, 1, 5)
    assert _period_key(d, "year") == "2026"
    assert _period_key(d, "month") == "2026-01"     # zero-padded
    assert _period_key(d, "day") == "2026-01-05"


def test_period_key_week_anchors_to_monday():
    # 2026-07-01 is a Wednesday; its ISO-week Monday is 2026-06-29.
    assert _period_key(date(2026, 7, 1), "week") == "2026-06-29"
    # A Monday maps to itself.
    assert _period_key(date(2026, 6, 29), "week") == "2026-06-29"


# ---------- 52wk median ----------

def test_median_odd_even_single():
    assert _median([3.0, 1.0, 2.0]) == 2.0
    assert _median([4.0, 1.0, 3.0, 2.0]) == 2.5
    assert _median([7.5]) == 7.5


# ---------- credential secret encryption ----------

def test_secret_roundtrip_and_legacy_plaintext(monkeypatch, tmp_path):
    from app import credentials, profiles

    # Isolate: fresh key in a temp dir, skip the icacls hardening subprocess.
    monkeypatch.setattr(profiles, "_TOKENS_DIR", tmp_path)
    monkeypatch.setattr(profiles, "_acl_hardened", True)

    enc = credentials._encrypt_secret("s3cret")
    assert enc.startswith(credentials._ENC_PREFIX) and "s3cret" not in enc
    assert credentials._decrypt_secret(enc) == "s3cret"
    # Legacy plaintext rows (pre-encryption) pass through unchanged.
    assert credentials._decrypt_secret("legacy-plain") == "legacy-plain"
    assert credentials._decrypt_secret(None) is None
    # A corrupted/foreign-key ciphertext degrades to None, not a crash.
    assert credentials._decrypt_secret(credentials._ENC_PREFIX + "garbage") is None
