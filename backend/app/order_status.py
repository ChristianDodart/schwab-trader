"""Order-status classification — the one place that knows Schwab's order-status taxonomy.

Three predicates over a broker status string, from canonical sets defined once, so the
nav badge, the cancel guard, the edit guard, and the ticket's fill poll all agree:

- **is_working**  — the order is live: it can be canceled or edited, and it counts toward
  the "working orders" badge. An allowlist of the live states.
- **is_cancelable** — cancel unless *known* terminal. A DENYLIST, deliberately robust to
  Schwab adding a new live status: the broker is the final authority on the cancel, so an
  unrecognized status stays cancelable rather than being wrongly blocked.
- **is_settled** — the order has reached a truly final state; stop polling for its fill.

Backend consumers call these directly; the order payload carries `working` (per row) and
`settled` (on the single-order lookup) so the client reads the verdict instead of
re-deriving broker statuses of its own.
"""
from __future__ import annotations

# Truly-final states — the order will not change again.
SETTLED = frozenset({"FILLED", "CANCELED", "REJECTED", "EXPIRED", "REPLACED"})

# Live states — the order is working and can be canceled or edited (allowlist).
WORKING = frozenset({
    "WORKING", "QUEUED", "ACCEPTED", "PENDING_ACTIVATION",
    "AWAITING_PARENT_ORDER", "AWAITING_CONDITION", "AWAITING_MANUAL_REVIEW",
})

# Not cancelable — settled, mid-transition, or unknown. A denylist (cancel unless in here),
# so a new live status Schwab introduces stays cancelable and the broker makes the call.
TERMINAL = SETTLED | frozenset({"PENDING_CANCEL", "PENDING_REPLACE", "UNKNOWN"})


def is_working(status: str | None) -> bool:
    return status in WORKING


def is_cancelable(status: str | None) -> bool:
    return status not in TERMINAL


def is_settled(status: str | None) -> bool:
    return status in SETTLED
