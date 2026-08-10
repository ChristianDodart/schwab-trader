"""Pure replay of the LIFO progressive ladder against a historical price series.

No I/O: give it a list of daily closes + a StrategyConfig + a bankroll, get back how
the method WOULD have behaved — equity curve, drawdown, round-trips, win rate, and a
same-capital buy-and-hold benchmark. This is the one tool that evaluates the method
empirically instead of by feel, so its assumptions are stated plainly and it is
trivially unit-testable (like rules.py).

Model (one name, one allocated bankroll):
  - Enter rung 1 on the first bar; ladder DOWN per cfg's drop tiers; size each buy by
    cfg's $ tiers (shares = dollars / close).
  - Sell LIFO: whenever the newest lot clears its per-lot target (cfg.sell), sell it;
    cascade while the next lot also clears (a strong up-day can close several).
  - Re-enter rung 1 the bar AFTER a full sell-out (continuous laddering of the name).
  - A buy is skipped when cash < the tier's dollars — this is the reserve running dry,
    the ladder's real failure mode, modeled faithfully.
  - Deployment-scaling honored: deeper dips required as the bankroll gets deployed.
  - Fills at the daily close; no fees, slippage, or dividends — a clean mechanical
    comparison, not a P&L promise.
"""
from __future__ import annotations

from . import rules
from .config import StrategyConfig


def simulate(closes: list[float], cfg: StrategyConfig, start_cash: float,
             labels: list | None = None) -> dict:
    prices = [float(c) for c in closes]
    valid = [p for p in prices if p > 0]
    if not valid or start_cash <= 0:
        return {"ok": False, "reason": "no price history" if not valid else "no capital"}
    first_price = valid[0]

    cash = float(start_cash)
    lots: list[dict] = []                 # newest lot last (LIFO stack)
    realized = 0.0
    round_trips = 0
    wins = 0
    max_lots = 0
    max_deployed = 0.0
    peak_equity = 0.0
    max_dd = 0.0
    curve: list[dict] = []

    for i, price in enumerate(prices):
        label = labels[i] if labels and i < len(labels) else i
        if price <= 0:                    # gap/holiday candle: carry equity, act on nothing
            equity = cash + sum(lot["shares"] * lot["buy_price"] for lot in lots)
            curve.append({"t": label, "equity": round(equity, 2), "hold": None})
            continue

        # SELL pass — LIFO cascade while the top lot clears its target.
        sold = False
        while lots:
            top = lots[-1]
            target = rules.sell_target_price(top["buy_price"], top["shares"], cfg)
            if price > target:
                proceeds = top["shares"] * price
                pnl = proceeds - top["shares"] * top["buy_price"]
                realized += pnl
                round_trips += 1
                wins += 1 if pnl > 0 else 0
                cash += proceeds
                lots.pop()
                sold = True
            else:
                break

        # BUY pass — one per bar; never on a bar we just sold into (avoids churn).
        if not sold:
            deployed_pct = (start_cash - cash) / start_cash * 100.0
            if not lots:
                dollars = rules.sizing_dollars(0, cfg)
                if cash >= dollars:
                    lots.append({"shares": dollars / price, "buy_price": price})
                    cash -= dollars
            else:
                trigger = rules.next_buy_price(lots[-1]["buy_price"], len(lots) + 1, cfg, deployed_pct)
                if price <= trigger:
                    dollars = rules.sizing_dollars(len(lots), cfg)
                    if cash >= dollars:
                        lots.append({"shares": dollars / price, "buy_price": price})
                        cash -= dollars

        max_lots = max(max_lots, len(lots))
        max_deployed = max(max_deployed, sum(lot["shares"] * lot["buy_price"] for lot in lots))
        equity = cash + sum(lot["shares"] * price for lot in lots)
        peak_equity = max(peak_equity, equity)
        if peak_equity > 0:
            max_dd = max(max_dd, (peak_equity - equity) / peak_equity)
        curve.append({"t": label, "equity": round(equity, 2),
                      "hold": round(start_cash * price / first_price, 2)})

    last_price = valid[-1]
    open_value = sum(lot["shares"] * last_price for lot in lots)
    open_unrealized = open_value - sum(lot["shares"] * lot["buy_price"] for lot in lots)
    ending_equity = cash + open_value
    bh_equity = start_cash * last_price / first_price
    return {
        "ok": True,
        "bars": len(prices),
        "start_cash": round(start_cash, 2),
        "ending_equity": round(ending_equity, 2),
        "total_return": round(ending_equity / start_cash - 1.0, 4),
        "buy_hold_equity": round(bh_equity, 2),
        "buy_hold_return": round(last_price / first_price - 1.0, 4),
        "realized": round(realized, 2),
        "open_unrealized": round(open_unrealized, 2),
        "round_trips": round_trips,
        "win_rate": round(wins / round_trips, 4) if round_trips else None,
        "max_lots_deep": max_lots,
        "max_deployed": round(max_deployed, 2),
        "max_drawdown": round(max_dd, 4),
        "open_lots": len(lots),
        "cash_end": round(cash, 2),
        "curve": curve,
    }
