"""Proactive strategy-trigger alerts — the app tells you WHEN to act.

The dashboard already flags each held position with a buy_mark (price dropped to its
next-rung trigger) or sell_mark (a lot reached its sell target). Those are passive —
you have to be looking. This background watcher re-uses that exact computation
(build_dashboard, so deployment-scaling and all rules stay consistent) and pushes a
bell + desktop notification the moment a position CROSSES into a triggered state.

Edge-detected: fires once per crossing (not every poll), re-arms when it clears. The
first pass only SEEDS the baseline so we never blast a notification for every position
already sitting at its trigger on startup. Advisory only — never places an order.
"""
from __future__ import annotations

import asyncio
import logging

log = logging.getLogger(__name__)

_POLL_S = 30.0
# (account_hash, symbol, kind) currently in a triggered state — the edge-detection memory.
_state: set[tuple[str, str, str]] = set()


def new_triggers(current: set, previous: set) -> set:
    """Keys that JUST crossed into a triggered state (in current, not previously)."""
    return current - previous


def triggers_to_fire(current: set, previous: set, account: str, seeded_account: str | None) -> set:
    """Which triggered keys warrant a notification this pass.

    Fires NOTHING on the first pass for a given account — that pass only seeds the
    baseline, so we never blast a notification for every position already sitting at
    its trigger. Crucially this also re-seeds when the traded account CHANGES (profile
    or account switch): otherwise the new account's triggers would be compared against
    the old account's memory and all fire at once (the "switch → burst" bug)."""
    if account != seeded_account:
        return set()
    return new_triggers(current, previous)


async def run_strategy_trigger_watcher() -> None:
    from . import accounts, notifications
    from .dashboard import build_dashboard

    global _state
    seeded_account: str | None = None
    while True:
        try:
            account = await accounts.get_trading_account()  # only the account you trade
            if account:
                dash = await build_dashboard(account)
                current: set[tuple[str, str, str]] = set()
                info: dict[tuple[str, str, str], dict] = {}
                for r in dash.get("rows", []):
                    if r.get("is_watch") or r.get("price") is None:
                        continue
                    if r.get("buy_mark"):
                        k = (account, r["symbol"], "buy")
                        current.add(k); info[k] = r
                    if r.get("sell_mark"):
                        k = (account, r["symbol"], "sell")
                        current.add(k); info[k] = r

                fresh = triggers_to_fire(current, _state, account, seeded_account)
                _state = current
                seeded_account = account

                for k in fresh:
                    _, symbol, kind = k
                    r = info[k]
                    if kind == "buy":
                        msg = (f"{symbol} dipped to its next-buy trigger "
                               f"(${r['next_buy_price']:.2f}) — consider adding a position.")
                    else:
                        msg = f"{symbol} reached a sell target — profit is lockable now."
                    await notifications.post_system_notification(symbol, msg, r.get("price"))
                    log.info(f"{symbol} {kind}-trigger @ {r.get('price')}")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # never let one bad pass kill the watcher
            log.warning(f"watcher error: {e!r}")
        await asyncio.sleep(_POLL_S)
