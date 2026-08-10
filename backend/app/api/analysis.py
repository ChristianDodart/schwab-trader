"""Method-health endpoint: read-only risk lenses over the current book + realized
record for the active account. Assembles plain facts from the DB + live quotes and
hands them to the pure functions in strategy/analysis.py. Places no orders; advisory
only. See the Method tab."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter
from sqlalchemy import select

from .. import config_store, grouping
from ..db import SessionLocal
from ..db.models import CompletedTrade, Lot, Ticker
from ..ledger import get_etf_links
from ..schwab import hub
from ..strategy import analysis
from ._shared import _selected

router = APIRouter()


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


@router.get("/api/strategy-analysis")
async def strategy_analysis(account_hash: str | None = None) -> dict:
    acct = account_hash or await _selected()
    cfg = await config_store.get_strategy(acct)
    async with SessionLocal() as s:
        lots = (await s.execute(
            select(Lot).where(Lot.account_hash == acct).order_by(Lot.symbol, Lot.rung)
        )).scalars().all()
        tickers = {t.symbol: t for t in (await s.execute(select(Ticker))).scalars().all()}
        profits = (await s.execute(
            select(CompletedTrade.profit).where(CompletedTrade.account_hash == acct)
        )).scalars().all()
    etf_overrides = await get_etf_links(acct)

    by: dict[str, list[Lot]] = {}
    for lot in lots:
        by.setdefault(lot.symbol, []).append(lot)
    known = set(tickers.keys()) | set(by.keys())
    today = date.today()

    conc_in, stress_in, thesis_in = [], [], []
    for sym, sym_lots in by.items():
        tk = tickers.get(sym)
        quote = hub.latest.get(sym, {})
        price = _f(quote.get("last")) if quote.get("last") is not None else 0.0
        priced = [lot for lot in sym_lots if _f(lot.buy_price) > 0]
        shares = sum(_f(lot.shares) for lot in sym_lots)
        invested = sum(_f(lot.shares) * _f(lot.buy_price) for lot in priced)
        if not priced or shares <= 0:
            continue
        buy_prices = [_f(lot.buy_price) for lot in priced]
        first_buy = buy_prices[0]                 # lots are rung-ordered: rung 1 = first entry
        min_buy = min(buy_prices)
        first_date = min((lot.buy_date for lot in sym_lots if lot.buy_date), default=None)
        days_held = (today - first_date).days if first_date else 0
        value = shares * price if price > 0 else invested
        underlying = grouping.resolve_underlying(
            tk.name if tk else None, tk.industry if tk else None, known, sym, etf_overrides)

        conc_in.append({"symbol": sym, "underlying": underlying, "value": value})
        if price > 0:
            stress_in.append({"symbol": sym, "shares": shares, "invested": invested,
                              "price": price, "lots_deep": len(sym_lots)})
            thesis_in.append({"symbol": sym, "price": price, "first_buy": first_buy,
                              "min_buy": min_buy, "lots_deep": len(sym_lots), "days_held": days_held})

    cap = float(cfg.guardrails.get("max_position_pct_of_portfolio", 0.05))
    target_lots = int(cfg.guardrails.get("target_lots_deep", 6))
    drops = [float(d) for d in cfg.guardrails.get("stress_drops", [0.10, 0.25, 0.50])]

    wins = sum(1 for p in profits if _f(p) > 0)
    losses = sum(1 for p in profits if _f(p) < 0)
    avg_win = (sum(_f(p) for p in profits if _f(p) > 0) / wins) if wins else 0.0
    avg_loss = (sum(-_f(p) for p in profits if _f(p) < 0) / losses) if losses else 0.0
    account_value = sum(c["value"] for c in conc_in)

    breaks = [b for b in (analysis.thesis_break(p, cfg) for p in thesis_in) if b]
    return {
        "as_of": today.isoformat(),
        "held_count": len(stress_in),
        "concentration": {
            "cap": cap,
            "rows": analysis.concentration_by_underlying(conc_in, cap),
        },
        "stress": {
            "drops": drops,
            **analysis.ladder_stress(stress_in, drops, target_lots),
        },
        "thesis_breaks": breaks,
        "kelly": analysis.kelly_sizing(wins, losses, avg_win, avg_loss, account_value, cfg),
    }
