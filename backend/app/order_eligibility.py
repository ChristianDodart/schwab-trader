"""Order eligibility — the one place that knows which (order type, session, duration)
combinations Schwab will accept.

Broker-authoritative and time-INDEPENDENT: it answers "is this combo legal?", never "is
now a good time to send it?" (that clock-driven affordance — which types to OFFER given
the detected market session — lives in the frontend's orderEligibility/orderTiming helpers).

Two Schwab rules, expressed once:
  - An extended-hours session (AM / PM / SEAMLESS) accepts a plain LIMIT order only —
    every other type (MARKET, STOP, STOP_LIMIT, TRAILING_STOP) requires the NORMAL session.
  - Good-till-canceled can't ride an extended-hours session — those orders must be DAY.

Enforced server-side in orders._build_order (the single authoritative gate, so every path —
the single ticket, replace, and bulk — fails an invalid combo fast with a clear reason
before it ever reaches Schwab) and mirrored by the frontend
(frontend/src/orderEligibility.ts) so the order tickets never offer a combo the server
would reject.
"""
from __future__ import annotations

# Sessions that trade outside 9:30–4:00 ET — Schwab restricts these to a plain LIMIT / DAY.
EXTENDED_SESSIONS = frozenset({"AM", "PM", "SEAMLESS"})


def _pretty(order_type: str) -> str:
    return order_type.replace("_", " ").title()  # STOP_LIMIT -> "Stop Limit"


def combo_error(order_type: str, session: str, duration: str) -> str | None:
    """None if Schwab accepts this (order_type, session, duration) combination, else a
    plain-English reason it is invalid. Inputs are matched case-insensitively; a blank
    session/duration reads as the safe default (NORMAL / DAY)."""
    ot = (order_type or "").upper()
    sess = (session or "NORMAL").upper()
    dur = (duration or "DAY").upper()
    if sess in EXTENDED_SESSIONS:
        if ot != "LIMIT":
            return (f"a {_pretty(ot)} order can't trade in an extended-hours session "
                    f"({sess.title()}) — use a limit order, or the normal session")
        if dur == "GOOD_TILL_CANCEL":
            return ("good-till-canceled can't be combined with an extended-hours session "
                    f"({sess.title()}) — use a Day order")
    return None
