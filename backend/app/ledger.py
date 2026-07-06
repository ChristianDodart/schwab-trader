"""Ledger service — the "Bal. Info" port.

Built from the verified spec (scratchpad/bal_info_spec.md) and validated against
the real DB. Realized P&L comes from completed_trade; open exposure from lot.

The original sheet has several bugs (a tax cascade that collapses to a flat 12%,
month buckets that straddle calendar boundaries, a "Gross Sales" column that is
really cost basis, an annualization anchored 13 months before any trade). We
compute the CORRECT values and also surface the sheet-parity numbers so the
user can see both. Anything needing a real account-balance series (daily
balance, total gain/loss, "reg trading") is flagged blocked until daily_balance
snapshots accrue.
"""
from __future__ import annotations

import asyncio
import math
import time
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import case, func, select

from . import benchmark as benchmark_calc
from . import config_store
from . import market_data
from . import xirr as xirr_calc
from .db import SessionLocal, dialect_insert as pg_insert
from .db.models import AppSetting, CashFlow, CompletedTrade, DailyBalance, Lot
from .schwab import hub
from .strategy import rules

# The trader's local market timezone — defines the calendar "day" for snapshots
# and same-day P&L so a UTC server doesn't bucket evening activity into tomorrow.
MARKET_TZ = ZoneInfo("America/Denver")  # user is in Utah (UT state tax below)


def _today() -> date:
    return datetime.now(MARKET_TZ).date()


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


def _f(x) -> float:
    return float(x) if x is not None else 0.0


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


_GRAINS = {"day": "day", "week": "week", "month": "month", "year": "year"}


def _period_key(d: date, grain: str) -> str:
    """Bucket a completed date into a period label. Done in Python (not SQL
    date_trunc) so it's dialect-neutral across Postgres and SQLite. Week = the
    Monday of that ISO week (matches Postgres date_trunc('week'))."""
    if grain == "year":
        return f"{d.year:04d}"
    if grain == "month":
        return f"{d.year:04d}-{d.month:02d}"
    if grain == "week":
        return (d - timedelta(days=d.weekday())).isoformat()
    return d.isoformat()  # day


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

    return {"trades": trades, "summary": summary, "by_symbol": by_symbol}


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


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


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
    from . import accounts as accounts_svc

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
            "long_market_value": bals.get("long_market_value"),
        })
    else:
        snap = await latest_balance(account_hash)
        now.update({
            "source": "snapshot" if not snap.get("balance_blocked") else "unavailable",
            "account_value": None if snap.get("balance_blocked") else snap.get("balance"),
            "cash": None, "buying_power": None, "margin_buying_power": None,
            "long_market_value": None,
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
    # ROI on the CAPITAL YOU PUT IN (gross deposits) — withdrawals don't move this base.
    roi_pct = (
        round(gain_vs_contributed / deposited_all_time * 100, 1)
        if gain_vs_contributed is not None and deposited_all_time > 0 else None
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

    from . import accounts as accounts_svc

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
    result = {
        "available": True,
        "symbol": symbol,
        "as_of": today.isoformat(),
        "your_value": round(_f(acct_value), 2),
        "benchmark_value": sim["value"],
        "your_xirr_pct": round(your_r * 100, 1) if your_r is not None else None,
        "benchmark_xirr_pct": round(spy_r * 100, 1) if spy_r is not None else None,
    }
    _bench_cache[ckey] = (time.time(), result)  # cache successes only
    return result


# ===================== cash flows (deposits / withdrawals) =====================

def _cf_row(r: CashFlow) -> dict:
    return {
        "id": r.id, "day": r.day.isoformat(), "amount": _f(r.amount),
        "kind": r.kind, "source": r.source, "memo": r.memo,
    }


async def list_cashflows(account_hash: str, from_date: date | None = None,
                         to_date: date | None = None) -> dict:
    conds = [CashFlow.account_hash == account_hash]
    if from_date is not None:
        conds.append(CashFlow.day >= from_date)
    if to_date is not None:
        conds.append(CashFlow.day <= to_date)
    async with SessionLocal() as s:
        rows = (
            await s.execute(select(CashFlow).where(*conds).order_by(CashFlow.day.desc(), CashFlow.id.desc()))
        ).scalars().all()
    return {"rows": [_cf_row(r) for r in rows],
            "net": round(sum(_f(r.amount) for r in rows), 2)}


async def add_cashflow(account_hash: str, day: str | date, amount: float,
                       memo: str | None = None) -> dict:
    d = day if isinstance(day, date) else _parse_date(day)
    if d is None:
        return {"ok": False, "error": "invalid date"}
    amt = round(_f(amount), 2)
    if not math.isfinite(amt):
        return {"ok": False, "error": "amount must be a finite number"}
    if amt == 0:
        return {"ok": False, "error": "amount cannot be zero"}
    async with SessionLocal() as s:
        row = CashFlow(
            account_hash=account_hash, day=d, amount=amt,
            kind="deposit" if amt > 0 else "withdrawal",
            source="manual", memo=(memo or None), schwab_txn_id=None,
        )
        s.add(row)
        await s.commit()
        await s.refresh(row)
    return {"ok": True, "row": _cf_row(row)}


async def delete_cashflow(account_hash: str, cf_id: int) -> dict:
    async with SessionLocal() as s:
        row = await s.get(CashFlow, cf_id)
        if row is None or row.account_hash != account_hash:
            return {"ok": False, "error": "not found"}
        await s.delete(row)
        await s.commit()
    return {"ok": True}


async def refresh_cashflows_from_schwab(account_hash: str) -> dict:
    """Pull the trailing 60 days of transfers from Schwab and insert any not already
    logged (deduped by schwab_txn_id → idempotent). None from Schwab = leave the log
    untouched (never wipe on a transient error)."""
    from . import accounts as accounts_svc

    transfers = await accounts_svc.fetch_transfers(account_hash)
    if transfers is None:
        return {"ok": False, "error": "Schwab transactions unavailable", "added": 0, "window_days": 60}
    added = 0
    async with SessionLocal() as s:
        for t in transfers:
            txid = t.get("schwab_txn_id")
            if not txid:
                continue  # can't dedup a txn with no id — skip rather than risk a dupe
            d = _parse_date(t.get("day"))
            amt = round(_f(t.get("amount")), 2)
            if d is None or not math.isfinite(amt) or amt == 0:
                continue
            # Idempotent per-account upsert: the composite unique (account_hash,
            # schwab_txn_id) makes a re-pull — or a concurrent one — skip dupes
            # ATOMICALLY (no check-then-act race), and one account's txn id can't
            # mask or block another account's transfer.
            stmt = (
                pg_insert(CashFlow)
                .values(
                    account_hash=account_hash, day=d, amount=amt,
                    kind=t.get("kind") or ("deposit" if amt > 0 else "withdrawal"),
                    source="schwab", memo=t.get("type"), schwab_txn_id=txid,
                )
                .on_conflict_do_nothing(index_elements=["account_hash", "schwab_txn_id"])
                .returning(CashFlow.id)
            )
            # RETURNING yields the new id on insert, nothing on conflict — a reliable
            # inserted-vs-skipped signal (rowcount is -1/"unknown" for DO NOTHING).
            if (await s.execute(stmt)).scalar_one_or_none() is not None:
                added += 1
        await s.commit()
    return {"ok": True, "added": added, "window_days": 60}


# ----- CSV import (Schwab "Transactions" export) -----
# Only OUTSIDE-money rows (transfers & wires) count as contributions — never
# trades, dividends, or interest. JOURNAL is an internal move (ambiguous) so it's
# excluded, matching the API-side transfer classification.
_CSV_TRANSFER_KEYS = ("transfer", "wire")
_CSV_TRANSFER_EXCLUDE = ("journal",)
# Max gap (days) between a CSV 'as of' effective date and Schwab's posted date for the
# same transfer — settlement is T+1, longer over weekends/holidays. Used for dedup only.
_CSV_DEDUP_WINDOW_DAYS = 4


def _parse_money(s: str | None) -> float | None:
    """'$1,000.00' -> 1000.0, '-$2709.59' -> -2709.59, '($5.00)' -> -5.0."""
    s = (s or "").strip()
    if not s:
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace("$", "").replace(",", "").strip()
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def _parse_csv_date(s: str | None) -> date | None:
    """Schwab dates are 'MM/DD/YYYY' or 'MM/DD/YYYY as of MM/DD/YYYY'. The 'as of'
    date is the EFFECTIVE (value) date — prefer it when present."""
    s = (s or "").strip()
    if not s:
        return None
    s = s.split(" as of ", 1)[1].strip() if " as of " in s else s.split(" ", 1)[0].strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


async def import_cashflows_csv(account_hash: str, csv_text: str) -> dict:
    """Import deposits/withdrawals from a Schwab 'Transactions' CSV export.

    Dedup matches each CSV row to an existing row of the SAME amount within a few days
    (exact-date first, then a small window) — because Schwab dates a transfer on its
    posted date while the CSV 'as of' is the effective date. So re-importing the same
    file adds nothing, an overlap with the 60-day Schwab auto-pull isn't double-counted
    even though the dates differ, yet two genuine same-amount transfers on nearby days
    stay distinct."""
    import csv as _csvmod
    import io

    text = (csv_text or "").lstrip("﻿")
    if not text.strip():
        return {"ok": False, "error": "The file is empty.", "added": 0}
    try:
        rows = list(_csvmod.DictReader(io.StringIO(text)))
    except Exception as e:
        return {"ok": False, "error": f"Couldn't parse the CSV ({e}).", "added": 0}
    if not rows:
        return {"ok": False, "error": "No data rows in the file.", "added": 0}

    # Case/space-tolerant column lookup (Schwab headers: Date, Action, Amount, …).
    def col(r: dict, name: str) -> str | None:
        for k, v in r.items():
            if k and k.strip().lower() == name:
                return v
        return None

    if col(rows[0], "amount") is None or col(rows[0], "date") is None:
        return {"ok": False, "error": "This doesn't look like a Schwab transactions export (no Date/Amount columns).", "added": 0}

    parsed: list[tuple[date, float, str]] = []
    skipped_nontransfer = bad = 0
    for r in rows:
        action = (col(r, "action") or "").strip()
        al = action.lower()
        if not (any(k in al for k in _CSV_TRANSFER_KEYS) and not any(x in al for x in _CSV_TRANSFER_EXCLUDE)):
            skipped_nontransfer += 1
            continue
        d = _parse_csv_date(col(r, "date"))
        amt = _parse_money(col(r, "amount"))
        if d is None or amt is None or amt == 0 or not math.isfinite(amt):
            bad += 1
            continue
        memo = ((col(r, "description") or action).strip()[:256]) or action or "transfer"
        parsed.append((d, round(amt, 2), memo))

    if not parsed:
        return {"ok": True, "added": 0, "parsed": 0, "skipped_existing": 0,
                "skipped_nontransfer": skipped_nontransfer, "bad": bad,
                "note": "No deposit/withdrawal (transfer) rows found in this file."}

    # Dedup by AMOUNT within a few days, not exact date: Schwab dates a transfer on its
    # POSTED/settlement date while the CSV "as of" is the EFFECTIVE date, so the same
    # transfer differs by a day or two (e.g. Schwab 07-01 vs CSV 06-30). Two passes:
    #   1) exact (same day, same amount)  — so a re-import matches perfectly and is a no-op
    #   2) same amount within a window    — absorbs the posted-vs-effective gap
    # Each existing row is claimed at most once, so two genuine same-amount transfers on
    # nearby days aren't collapsed into one (pass 1 pins the exact ones first).
    from collections import defaultdict
    async with SessionLocal() as s:
        existing_rows = (
            await s.execute(select(CashFlow.day, CashFlow.amount).where(CashFlow.account_hash == account_hash))
        ).all()
    # amount -> list of [day, claimed] for still-unmatched existing rows
    by_amount: dict[float, list] = defaultdict(list)
    for (rd, ra) in existing_rows:
        by_amount[round(_f(ra), 2)].append([rd, False])

    added = skipped_existing = 0
    unmatched: list[tuple[date, float, str]] = []
    # pass 1 — exact day+amount
    for (d, a, memo) in sorted(parsed, key=lambda t: t[0]):
        hit = next((e for e in by_amount.get(a, []) if not e[1] and e[0] == d), None)
        if hit is not None:
            hit[1] = True
            skipped_existing += 1
        else:
            unmatched.append((d, a, memo))
    # pass 2 — nearest same-amount row within the window
    to_insert: list[tuple[date, float, str]] = []
    for (d, a, memo) in unmatched:
        best = None  # (entry, day_diff)
        for e in by_amount.get(a, []):
            if e[1]:
                continue
            diff = abs((e[0] - d).days)
            if diff <= _CSV_DEDUP_WINDOW_DAYS and (best is None or diff < best[1]):
                best = (e, diff)
        if best is not None:
            best[0][1] = True
            skipped_existing += 1
        else:
            to_insert.append((d, a, memo))

    async with SessionLocal() as s:
        for (d, a, memo) in to_insert:
            s.add(CashFlow(
                account_hash=account_hash, day=d, amount=a,
                kind="deposit" if a > 0 else "withdrawal",
                source="csv", memo=memo, schwab_txn_id=None,
            ))
            added += 1
        await s.commit()
    return {"ok": True, "added": added, "parsed": len(parsed),
            "skipped_existing": skipped_existing, "skipped_nontransfer": skipped_nontransfer,
            "bad": bad}


# ----- daily_balance snapshots (the head-start for balance-derived metrics) -----

async def latest_balance(account_hash: str) -> dict:
    async with SessionLocal() as s:
        row = (
            await s.execute(
                select(DailyBalance).where(DailyBalance.account_hash == account_hash)
                .order_by(DailyBalance.day.desc()).limit(1)
            )
        ).scalar_one_or_none()
    if row is None:
        return {"balance_blocked": True, "reason": "no daily_balance snapshots yet"}
    return {
        "balance_blocked": False,
        "day": row.day.isoformat(),
        "balance": _f(row.balance),
        "capital_gains": _f(row.capital_gains),
        "gross_sales": _f(row.gross_sales),
    }


async def write_snapshot(account_hash: str, balance: float | None) -> dict:
    """Upsert today's daily_balance row for the account. balance comes from Schwab;
    capital_gains/gross_sales for today are computed from completed_trade."""
    today = _today()
    async with SessionLocal() as s:
        cg, gross = (
            await s.execute(
                select(
                    func.coalesce(func.sum(CompletedTrade.profit), 0),
                    func.coalesce(func.sum(CompletedTrade.sell_price * CompletedTrade.shares), 0),
                ).where(CompletedTrade.account_hash == account_hash,
                        CompletedTrade.completed_at == today)
            )
        ).one()
        # Atomic upsert on the (account_hash, day) PK — a get-then-add would let two
        # concurrent snapshots (scheduler + a manual /snapshot) collide on INSERT.
        # balance is only overwritten when provided (don't clobber a good value w/ NULL).
        set_ = {"capital_gains": _f(cg), "gross_sales": _f(gross)}
        if balance is not None:
            set_["balance"] = balance
        stmt = (
            pg_insert(DailyBalance)
            .values(account_hash=account_hash, day=today, balance=balance,
                    capital_gains=_f(cg), gross_sales=_f(gross))
            .on_conflict_do_update(index_elements=["account_hash", "day"], set_=set_)
        )
        await s.execute(stmt)
        await s.commit()
    return {"day": today.isoformat(), "balance": balance, "capital_gains": _f(cg), "gross_sales": _f(gross)}


# --------- nightly balance snapshot scheduler (in-process, always-on app) ---------

async def _snapshot_all_accounts() -> None:
    """Snapshot every visible account's balance for today (keyed per account_hash
    so each account's series stays complete regardless of which one is selected).
    Accounts with an unreadable balance are skipped — a NULL-balance row would
    surface as $0 in the ledger."""
    from . import accounts as accounts_svc
    from . import rebuild as rebuild_svc

    info = await accounts_svc.list_accounts()
    today = _today()
    for acct in info.get("accounts", []):
        h, bal = acct.get("hash"), acct.get("liquidation_value")
        if not h:
            continue
        if not acct.get("tradable", True):
            # get_account failed for this account (restricted/unreadable) — a resync
            # would only spend failing API calls and no-op. Skip it entirely.
            print(f"[snapshot] skip {h[-4:]}: not readable")
            continue
        # Refresh holdings from Schwab (source of truth) before snapshotting:
        # reconstruct from fills + reconcile against current positions (one path).
        try:
            await rebuild_svc.resync_account(h)
        except Exception as e:
            print(f"[snapshot] sync failed for {h[-4:]}: {e!r}")
        if bal is None:  # don't write a NULL-balance row (would read as $0)
            print(f"[snapshot] skip {h[-4:]} day={today}: balance unreadable")
            continue
        try:
            await write_snapshot(h, bal)
            print(f"[snapshot] {h[-4:]} day={today} bal={bal}")
        except Exception as e:
            print(f"[snapshot] failed for {h[-4:]}: {e!r}")


async def run_snapshot_scheduler() -> None:
    """Once per trading day, after the close, snapshot every account into
    daily_balance. Started in main.py lifespan. We snapshot only after observing
    the market actually OPEN today (session regular/post) and then in post/closed
    — so we never fire pre-open (overnight 'closed'), on weekends/holidays (market
    never opens), or re-fire after a restart. write_snapshot makes repeats safe."""
    last_day = None
    seen_open_day = None  # the trading day we last observed the market live-open
    while True:
        try:
            from . import screener as screener_svc

            hours = await screener_svc.market_hours()
            session = hours.get("session")
            now = datetime.now(MARKET_TZ)
            today = _today()
            if session in ("regular", "post"):
                seen_open_day = today
            # Fire once/day, after the market opened today, during/after post-close.
            if session in ("post", "closed") and seen_open_day == today and last_day != today:
                await _snapshot_all_accounts()
                try:
                    from . import notifications as _notif
                    pruned = await _notif.prune_audit_log()
                    if pruned:
                        print(f"[audit] pruned {pruned} old audit rows")
                except Exception as e:
                    print(f"[audit] prune failed: {e!r}")
                last_day = today

            if last_day == today:  # done for today → resume ~13:00 MARKET_TZ tomorrow
                tgt = (now + timedelta(days=1)).replace(hour=13, minute=0, second=0, microsecond=0)
                secs = max((tgt - now).total_seconds(), 600)
            else:
                secs = 600  # ~10-min poll near the close (matches market_hours cache)
            await asyncio.sleep(secs)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # a transient API/token error must not kill the loop
            print(f"[snapshot] scheduler error: {e!r}")
            await asyncio.sleep(600)
