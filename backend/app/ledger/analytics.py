"""Realized/positions/projection/tax analytics — the summary, historic (fact),
prediction, trade-journal, and benchmark builders, plus their pure stat helpers."""
from __future__ import annotations

import logging
import time
from datetime import date, timedelta

from sqlalchemy import case, func, select

from .. import benchmark as benchmark_calc
from .. import config_store
from .. import market_data
from .. import xirr as xirr_calc
from ..db import SessionLocal, dialect_insert as pg_insert
from ..db.models import AppSetting, CashFlow, CompletedTrade, DailyBalance, Lot
from ..schwab import hub
from ..strategy import rules
from ._shared import _GRAINS, _f, _period_key, _today
from .income import _cf_row
from .snapshots import latest_balance

log = logging.getLogger(__name__)

START_BALANCE_2025 = 30000.0
SHEET_ANCHOR = date(2025, 1, 1)
FED_FLAT_RATE = 0.12            # sheet's effective federal behavior (bracket-1 skip bug)

# 2025 federal brackets (lower_bound, rate) for the *correct* progressive estimate
_FED_BRACKETS = {
    "single": [
        (0.0, 0.10), (11925.0, 0.12), (48475.0, 0.22), (103350.0, 0.24),
        (197300.0, 0.32), (250525.0, 0.35), (626350.0, 0.37),
    ],
    "joint": [
        (0.0, 0.10), (23850.0, 0.12), (96950.0, 0.22), (206700.0, 0.24),
        (394600.0, 0.32), (501050.0, 0.35), (751600.0, 0.37),
    ],
}


def _progressive_federal(income: float, filing: str = "single") -> float:
    brackets = _FED_BRACKETS.get(filing, _FED_BRACKETS["single"])
    tax = 0.0
    for i, (lo, rate) in enumerate(brackets):
        hi = brackets[i + 1][0] if i + 1 < len(brackets) else float("inf")
        if income > lo:
            tax += (min(income, hi) - lo) * rate
        else:
            break
    return tax


def _weekdays(a: date, b: date) -> int:
    """Trading-day APPROXIMATION: weekdays (Mon–Fri) in the inclusive range [a, b].
    Ignores ~9-10 market holidays/yr, so a full year ≈ 261 vs. the true ~252 — a
    small, disclosed overcount used only for pace math."""
    if b < a:
        return 0
    total = (b - a).days + 1
    full, rem = divmod(total, 7)
    days = full * 5
    start = a.weekday()  # Mon=0 .. Sun=6
    for i in range(rem):
        if (start + i) % 7 < 5:
            days += 1
    return days


async def build_summary(account_hash: str) -> dict:
    cfg = await config_store.get_config(account_hash)
    async with SessionLocal() as s:
        n, profit, cost, proceeds, first, last = (
            await s.execute(
                select(
                    func.count(CompletedTrade.id),
                    func.coalesce(func.sum(CompletedTrade.profit), 0),
                    func.coalesce(func.sum(CompletedTrade.cost), 0),
                    func.coalesce(func.sum(CompletedTrade.sell_price * CompletedTrade.shares), 0),
                    func.min(CompletedTrade.completed_at),
                    func.max(CompletedTrade.completed_at),
                ).where(CompletedTrade.account_hash == account_hash)
            )
        ).one()
        day_trades = (
            await s.execute(
                select(func.count(CompletedTrade.id)).where(
                    CompletedTrade.account_hash == account_hash,
                    CompletedTrade.opened_at == CompletedTrade.completed_at,
                )
            )
        ).scalar() or 0

    profit, cost, proceeds = _f(profit), _f(cost), _f(proceeds)
    n = int(n or 0)
    today = _today()

    # A single-day window (or one trade) has a 0-day span; treat as 1 active day
    # so the honest cadence reflects that day instead of collapsing to all-zeros.
    days_actual = max((last - first).days, 1) if (first and last and n) else 0
    months_actual = days_actual / 30.0 if days_actual else 0.0
    months_sheet = (today - SHEET_ANCHOR).days / 30.0

    def cadence(months: float) -> dict:
        days = months * 30.0
        weeks = days / 7.0
        return {
            "months_elapsed": round(months, 4),
            "avg_cap_gains_per_day": round(profit / days, 2) if days else 0.0,
            "avg_cap_gains_per_week": round(profit / weeks, 2) if weeks else 0.0,
            "avg_cap_gains_per_month": round(profit / months, 2) if months else 0.0,
            "avg_trades_per_day": round(n / days, 3) if days else 0.0,
            "avg_trades_per_week": round(n / weeks, 2) if weeks else 0.0,
            "avg_trades_per_month": round(n / months, 2) if months else 0.0,
        }

    monthly_proj = profit / months_sheet if months_sheet else 0.0
    annual_proj = monthly_proj * 12.0

    return {
        "as_of": today.isoformat(),
        "realized": {
            "total_cap_gains": round(profit, 2),
            "gross_proceeds": round(proceeds, 2),
            "cost_basis": round(cost, 2),
            "trade_count": n,
            "day_trade_count": int(day_trades),
            "day_trade_pct": round(day_trades / n, 4) if n else 0.0,
            "first_completed": first.isoformat() if first else None,
            "last_completed": last.isoformat() if last else None,
        },
        "cadence": {"honest": cadence(months_actual), "sheet_parity": cadence(months_sheet)},
        "projection": {
            "basis": "sheet_parity",
            "monthly_cap_gains_proj": round(monthly_proj, 2),
            "annual_cap_gains_proj": round(annual_proj, 2),
            "yrs_cap_gain_pct": round(profit / START_BALANCE_2025, 4) if START_BALANCE_2025 else None,
            "start_balance_2025": START_BALANCE_2025,
        },
        "tax_estimate": _tax(annual_proj, cfg["tax_state_rate"], cfg["tax_filing"]),
    }


def _tax(annual_gain: float, state_rate: float, filing: str,
         other_income: float = 0.0) -> dict:
    """Estimated tax on short-term trading gains (which are ORDINARY income).

    Gains STACK on top of `other_income` (e.g. salary), so the federal figure is
    the INCREMENTAL tax the gains add: tax(other+gain) − tax(other). This lands the
    gains in the correct brackets at the user's real marginal rate. State is a flat
    per-account rate (Utah default; no state brackets). Losses → $0 (no estimate).
    """
    other = max(_f(other_income), 0.0)
    gain = max(_f(annual_gain), 0.0)
    fed = _progressive_federal(other + gain, filing) - _progressive_federal(other, filing)
    state = gain * _f(state_rate)
    total = fed + state
    return {
        "projected_annual_gain": round(gain, 2),
        "other_annual_income": round(other, 2),
        "filing": filing,
        "federal_tax": round(fed, 2),
        "state_tax": round(state, 2),
        "state_rate": _f(state_rate),
        "total_tax": round(total, 2),
        "effective_rate": round(total / gain, 4) if gain else 0.0,
        "after_tax_gain": round(gain - total, 2),
        "method": f"irs_2025_{filing}_progressive_stacked",
    }


async def build_tax(account_hash: str) -> dict:
    return (await build_summary(account_hash))["tax_estimate"]


async def build_cap_gains(grain: str = "month", account_hash: str = "",
                          from_date: date | None = None, to_date: date | None = None) -> dict:
    grain = grain if grain in _GRAINS else "month"
    conds = [CompletedTrade.account_hash == account_hash]
    if from_date is not None:
        conds.append(CompletedTrade.completed_at >= from_date)
    if to_date is not None:
        conds.append(CompletedTrade.completed_at <= to_date)
    async with SessionLocal() as s:
        rows = (
            await s.execute(
                select(
                    CompletedTrade.completed_at,
                    CompletedTrade.profit,
                    CompletedTrade.sell_price,
                    CompletedTrade.shares,
                    CompletedTrade.cost,
                ).where(*conds)
            )
        ).all()

    # Group in Python (small per-account volume) — no SQL date_trunc dependency.
    buckets: dict[str, list[float]] = {}
    for completed_at, profit, sell_price, shares, cost in rows:
        b = buckets.setdefault(_period_key(completed_at, grain), [0.0, 0.0, 0.0, 0])
        b[0] += _f(profit)
        b[1] += _f(sell_price) * _f(shares)
        b[2] += _f(cost)
        b[3] += 1
    out = [
        {"period": k, "cap_gains": round(v[0], 4), "gross_proceeds": round(v[1], 2),
         "cost_basis": round(v[2], 2), "trade_count": int(v[3])}
        for k, v in sorted(buckets.items())
    ]
    return {"grain": grain, "rows": out, "total_cap_gains": round(sum(r["cap_gains"] for r in out), 2)}


async def build_activity(grain: str = "week", account_hash: str = "",
                         from_date: date | None = None, to_date: date | None = None) -> dict:
    """Gross dollars BOUGHT and SOLD per period + the realized PROFIT booked in that
    period — "what did I actually do this week/month, and what did it make?".
    Bought/sold come from the persistent fill ledger (full history, including CSV-
    imported years). Profit comes from completed trades (LIFO: (sell - buy) x shares,
    summed across every close that landed in the period). Bucketed in Python."""
    from ..db.models import FillRecord

    grain = grain if grain in _GRAINS else "week"
    async with SessionLocal() as s:
        rows = (
            await s.execute(
                select(FillRecord.trade_date, FillRecord.side, FillRecord.shares, FillRecord.price)
                .where(FillRecord.account_hash == account_hash,
                       FillRecord.side.in_(["BUY", "SELL"]))
            )
        ).all()
        trade_rows = (
            await s.execute(
                select(CompletedTrade.completed_at, CompletedTrade.profit)
                .where(CompletedTrade.account_hash == account_hash)
            )
        ).all()

    def in_scope(d: date) -> bool:
        return not ((from_date is not None and d < from_date)
                    or (to_date is not None and d > to_date))

    # bucket -> [bought$, sold$, buy_count, sell_count, profit$]
    buckets: dict[str, list] = {}
    for d, side, shares, price in rows:
        if d is None or not in_scope(d):
            continue
        notional = _f(shares) * _f(price)
        if notional <= 0:
            continue
        b = buckets.setdefault(_period_key(d, grain), [0.0, 0.0, 0, 0, 0.0])
        if str(side or "").upper() == "SELL":
            b[1] += notional
            b[3] += 1
        else:
            b[0] += notional
            b[2] += 1
    for completed_at, profit in trade_rows:
        if completed_at is None or not in_scope(completed_at):
            continue
        b = buckets.setdefault(_period_key(completed_at, grain), [0.0, 0.0, 0, 0, 0.0])
        b[4] += _f(profit)

    out = [
        {"period": k, "bought": round(v[0], 2), "sold": round(v[1], 2),
         "net": round(v[1] - v[0], 2), "buy_count": int(v[2]), "sell_count": int(v[3]),
         "profit": round(v[4], 2)}
        for k, v in sorted(buckets.items(), reverse=True)
    ]
    totals = {
        "bought": round(sum(r["bought"] for r in out), 2),
        "sold": round(sum(r["sold"] for r in out), 2),
        "net": round(sum(r["net"] for r in out), 2),
        "buy_count": sum(r["buy_count"] for r in out),
        "sell_count": sum(r["sell_count"] for r in out),
        "profit": round(sum(r["profit"] for r in out), 2),
    }
    return {"grain": grain, "rows": out, "totals": totals}


def compute_streaks(profits: list[float]) -> dict:
    """Longest win/loss streaks + the streak in progress, from profits in
    CHRONOLOGICAL order. Zero-profit trades break both streaks (neither win nor
    loss). current > 0 = consecutive wins running, < 0 = consecutive losses."""
    longest_win = longest_loss = 0
    run = 0  # signed: positive counts wins, negative counts losses
    for p in profits:
        if p > 0:
            run = run + 1 if run > 0 else 1
            longest_win = max(longest_win, run)
        elif p < 0:
            run = run - 1 if run < 0 else -1
            longest_loss = max(longest_loss, -run)
        else:
            run = 0
    return {"longest_win": longest_win, "longest_loss": longest_loss, "current": run}


def compute_drawdown(series: list[tuple[date, float]]) -> dict | None:
    """Max + current drawdown over an equity series ((day, balance), chronological).
    Drawdown = fall from the running peak; max is the deepest such fall anywhere in
    the span, current is where today sits below the latest peak (0 = at a high).
    None when fewer than 2 points — no meaningful drawdown exists yet."""
    if len(series) < 2:
        return None
    peak_val = series[0][1]
    peak_day = trough_day = series[0][0]
    max_dd = 0.0
    max_dd_pct = 0.0
    for day, bal in series:
        if bal > peak_val:
            peak_val, peak_day = bal, day
        dd = peak_val - bal
        if dd > max_dd:
            max_dd = dd
            max_dd_pct = dd / peak_val if peak_val > 0 else 0.0
            trough_day = day
    last_day, last_bal = series[-1]
    cur_dd = peak_val - last_bal
    return {
        "max_dd": round(max_dd, 2),
        "max_dd_pct": round(max_dd_pct, 4),
        "max_dd_date": trough_day.isoformat(),
        "current_dd": round(max(cur_dd, 0.0), 2),
        "current_dd_pct": round(max(cur_dd, 0.0) / peak_val, 4) if peak_val > 0 else 0.0,
        "peak_date": peak_day.isoformat(),
        "as_of": last_day.isoformat(),
    }


def _best_worst_periods(day_profits: dict[date, float]) -> dict:
    """Best/worst single day and ISO week from realized profit bucketed per day."""
    def entry(items, pick):
        if not items:
            return None
        k, v = pick(items, key=lambda kv: kv[1])
        return {"period": k, "profit": round(v, 2)}

    days = list(day_profits.items())
    weeks: dict[str, float] = {}
    for d, p in days:
        monday = d - timedelta(days=d.weekday())
        k = monday.isoformat()
        weeks[k] = weeks.get(k, 0.0) + p
    day_items = [(d.isoformat(), p) for d, p in days]
    week_items = list(weeks.items())
    return {
        "best_day": entry(day_items, max),
        "worst_day": entry(day_items, min),
        "best_week": entry(week_items, max),
        "worst_week": entry(week_items, min),
    }


async def build_trades(account_hash: str, from_date: date | None = None,
                       to_date: date | None = None, symbol: str | None = None) -> dict:
    """Trade journal + performance analytics for the selected account: the full closed
    round-trip log plus win-rate / profit-factor / hold-time stats and a per-symbol
    rollup. All computed in Python (small per-account volume)."""
    conds = [CompletedTrade.account_hash == account_hash]
    if from_date is not None:
        conds.append(CompletedTrade.completed_at >= from_date)
    if to_date is not None:
        conds.append(CompletedTrade.completed_at <= to_date)
    if symbol:
        conds.append(CompletedTrade.symbol == symbol.strip().upper())
    async with SessionLocal() as s:
        rows = (
            await s.execute(
                select(CompletedTrade).where(*conds)
                .order_by(CompletedTrade.completed_at.desc(), CompletedTrade.id.desc())
            )
        ).scalars().all()

    trades = []
    for t in rows:
        opened = t.opened_at
        completed = t.completed_at
        hold = (completed - opened).days if (opened and completed) else None
        trades.append({
            "id": t.id, "symbol": t.symbol, "shares": _f(t.shares),
            "buy_price": _f(t.buy_price), "sell_price": _f(t.sell_price),
            "cost": _f(t.cost), "profit": round(_f(t.profit), 2),
            "opened_at": opened.isoformat() if opened else None,
            "completed_at": completed.isoformat() if completed else None,
            "hold_days": hold,
            "is_day_trade": bool(opened and completed and opened == completed),
        })

    profits = [t["profit"] for t in trades]
    wins = [p for p in profits if p > 0]
    losses = [p for p in profits if p < 0]
    holds = [t["hold_days"] for t in trades if t["hold_days"] is not None]
    gross_win = sum(wins)
    gross_loss = sum(losses)  # negative
    best = max(trades, key=lambda t: t["profit"], default=None)
    worst = min(trades, key=lambda t: t["profit"], default=None)
    summary = {
        "count": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(trades), 4) if trades else None,
        "total_profit": round(sum(profits), 2),
        "avg_win": round(gross_win / len(wins), 2) if wins else None,
        "avg_loss": round(gross_loss / len(losses), 2) if losses else None,
        "profit_factor": round(gross_win / abs(gross_loss), 2) if losses else None,
        "avg_hold_days": round(sum(holds) / len(holds), 1) if holds else None,
        "day_trade_count": sum(1 for t in trades if t["is_day_trade"]),
        "best": {"symbol": best["symbol"], "profit": best["profit"]} if best else None,
        "worst": {"symbol": worst["symbol"], "profit": worst["profit"]} if worst else None,
    }

    by_sym: dict[str, list] = {}
    for t in trades:
        agg = by_sym.setdefault(t["symbol"], [0, 0.0, 0])  # count, profit, wins
        agg[0] += 1
        agg[1] += t["profit"]
        agg[2] += 1 if t["profit"] > 0 else 0
    by_symbol = sorted(
        [{"symbol": k, "count": v[0], "total_profit": round(v[1], 2),
          "win_rate": round(v[2] / v[0], 4) if v[0] else None} for k, v in by_sym.items()],
        key=lambda r: r["total_profit"], reverse=True,
    )

    # Streaks + best/worst periods (pure, from the scoped trades, chronological).
    # `rows` is completed_at DESC, so reverse; same-day ties keep insertion order.
    chrono = [t["profit"] for t in reversed(trades) if t["completed_at"]]
    streaks = compute_streaks(chrono)
    day_profits: dict[date, float] = {}
    for t in rows:
        if t.completed_at:
            day_profits[t.completed_at] = day_profits.get(t.completed_at, 0.0) + _f(t.profit)
    periods = _best_worst_periods(day_profits)

    # Drawdown from the daily_balance equity series (scoped like the trades).
    dd_conds = [DailyBalance.account_hash == account_hash]
    if from_date is not None:
        dd_conds.append(DailyBalance.day >= from_date)
    if to_date is not None:
        dd_conds.append(DailyBalance.day <= to_date)
    async with SessionLocal() as s:
        bal_rows = (
            await s.execute(select(DailyBalance.day, DailyBalance.balance)
                            .where(*dd_conds).order_by(DailyBalance.day))
        ).all()
    drawdown = compute_drawdown([(d, _f(b)) for d, b in bal_rows if d and b is not None])

    return {"trades": trades, "summary": summary, "by_symbol": by_symbol,
            "streaks": streaks, "periods": periods, "drawdown": drawdown}


async def build_positions(account_hash: str) -> dict:
    cfg = await config_store.get_strategy(account_hash)
    async with SessionLocal() as s:
        lots = (await s.execute(
            select(Lot).where(Lot.account_hash == account_hash).order_by(Lot.symbol, Lot.rung)
        )).scalars().all()

    rows = []
    open_cost = 0.0
    open_target = 0.0
    unreal_last = 0.0
    for lot in lots:
        sh, bp = _f(lot.shares), _f(lot.buy_price)
        target = (
            _f(lot.sell_target_price)
            if lot.sell_target_price is not None
            else rules.sell_target_price(bp, sh, cfg, mode=lot.sell_mode)
        )
        quote = hub.latest.get(lot.symbol, {})
        last = quote.get("last")
        last = _f(last) if last else None
        open_cost += sh * bp
        open_target += sh * target
        if last:
            unreal_last += (last - bp) * sh
        rows.append({
            "symbol": lot.symbol,
            "rung": lot.rung,
            "buy_date": lot.buy_date.isoformat() if lot.buy_date else None,
            "shares": round(sh, 4),
            "buy_price": round(bp, 4),
            "sell_mode": lot.sell_mode or cfg.sell.default_mode,
            "sell_target_price": round(target, 4),
            "last_price": round(last, 4) if last else None,
            "unrealized_pl": round((last - bp) * sh, 2) if last else None,
        })
    return {
        "open_lots": len(lots),
        "open_cost_basis": round(open_cost, 2),
        "open_target_proceeds": round(open_target, 2),
        "unrealized_pl_at_last": round(unreal_last, 2),
        "rows": rows,
    }


# ===================== PREDICTIVE (projection) =====================

async def build_projection(account_hash: str) -> dict:
    """The PREDICTION tab — extrapolations from THIS calendar year's realized pace.
    Every number here is a projection, not a fact: it assumes the year's gains/day
    so far continue unchanged. Tax stacks projected gains on the user's other income
    (see _tax)."""
    cfg = await config_store.get_config(account_hash)
    today = _today()
    y0 = date(today.year, 1, 1)
    y_end = date(today.year, 12, 31)

    async with SessionLocal() as s:
        realized_ytd = _f((
            await s.execute(
                select(func.coalesce(func.sum(CompletedTrade.profit), 0)).where(
                    CompletedTrade.account_hash == account_hash,
                    CompletedTrade.completed_at >= y0,
                )
            )
        ).scalar())

    days_elapsed = (today - y0).days + 1
    days_in_year = (y_end - y0).days + 1  # 365 or 366 — keeps the annualization on the same calendar
    td_elapsed = _weekdays(y0, today)
    td_left = _weekdays(today + timedelta(days=1), y_end)
    # Annualize on CALENDAR days (simple, matches "gains so far / time so far").
    # Using the year's actual length preserves the year-end identity (on Dec 31,
    # projected == realized) in both common and leap years.
    projected_annual = realized_ytd / days_elapsed * days_in_year if days_elapsed else 0.0
    gain_per_trading_day = realized_ytd / td_elapsed if td_elapsed else 0.0

    goal = cfg.get("year_end_goal")
    other_income = cfg.get("other_annual_income") or 0.0
    goal_block = {
        "target": goal,
        "remaining": None,
        "required_per_trading_day": None,
        "progress": None,
        "on_track": None,
        "trading_days_left": td_left,
    }
    if goal:
        remaining = max(_f(goal) - realized_ytd, 0.0)
        req = (remaining / td_left) if td_left else None
        goal_block.update({
            "remaining": round(remaining, 2),
            "required_per_trading_day": round(req, 2) if req is not None else None,
            "progress": round(realized_ytd / _f(goal), 4) if goal else None,
            "on_track": (gain_per_trading_day >= req) if req is not None else None,
        })

    return {
        "as_of": today.isoformat(),
        "year": today.year,
        "realized_ytd": round(realized_ytd, 2),
        "days_elapsed": days_elapsed,
        "trading_days_elapsed": td_elapsed,
        "trading_days_left": td_left,
        "projected_annual_gain": round(projected_annual, 2),
        "gain_per_trading_day": round(gain_per_trading_day, 2),
        "goal": goal_block,
        "tax": _tax(projected_annual, cfg["tax_state_rate"], cfg["tax_filing"], other_income),
        "other_annual_income": other_income,
        "filing": cfg["tax_filing"],
    }


# ===================== HISTORIC (fact) =====================

async def build_historic(account_hash: str, from_date: date | None = None,
                         to_date: date | None = None) -> dict:
    """The FACT tab. `now` = live point-in-time balances from Schwab (or the last
    snapshot if unreadable). Everything else is scoped to [from_date, to_date]
    (both None = all-time): realized gains, contributions, and the balance series."""
    from .. import accounts as accounts_svc

    today = _today()
    bals = await accounts_svc.account_balances(account_hash)
    pos = await build_positions(account_hash)

    # `now` block — live balances; fall back to last snapshot for value if blocked.
    now: dict = {
        "invested_cost": pos["open_cost_basis"],
        "invested_market": round(pos["open_cost_basis"] + pos["unrealized_pl_at_last"], 2),
        "unrealized_pl": pos["unrealized_pl_at_last"],
        "open_lots": pos["open_lots"],
    }
    if not bals.get("blocked"):
        now.update({
            "source": "live",
            "account_value": bals.get("account_value"),
            "cash": bals.get("cash"),
            "buying_power": bals.get("buying_power"),
            "margin_buying_power": bals.get("margin_buying_power"),
            "tradable_funds": accounts_svc.select_tradable_funds(bals),
            "long_market_value": bals.get("long_market_value"),
        })
    else:
        snap = await latest_balance(account_hash)
        now.update({
            "source": "snapshot" if not snap.get("balance_blocked") else "unavailable",
            "account_value": None if snap.get("balance_blocked") else snap.get("balance"),
            "cash": None, "buying_power": None, "margin_buying_power": None,
            "tradable_funds": None, "long_market_value": None,
            "as_of_snapshot": None if snap.get("balance_blocked") else snap.get("day"),
            "note": bals.get("error"),
        })

    # Realized (scoped)
    conds = [CompletedTrade.account_hash == account_hash]
    if from_date is not None:
        conds.append(CompletedTrade.completed_at >= from_date)
    if to_date is not None:
        conds.append(CompletedTrade.completed_at <= to_date)
    async with SessionLocal() as s:
        n, profit, cost, proceeds = (
            await s.execute(
                select(
                    func.count(CompletedTrade.id),
                    func.coalesce(func.sum(CompletedTrade.profit), 0),
                    func.coalesce(func.sum(CompletedTrade.cost), 0),
                    func.coalesce(func.sum(CompletedTrade.sell_price * CompletedTrade.shares), 0),
                ).where(*conds)
            )
        ).one()
        day_trades = (
            await s.execute(
                select(func.count(CompletedTrade.id)).where(
                    *conds, CompletedTrade.opened_at == CompletedTrade.completed_at
                )
            )
        ).scalar() or 0

        # Contributions (scoped rows + scoped summary) and the all-time net.
        cf_conds = [CashFlow.account_hash == account_hash]
        if from_date is not None:
            cf_conds.append(CashFlow.day >= from_date)
        if to_date is not None:
            cf_conds.append(CashFlow.day <= to_date)
        cf_rows = (
            await s.execute(select(CashFlow).where(*cf_conds).order_by(CashFlow.day.desc(), CashFlow.id.desc()))
        ).scalars().all()
        all_time_net, all_time_count, deposits_all, withdrawals_all = (
            await s.execute(
                select(
                    func.coalesce(func.sum(CashFlow.amount), 0),
                    func.count(CashFlow.id),
                    # gross in / gross out, kept separate so a withdrawal never shrinks
                    # the "deposited" base used for ROI.
                    func.coalesce(func.sum(case((CashFlow.amount > 0, CashFlow.amount), else_=0)), 0),
                    func.coalesce(func.sum(case((CashFlow.amount < 0, CashFlow.amount), else_=0)), 0),
                )
                .where(CashFlow.account_hash == account_hash)
            )
        ).one()
        # All cashflows (day, amount) for a per-year capital summary (dialect-agnostic:
        # group in Python since the table is small). Mirrors the sheet's yearly
        # "Take out / Total Sum" breakdown.
        cap_rows = (
            await s.execute(
                select(CashFlow.day, CashFlow.amount).where(CashFlow.account_hash == account_hash)
            )
        ).all()
        # Balance series (scoped)
        sb_conds = [DailyBalance.account_hash == account_hash]
        if from_date is not None:
            sb_conds.append(DailyBalance.day >= from_date)
        if to_date is not None:
            sb_conds.append(DailyBalance.day <= to_date)
        series = (
            await s.execute(select(DailyBalance).where(*sb_conds).order_by(DailyBalance.day))
        ).scalars().all()

    deposits = round(sum(_f(r.amount) for r in cf_rows if _f(r.amount) > 0), 2)
    withdrawals = round(sum(_f(r.amount) for r in cf_rows if _f(r.amount) < 0), 2)
    net_all_time = _f(all_time_net)
    # Per-year capital summary (deposits / withdrawals / net), newest year first.
    _by_year: dict[int, list[float]] = {}
    for (cd, ca) in cap_rows:
        amt = _f(ca)
        agg = _by_year.setdefault(cd.year, [0.0, 0.0])
        agg[0 if amt > 0 else 1] += amt
    capital_by_year = [
        {"year": y, "deposits": round(v[0], 2), "withdrawals": round(v[1], 2),
         "net": round(v[0] + v[1], 2)}
        for y, v in sorted(_by_year.items(), reverse=True)
    ]
    deposited_all_time = round(_f(deposits_all), 2)          # gross in (ROI base)
    withdrawn_all_time = round(_f(withdrawals_all), 2)       # gross out (negative), info only
    acct_value = now.get("account_value")
    # True gain = (what the account is worth now + everything already withdrawn) − everything
    # deposited. Algebraically value − net_contributed, but framed so withdrawals are ADDED
    # BACK as returned capital rather than shrinking the deposited base. Only meaningful once
    # some deposits are recorded (else it's just the account value).
    gain_vs_contributed = (
        round(_f(acct_value) - net_all_time, 2)
        if acct_value is not None and int(all_time_count or 0) > 0 else None
    )
    # ROI base = PEAK capital at risk: the maximum the cumulative net contribution ever
    # reached. Gross deposits overstate the base when money cycles out and back in
    # (withdraw 100k then redeposit 50k isn't 50k of NEW capital); net understates it
    # after withdrawals. The peak is the most of YOUR money that was ever in the
    # account at once — the honest denominator. (XIRR below is the timing-correct
    # headline; this simple % is the quick-read companion.)
    running = peak_net_contributed = 0.0
    for _cd, _ca in sorted(cap_rows, key=lambda t: t[0]):
        running += _f(_ca)
        peak_net_contributed = max(peak_net_contributed, running)
    peak_net_contributed = round(peak_net_contributed, 2)
    roi_base = peak_net_contributed if peak_net_contributed > 0 else deposited_all_time
    roi_pct = (
        round(gain_vs_contributed / roi_base * 100, 1)
        if gain_vs_contributed is not None and roi_base > 0 else None
    )
    # Money-weighted return (XIRR): each contribution as a dated OUTFLOW (-amount), plus
    # today's account value as the terminal INFLOW — so the % reflects WHEN money went in,
    # not just how much. Simple ROI above ignores timing; this doesn't. Needs a live value
    # and ~a month of history (annualizing a few days is noise). None when not computable.
    xirr_pct = None
    if acct_value is not None and cap_rows:
        span_days = (today - min(cd for cd, _ in cap_rows)).days
        if span_days >= 30:
            flows = [(cd, -_f(ca)) for (cd, ca) in cap_rows]
            flows.append((today, _f(acct_value)))
            r = xirr_calc.xirr(flows)
            if r is not None:
                xirr_pct = round(r * 100, 1)

    return {
        "as_of": today.isoformat(),
        "scope": {"from": from_date.isoformat() if from_date else None,
                  "to": to_date.isoformat() if to_date else None},
        "now": now,
        "realized": {
            "cap_gains": round(_f(profit), 2),
            "gross_proceeds": round(_f(proceeds), 2),
            "cost_basis": round(_f(cost), 2),
            "trade_count": int(n or 0),
            "day_trade_count": int(day_trades),
        },
        "contributions": {
            "deposits": deposits,
            "withdrawals": withdrawals,
            "net": round(deposits + withdrawals, 2),
            "count": len(cf_rows),
            "schwab_window_days": 60,
            "rows": [_cf_row(r) for r in cf_rows],
        },
        "net_contributed_all_time": round(net_all_time, 2),
        "deposited_all_time": deposited_all_time,
        "withdrawn_all_time": withdrawn_all_time,
        "peak_net_contributed": peak_net_contributed,   # max of YOUR money ever in at once (ROI base)
        "capital_by_year": capital_by_year,
        "contributions_recorded": int(all_time_count or 0),
        "gain_vs_contributed": gain_vs_contributed,
        "roi_pct": roi_pct,
        "xirr_pct": xirr_pct,
        "series": [
            {"day": r.day.isoformat(), "balance": _f(r.balance), "capital_gains": _f(r.capital_gains)}
            for r in series
        ],
    }


_K_BENCH = "benchmark_symbol"


async def get_benchmark_symbol() -> str:
    """The user's chosen buy-and-hold benchmark ticker (default SPY)."""
    async with SessionLocal() as s:
        row = await s.get(AppSetting, _K_BENCH)
    return (row.value.strip().upper() if row and row.value else "SPY") or "SPY"


async def set_benchmark_symbol(symbol: str) -> dict:
    sym = (symbol or "").strip().upper()[:8] or "SPY"
    async with SessionLocal() as s:
        await s.execute(
            pg_insert(AppSetting).values(key=_K_BENCH, value=sym)
            .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": sym})
        )
        await s.commit()
    _bench_cache.clear()  # symbol changed → drop any cached comparison
    return {"symbol": sym}


# Per-(account, symbol) benchmark cache. 5Y history + the sim is relatively heavy and the
# comparison barely moves minute-to-minute, so a short TTL keeps the Ledger view snappy
# across scope changes without a stale-looking number. Only successful results are cached
# (a transient throttle retries next time). Cleared when the symbol setting changes.
_bench_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_BENCH_TTL_S = 300


async def build_benchmark(account_hash: str, symbol: str = "SPY") -> dict:
    """What the account's OWN dated contributions would be worth in `symbol` (buy-and-hold)
    — an apples-to-apples yardstick for the real account's return (same cash in/out, same
    dates, different vehicle). Degrades to {available: False, reason} whenever it can't be
    done honestly: no contributions, blocked/unknown account value, missing benchmark
    history, or a deposit that predates the available price history."""
    from datetime import datetime, timezone

    from .. import accounts as accounts_svc

    symbol = (symbol or "SPY").upper()
    ckey = (account_hash, symbol)
    hit = _bench_cache.get(ckey)
    if hit and (time.time() - hit[0]) < _BENCH_TTL_S:
        return hit[1]

    today = _today()
    async with SessionLocal() as s:
        cap_rows = (
            await s.execute(select(CashFlow.day, CashFlow.amount).where(CashFlow.account_hash == account_hash))
        ).all()
    if not cap_rows:
        return {"available": False, "reason": "no contributions recorded"}

    bals = await accounts_svc.account_balances(account_hash)
    acct_value = None if bals.get("blocked") else bals.get("account_value")
    if acct_value is None:
        snap = await latest_balance(account_hash)
        if not snap.get("balance_blocked"):
            acct_value = snap.get("balance")
    if acct_value is None:
        return {"available": False, "reason": "account value unavailable"}

    hist = await market_data.price_history(symbol, "5Y")
    candles = hist.get("candles") or []
    if not candles:
        return {"available": False, "reason": hist.get("error") or "no benchmark history"}
    closes = sorted(
        (
            (datetime.fromtimestamp(c["time"], timezone.utc).date(), float(c["close"]))
            for c in candles if c.get("close")
        ),
        key=lambda x: x[0],
    )
    last_price = closes[-1][1] if closes else None
    cashflows = [(cd, _f(ca)) for (cd, ca) in cap_rows]
    sim = benchmark_calc.simulate(cashflows, closes, last_price)
    if sim is None:
        earliest = min(cd for cd, _ in cap_rows)
        return {"available": False,
                "reason": f"{symbol} price history doesn't reach back to {earliest.isoformat()}"}

    your_flows = [(cd, -_f(ca)) for (cd, ca) in cap_rows] + [(today, _f(acct_value))]
    your_r = xirr_calc.xirr(your_flows)
    spy_r = xirr_calc.xirr(sim["flows"])
    series = [{"day": d.isoformat(), "value": v} for d, v in benchmark_calc.value_series(cashflows, closes)]
    result = {
        "available": True,
        "symbol": symbol,
        "as_of": today.isoformat(),
        "your_value": round(_f(acct_value), 2),
        "benchmark_value": sim["value"],
        "your_xirr_pct": round(your_r * 100, 1) if your_r is not None else None,
        "benchmark_xirr_pct": round(spy_r * 100, 1) if spy_r is not None else None,
        "series": series,
    }
    _bench_cache[ckey] = (time.time(), result)  # cache successes only
    return result
