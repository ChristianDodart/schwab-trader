"""Trade-activity parsing for the Schwab transactions feed — pure, dependency-free,
unit-tested.

The same 60-day transactions payload that provides transfers (accounts.fetch_transfers)
and dividends (dividends.parse_dividends) also carries the two cash effects the CSV
import captures but the live pulls historically dropped:

  * per-trade FEES (SEC/TAF cents on every sell) — in a TRADE transaction's
    transferItems as entries tagged with a ``feeType``;
  * MARGIN INTEREST — DIVIDEND_OR_INTEREST rows with a negative netAmount.

Ignoring them meant the ledger's cash identity was exact at CSV-import time and then
drifted until the next import. These parsers extract both so the identity stays
pinned continuously.

Day attribution uses the EASTERN calendar date, not UTC — an after-hours fill
timestamped 7pm ET is "tomorrow" in UTC, and a UTC-keyed fee bucket would disagree
with the CSV's day (the exact bug fill_store hit in v0.22.1, same fix)."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

_MARKET_DAY_TZ = ZoneInfo("America/New_York")

# other_cash row types this feed is authoritative for within its window. A pull (or a
# CSV import, which extends the same rule) REPLACES these rows across its day coverage
# rather than deduping row-by-row: both sources derive identical per-day sums from the
# same underlying Schwab records, so replacement can never fight, and a re-run/re-import
# is a perfect no-op.
REPLACE_TYPES = ("TRADE FEES", "MARGIN INTEREST")


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def eastern_day(t: dict) -> str | None:
    """A transaction's EASTERN calendar day (ISO) from tradeDate/time. Falls back to
    the raw date prefix when the timestamp won't parse."""
    raw = t.get("tradeDate") or t.get("time") or ""
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            return dt.astimezone(_MARKET_DAY_TZ).date().isoformat()
        return dt.date().isoformat()
    except ValueError:
        return str(raw)[:10] or None


def parse_trade_fees(data: list | None) -> list[dict]:
    """Per-day trade-fee totals from TRADE transactions → other_cash rows
    ``{day, amount(negative), type: "TRADE FEES"}``, sorted by day.

    A fee rides in transferItems as an entry carrying ``feeType`` (SEC_FEE, TAF_FEE,
    COMMISSION, ...); its cash effect is ``cost`` (falling back to ``amount``). Summed
    as magnitudes per Eastern day — the exact convention of the CSV import's
    "Fees & Comm" aggregation, so the two sources produce identical rows."""
    by_day: dict[str, float] = {}
    for t in data or []:
        if (t.get("type") or "").upper() != "TRADE":
            continue
        day = eastern_day(t)
        if not day:
            continue
        fees = 0.0
        for it in (t.get("transferItems") or []):
            if not it.get("feeType"):
                continue
            v = it.get("cost")
            if v in (None, 0, 0.0):
                v = it.get("amount")
            fees += abs(_f(v))
        if fees > 0:
            by_day[day] = by_day.get(day, 0.0) + fees
    return [{"day": day, "amount": round(-total, 2), "type": "TRADE FEES"}
            for day, total in sorted(by_day.items()) if round(total, 2) != 0]


def parse_margin_interest(data: list | None) -> list[dict]:
    """Margin-interest DEBITS from DIVIDEND_OR_INTEREST rows (negative netAmount whose
    description/type mentions interest) → other_cash rows
    ``{day, amount(negative), type: "MARGIN INTEREST"}``.

    Deliberately narrow: a negative income row that is NOT interest (a dividend
    reversal, foreign tax) is left for the CSV import to classify — mislabeling here
    would break replace-by-coverage dedup against the CSV's row types."""
    out: list[dict] = []
    for t in data or []:
        ty = (t.get("type") or "").upper()
        if "DIVIDEND" not in ty and "INTEREST" not in ty:
            continue
        amt = _f(t.get("netAmount"))
        if amt >= 0:
            continue
        # The description decides when present ("MARGIN INTEREST ADJUSTMENT" yes,
        # "FOREIGN TAX" no). Without one, only a SPECIFICALLY interest-typed row
        # counts — the combined DIVIDEND_OR_INTEREST enum contains "INTEREST" for
        # every dividend event too, so it alone proves nothing.
        desc = (t.get("description") or "").strip().upper()
        if desc:
            if "INTEREST" not in desc:
                continue
        elif "INTEREST" not in ty or ty == "DIVIDEND_OR_INTEREST":
            continue
        day = eastern_day(t)
        if not day:
            continue
        out.append({"day": day, "amount": round(amt, 2), "type": "MARGIN INTEREST"})
    out.sort(key=lambda r: r["day"])
    return out


def merge_window_rows(existing: list[dict], fresh: list[dict],
                      lo: str, hi: str,
                      types: tuple[str, ...] = REPLACE_TYPES) -> tuple[list[dict], int]:
    """Replace-by-coverage merge for other_cash rows: drop every existing row whose
    type is in ``types`` and whose day falls in [lo, hi], then append ``fresh`` (which
    must all carry those types). Pure.

    Returns (merged, net_new) where net_new counts only fresh rows that don't match a
    removed row by (day, amount, type) — so an unchanged re-pull reports 0."""
    from collections import Counter

    removed: Counter = Counter()
    kept: list[dict] = []
    for r in existing or []:
        if r.get("type") in types and lo <= str(r.get("day") or "") <= hi:
            removed[(str(r.get("day")), r.get("amount"), r.get("type"))] += 1
        else:
            kept.append(r)
    net_new = 0
    for r in fresh or []:
        k = (str(r.get("day")), r.get("amount"), r.get("type"))
        if removed.get(k, 0) > 0:
            removed[k] -= 1
        else:
            net_new += 1
    return kept + list(fresh or []), net_new
