"""Pre-trade guards — the single-order money-path safety rails as one pure module.

The two single-order placement paths (`orders.place_order` and `orders.replace_order`)
share the same rails and previously carried them inlined and near-copied:

- **stop-direction** — a stop on the wrong side of the market would trigger an immediate
  market fill; reject it.
- **fat-finger** — a limit sitting absurdly far from the last price is probably a typo;
  ask the user to confirm.
- **notional** — an oversized BUY is likely a quantity typo; ask the user to confirm.
- **held-shares** — a SELL may never exceed shares actually held (fail closed — no
  accidental short).

Here they are one interface, which is therefore the test surface. The functions are pure:
the caller does the I/O (fetch the trusted quote, and for a SELL the held shares) and
passes the results in, so every rail can be exercised directly without a broker.

Scope is deliberately the single-order path. Bulk placement (`bulk.py`) keeps its own
guard model (per-item reject/skip, wider thresholds); reconciling the two is a separate,
behavior-changing decision, not part of this move.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GuardConfig:
    """Soft-confirm thresholds. Overridable per caller; only trip on a likely typo."""
    fatfinger_pct: float      # a limit this far from the last price → confirm
    notional_confirm: float   # a BUY larger than this (quantity × price) → confirm


# The strategy trades ~$500–1500/rung, so these only trip on a likely typo. Shared by
# place_order and replace_order (identical before this move).
SINGLE_ORDER_GUARDS = GuardConfig(fatfinger_pct=0.20, notional_confirm=10_000.0)


@dataclass(frozen=True)
class OrderIntent:
    """Everything the rails need to judge a proposed order — no I/O, no broker types."""
    symbol: str
    side: str                       # "BUY" | "SELL"
    quantity: int
    order_type: str                 # LIMIT | MARKET | STOP | STOP_LIMIT | TRAILING_STOP
    limit_price: float | None = None
    stop_price: float | None = None


@dataclass(frozen=True)
class GuardVerdict:
    """The outcome of the rails: proceed, ask the user to confirm, or refuse outright."""
    action: str                     # "ok" | "confirm" | "reject"
    reason: str | None = None

    @property
    def ok(self) -> bool:
        return self.action == "ok"


_OK = GuardVerdict("ok")


def evaluate_order(
    intent: OrderIntent,
    ref_price: float | None,
    cfg: GuardConfig = SINGLE_ORDER_GUARDS,
    *,
    confirm: bool = False,
) -> GuardVerdict:
    """The soft rails (stop-direction, fat-finger, notional) in priority order; the first
    that trips wins. `ref_price` is the TRUSTED last price (None = no schwab quote), which
    the caller fetches. `confirm=True` means the user already acknowledged the soft rails —
    only the hard wrong-side stop reject still applies. The held-shares rail is separate
    (`check_held`) because it needs an async lookup the caller makes only for a SELL.
    """
    sym = intent.symbol.upper()
    side = intent.side.upper()
    otype = intent.order_type.upper()
    limit = None if intent.limit_price is None else float(intent.limit_price)
    stop = None if intent.stop_price is None else float(intent.stop_price)

    # stop-direction: a wrong-side stop triggers an immediate market order.
    if otype in ("STOP", "STOP_LIMIT") and stop:
        if ref_price:
            if side == "SELL" and stop >= ref_price:
                return GuardVerdict("reject", f"sell-stop {stop} is at/above the last price {ref_price} — would trigger immediately")
            if side == "BUY" and stop <= ref_price:
                return GuardVerdict("reject", f"buy-stop {stop} is at/below the last price {ref_price} — would trigger immediately")
        elif not confirm:
            return GuardVerdict("confirm", f"No live quote for {sym} to check the stop direction — confirm.")

    # fat-finger: a limit far from the market is probably a typo.
    if not confirm and otype in ("LIMIT", "STOP_LIMIT") and limit:
        if not ref_price or ref_price <= 0:
            return GuardVerdict("confirm", f"No live quote for {sym} to sanity-check the ${limit:.2f} limit — confirm the price.")
        dev = abs(limit / ref_price - 1)
        if dev > cfg.fatfinger_pct:
            return GuardVerdict("confirm", f"Limit ${limit:.2f} is {dev * 100:.0f}% from the last price ${ref_price:.2f} — confirm this isn't a typo.")

    # notional: an unexpectedly large BUY is likely a quantity typo.
    if not confirm and side == "BUY":
        market_ish = otype not in ("LIMIT", "STOP_LIMIT")
        px = limit if limit else (ref_price or 0.0)
        if market_ish and px <= 0:
            return GuardVerdict("confirm", f"No live quote for {sym} to size this market order — confirm you want to proceed.")
        notional = intent.quantity * px
        if notional > cfg.notional_confirm:
            return GuardVerdict("confirm", f"This buy is about ${notional:,.0f} ({intent.quantity} × ${px:.2f}) — confirm the quantity isn't a typo.")

    return _OK


def check_held(quantity: int, held: float | None, *, verb: str = "sell") -> GuardVerdict:
    """The SELL held-shares rail (fail closed). `held` is shares actually held, or None if
    the lookup failed. `verb` names the refused action in the message ("sell" / "modify").
    """
    if held is None:
        return GuardVerdict("reject", f"could not verify shares held — {verb} refused")
    if quantity > held:
        return GuardVerdict("reject", f"sell {quantity} exceeds {held:g} shares held — refused to avoid a short")
    return _OK
