"""Money-weighted return (XIRR) — the internal rate of return over dated cash flows.

Simple ROI (gain / deposited) ignores WHEN money went in: $10k that worked for three
years and $10k added last week are treated identically. XIRR fixes that by finding the
single annual rate that discounts every dated flow back to zero — so a deposit made
recently barely counts, one made years ago counts fully.

Convention (investor's perspective): money you PUT IN is a negative flow, money you take
out (withdrawal) or the current liquidation value is a positive flow. Returns the annual
rate as a fraction (0.12 = 12%/yr), or None when it can't be solved (fewer than two flows,
no sign change, or non-convergence). Pure and dependency-free so it unit-tests in isolation.
"""
from __future__ import annotations

from datetime import date

_DAYS_PER_YEAR = 365.0


def _npv(rate: float, flows: list[tuple[float, float]]) -> float:
    """Net present value of (years_from_t0, amount) pairs at the given annual rate."""
    return sum(a / (1.0 + rate) ** t for t, a in flows)


def _dnpv(rate: float, flows: list[tuple[float, float]]) -> float:
    """d(NPV)/d(rate) — used by Newton's method."""
    return sum(-t * a / (1.0 + rate) ** (t + 1.0) for t, a in flows)


def _bisect(flows: list[tuple[float, float]]) -> float | None:
    """Robust fallback: bisection over a wide bracket. Needs a sign change across it."""
    lo, hi = -0.9999, 100.0
    flo, fhi = _npv(lo, flows), _npv(hi, flows)
    if flo == 0.0:
        return lo
    if fhi == 0.0:
        return hi
    if (flo > 0) == (fhi > 0):
        return None  # no root in the bracket
    for _ in range(200):
        mid = (lo + hi) / 2.0
        fm = _npv(mid, flows)
        if abs(fm) < 1e-7:
            return mid
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2.0


def xirr(cashflows: list[tuple[date, float]]) -> float | None:
    """Annual money-weighted rate over dated flows, or None if not computable."""
    if len(cashflows) < 2:
        return None
    amounts = [a for _, a in cashflows]
    # A root exists only with both an inflow and an outflow.
    if not (any(a > 0 for a in amounts) and any(a < 0 for a in amounts)):
        return None

    t0 = min(d for d, _ in cashflows)
    flows = [((d - t0).days / _DAYS_PER_YEAR, a) for d, a in cashflows]

    # Newton's method from a 10%/yr guess, staying inside the valid domain (rate > -100%).
    rate = 0.1
    for _ in range(100):
        try:
            v = _npv(rate, flows)
            d = _dnpv(rate, flows)
        except (OverflowError, ZeroDivisionError):
            break
        if abs(v) < 1e-7:
            return rate if rate > -0.999999 else None
        if d == 0.0:
            break
        new = rate - v / d
        if new <= -1.0:                 # would leave the domain — halve the distance to -100%
            new = (rate - 1.0) / 2.0
        if abs(new - rate) < 1e-9:
            rate = new
            break
        rate = new

    if abs(_npv(rate, flows)) < 1e-4 and rate > -0.999999:
        return rate
    return _bisect(flows)  # Newton didn't converge — try the robust bracket
