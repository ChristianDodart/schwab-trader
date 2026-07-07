"""Small helpers shared across the ledger package: the market-local calendar,
float coercion, period bucketing, and Schwab date/money parsing."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

# The trader's local market timezone — defines the calendar "day" for snapshots
# and same-day P&L so a UTC server doesn't bucket evening activity into tomorrow.
MARKET_TZ = ZoneInfo("America/Denver")  # user is in Utah (UT state tax below)


def _today() -> date:
    return datetime.now(MARKET_TZ).date()


def _f(x) -> float:
    return float(x) if x is not None else 0.0


_GRAINS = {"day": "day", "week": "week", "month": "month", "year": "year"}


def _period_key(d: date, grain: str) -> str:
    """Bucket a completed date into a period label. Done in Python (not SQL
    date_trunc) so it's dialect-neutral across Postgres and SQLite. Week = the
    Monday of that ISO week (matches Postgres date_trunc('week'))."""
    if grain == "year":
        return f"{d.year:04d}"
    if grain == "month":
        return f"{d.year:04d}-{d.month:02d}"
    if grain == "week":
        return (d - timedelta(days=d.weekday())).isoformat()
    return d.isoformat()  # day


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def _parse_money(s: str | None) -> float | None:
    """'$1,000.00' -> 1000.0, '-$2709.59' -> -2709.59, '($5.00)' -> -5.0."""
    s = (s or "").strip()
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace("$", "").replace(",", "").strip()
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def _parse_csv_date(s: str | None) -> date | None:
    """Schwab dates are 'MM/DD/YYYY' or 'MM/DD/YYYY as of MM/DD/YYYY'. The 'as of'
    date is the EFFECTIVE (value) date — prefer it when present."""
    s = (s or "").strip()
    if not s:
        return None
    s = s.split(" as of ", 1)[1].strip() if " as of " in s else s.split(" ", 1)[0].strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None
