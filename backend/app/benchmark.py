"""Buy-and-hold benchmark: what would the SAME dated deposits be worth if they'd gone
into a benchmark (SPY) instead of being actively traded?

Apples-to-apples with the account's own return: identical cash in/out on identical dates,
only the vehicle differs. Each deposit "buys" benchmark shares at the close on/just-before
its date; each withdrawal "sells" the equivalent shares; the leftover shares are valued at
the latest price. Feeding those same flows (plus this terminal value) into XIRR gives the
benchmark's money-weighted return to compare against yours.

The math here is PURE and unit-tested; the live price fetch (and its failure modes) lives in
the ledger layer and degrades to "unavailable" so a missing/short history never shows a wrong
number — it just hides the comparison.
"""
from __future__ import annotations

from datetime import date


def price_on_or_before(closes: list[tuple[date, float]], day: date) -> float | None:
    """Latest close on or before `day` from an ASCENDING-by-date list. None if `day`
    predates all available history (can't fairly benchmark a deposit we have no price for)."""
    found = None
    for d, px in closes:
        if d <= day:
            found = px
        else:
            break
    return found


def simulate(cashflows: list[tuple[date, float]], closes: list[tuple[date, float]],
             last_price: float | None) -> dict | None:
    """Simulate the benchmark buy-and-hold. `cashflows`: (date, amount) with amount>0 a
    deposit, <0 a withdrawal. `closes`: ASCENDING (date, close). Returns
    {"value", "flows"} where flows are investor-perspective (-deposit / +withdrawal) plus a
    terminal +value, ready for xirr(). None if any deposit predates the price history or
    there's no ending price — i.e. we can't do it honestly."""
    if not cashflows or not closes or not last_price or last_price <= 0:
        return None
    shares = 0.0
    flows: list[tuple[date, float]] = []
    for day, amount in sorted(cashflows, key=lambda x: x[0]):
        if amount == 0:
            continue
        px = price_on_or_before(closes, day)
        if px is None or px <= 0:
            return None  # a contribution we can't price → bail rather than fudge
        shares += amount / px          # deposit buys, withdrawal (amount<0) sells
        flows.append((day, -amount))   # investor cash flow: out on deposit, in on withdrawal
    if shares < 0:
        shares = 0.0                   # withdrawals exceeded contributions (shouldn't happen)
    value = round(shares * last_price, 2)
    today = max(d for d, _ in closes)
    flows.append((today, value))       # terminal: liquidate the benchmark position today
    return {"value": value, "shares": round(shares, 4), "flows": flows}
