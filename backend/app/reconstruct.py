"""Reconstruct open lots (rungs) + completed trades from a chronological list of
fills — LIFO (sells retire the most-recently-bought lots first, matching the
strategy). Source-agnostic: feed it Schwab order/transaction fills (…719 once
funded) or any other source. Pure logic; no I/O.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

_EPS = 1e-9


@dataclass
class Fill:
    symbol: str
    side: str          # "BUY" | "SELL" | "SPLT" (share split/reverse-split adjustment)
    shares: float      # SPLT: the NEW total share count after the split
    price: float       # SPLT: the OLD total share count before the split
    at: date | datetime
    order_type: str = ""   # "MARKET" | "LIMIT" | ... (for audit/notify classification; unused by LIFO)
    order_id: str = ""     # Schwab order id (for a stable audit identity; unused by LIFO)


@dataclass
class OpenLot:
    symbol: str
    shares: float
    price: float
    at: date | datetime
    rung: int = 0
    source: str = "fill"   # "fill" = from a real buy fill; "position" = backfilled from Schwab's aggregate


@dataclass
class ClosedTrade:
    symbol: str
    shares: float
    buy_price: float
    sell_price: float
    opened_at: date | datetime
    completed_at: date | datetime

    @property
    def cost(self) -> float:
        return self.buy_price * self.shares

    @property
    def profit(self) -> float:
        return (self.sell_price - self.buy_price) * self.shares


_SIDE_ORDER = {"SPLT": -1, "BUY": 0}  # splits first (rescale before the day's trades), then buys, then sells


def _sort_key(f: Fill):
    # chronological; on ties a SPLIT precedes a BUY precedes a SELL
    return (f.at, _SIDE_ORDER.get(f.side.upper(), 1))


def reconstruct(fills: list[Fill]) -> dict:
    """Returns {open_lots: {symbol: [OpenLot...]}, closed: [ClosedTrade...],
    oversold: [(symbol, shares, sell_price, at)]}."""
    stacks: dict[str, list[OpenLot]] = {}
    closed: list[ClosedTrade] = []
    oversold: list[tuple] = []

    for f in sorted(fills, key=_sort_key):
        side = f.side.upper()
        stack = stacks.setdefault(f.symbol, [])
        if side == "SPLT":
            # Share split / reverse split: rescale the open stack by new/old. Cost
            # basis is PRESERVED exactly (shares x price is invariant per lot) and no
            # P/L is realized — the position just changes denomination. Fractional
            # remainders (the broker pays cash-in-lieu) are left as-is; the positions
            # reconcile step aligns the final total to Schwab's actual count.
            old_total = f.price
            if old_total > _EPS and f.shares > _EPS:
                r = f.shares / old_total
                for lot in stack:
                    lot.shares *= r
                    lot.price /= r
            continue
        if side == "BUY":
            stack.append(OpenLot(f.symbol, f.shares, f.price, f.at))
        else:  # SELL retires the most recent lots first (LIFO)
            remaining = f.shares
            while remaining > _EPS and stack:
                lot = stack[-1]
                take = min(remaining, lot.shares)
                closed.append(ClosedTrade(f.symbol, take, lot.price, f.price,
                                          lot.at, f.at))
                lot.shares -= take
                remaining -= take
                if lot.shares <= _EPS:
                    stack.pop()
            if remaining > _EPS:  # sold more than held (short/data gap)
                oversold.append((f.symbol, remaining, f.price, f.at))

    open_lots: dict[str, list[OpenLot]] = {}
    for sym, lots in stacks.items():
        live = [l for l in lots if l.shares > _EPS]
        for i, lot in enumerate(live, start=1):  # oldest = rung 1
            lot.rung = i
        if live:
            open_lots[sym] = live
    return {"open_lots": open_lots, "closed": closed, "oversold": oversold}


def reconcile_open_lots(open_by_symbol: dict[str, list[OpenLot]],
                        positions: dict[str, tuple[float, float]],
                        horizon_at) -> dict[str, list[OpenLot]]:
    """Reconcile fill-reconstructed open lots against Schwab's CURRENT positions
    (the authoritative current holding). Guarantees each symbol's open-lot total
    equals Schwab's held shares — recovering shares whose BUYS fall outside the
    fill window (or aren't exposed at all, e.g. a managed account) by backfilling
    a synthetic 'prior holdings' lot at the best-known cost. `positions` maps
    symbol -> (shares, average_price). `horizon_at` stamps the synthetic lot.

    - shortfall (Schwab holds more than we reconstructed): prepend a `source=position`
      lot for the missing shares (it's the oldest → rung 1), priced so the symbol's
      total cost basis matches Schwab's (falls back to the average price).
    - overage (we reconstructed more than Schwab holds — a missed sell): trim
      newest-first down to the held quantity.
    - EXPLICITLY held-none (symbol present in `positions` with ~0 shares): drop it.
    - ABSENT from `positions` (symbol reconstructed from fills but not reported by
      the read): KEEP the fill lots untouched. A partial/degraded positions read
      omits symbols it can't report, and treating omission as 'sold everything'
      would silently delete a real holding — so we never drop a symbol by omission.
    Rungs are renumbered oldest-first afterward.
    """
    result: dict[str, list[OpenLot]] = {}
    for sym in set(open_by_symbol) | set(positions):
        lots = list(open_by_symbol.get(sym, []))
        recon = sum(l.shares for l in lots)
        if sym not in positions:
            # Reconstructed from fills but ABSENT from the positions snapshot →
            # never delete by omission (a partial read would wipe a real holding).
            if lots:
                for i, lot in enumerate(lots, start=1):
                    lot.rung = i
                result[sym] = lots
            continue
        actual, avg = positions[sym]
        if actual <= _EPS:
            continue  # positions EXPLICITLY reports ~0 → genuinely sold out → drop
        diff = actual - recon
        if diff > _EPS:
            recon_cost = sum(l.shares * l.price for l in lots)
            resid = actual * avg - recon_cost           # cost attributable to the missing shares
            price = resid / diff if resid > 0 else avg  # else fall back to the position average
            lots = [OpenLot(sym, round(diff, 4), round(price, 4), horizon_at, source="position")] + lots
        elif diff < -_EPS:
            over = -diff
            while over > _EPS and lots:                 # trim newest (end) first
                last = lots[-1]
                if last.shares <= over + _EPS:
                    over -= last.shares
                    lots.pop()
                else:
                    last.shares = round(last.shares - over, 4)
                    over = 0.0
        for i, lot in enumerate(lots, start=1):
            lot.rung = i
        if lots:
            result[sym] = lots
    return result
