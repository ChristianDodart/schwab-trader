"""Tiny shared helpers used across the app — the two idioms that were previously
copy-pasted per module (nine `_f` definitions, four CSV column lookups) now live
here once, so a fix or behavior decision lands everywhere."""
from __future__ import annotations


def _f(x) -> float:
    """Coerce a DB Numeric / Schwab-API value / None to float; non-numeric junk → 0.0.

    The single blessed variant. Half the old copies raised on a malformed string
    (`float(x) if x is not None else 0.0`); this one treats it as zero instead —
    for display/aggregation math a corrupt cell should degrade, not 500 the API.
    """
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def csv_col(row: dict, name: str) -> str | None:
    """Case/space-tolerant column lookup for Schwab CSV headers
    (``csv_col(r, "fees & comm")`` matches ``"Fees & Comm"``)."""
    for k, v in row.items():
        if k and k.strip().lower() == name:
            return v
    return None
