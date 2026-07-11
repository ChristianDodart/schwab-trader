"""Ledger endpoints (/api/ledger/*) plus the benchmark-symbol setting, the
positions rollup, and the daily balance snapshot pair."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Response
from pydantic import BaseModel

from .. import accounts as accounts_svc
from .. import ledger as ledger_svc
from ..main import CsvImportBody, _csv_response, _selected

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/ledger/summary")
async def ledger_summary() -> dict:
    return await ledger_svc.build_summary(await _selected())


@router.get("/api/ledger/cap-gains")
async def ledger_cap_gains(grain: str = "month", start: str | None = None, end: str | None = None) -> dict:
    return await ledger_svc.build_cap_gains(
        grain, await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end)
    )


@router.get("/api/ledger/activity")
async def ledger_activity(grain: str = "week", start: str | None = None, end: str | None = None) -> dict:
    """Gross dollars bought and sold per period (day/week/month/year) from the fill log."""
    return await ledger_svc.build_activity(
        grain, await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end)
    )


@router.get("/api/ledger/tax")
async def ledger_tax() -> dict:
    return await ledger_svc.build_tax(await _selected())


@router.get("/api/ledger/historic")
async def ledger_historic(start: str | None = None, end: str | None = None) -> dict:
    """FACT tab: live balances + realized/contributions/series scoped to [start,end]
    (both omitted = all-time)."""
    acct = await _selected()
    # Opportunistic (hourly-throttled) activity sync so deposits, dividends, trade
    # fees, and margin interest stay current WITHOUT a manual pull — this is what
    # keeps the cash identity pinned between CSV imports. Best-effort: a failure
    # (offline, no token) must never block the ledger itself.
    try:
        await ledger_svc.sync_activity(acct)
    except Exception as e:
        log.warning(f"[ledger] opportunistic activity sync failed: {e!r}")
    return await ledger_svc.build_historic(
        acct, ledger_svc._parse_date(start), ledger_svc._parse_date(end)
    )


@router.get("/api/ledger/benchmark")
async def ledger_benchmark() -> dict:
    """Buy-and-hold benchmark: what the account's own dated contributions would be worth
    in the chosen benchmark instead. {available: False, reason} when not computable."""
    return await ledger_svc.build_benchmark(await _selected(), await ledger_svc.get_benchmark_symbol())


@router.get("/api/benchmark-symbol")
async def get_benchmark_symbol() -> dict:
    """The chosen buy-and-hold benchmark ticker (default SPY)."""
    return {"symbol": await ledger_svc.get_benchmark_symbol()}


class BenchmarkSymbolBody(BaseModel):
    symbol: str


@router.post("/api/benchmark-symbol")
async def set_benchmark_symbol(body: BenchmarkSymbolBody) -> dict:
    """Set the benchmark ticker used by the since-inception comparison."""
    return await ledger_svc.set_benchmark_symbol(body.symbol)


@router.get("/api/ledger/trades")
async def ledger_trades(start: str | None = None, end: str | None = None,
                        symbol: str | None = None) -> dict:
    """Trade journal + performance analytics (closed round-trips) for the selected account."""
    return await ledger_svc.build_trades(
        await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end), symbol
    )


@router.get("/api/ledger/trades.csv")
async def ledger_trades_csv(start: str | None = None, end: str | None = None,
                            symbol: str | None = None) -> Response:
    """Trade journal as a downloadable CSV (respects the current period/symbol filter)."""
    d = await ledger_svc.build_trades(
        await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end), symbol
    )
    headers = ["Closed", "Opened", "Symbol", "Shares", "Buy", "Sell", "Cost", "Profit", "Hold days", "Day trade"]
    rows = [[t["completed_at"], t["opened_at"], t["symbol"], t["shares"], t["buy_price"],
             t["sell_price"], t["cost"], t["profit"], t["hold_days"], "yes" if t["is_day_trade"] else ""]
            for t in d["trades"]]
    return _csv_response("schwab-trades", headers, rows)


@router.get("/api/ledger/tax-lots.csv")
async def ledger_tax_lots_csv(year: int) -> Response:
    """Closed round-trips for a CALENDAR YEAR, formatted for tax filing: acquired/sold
    dates, proceeds, cost basis, gain/loss, and the short/long-term flag (held >= 365 days
    = long-term). Sale date = completed_at, so a lot lands in the year it was SOLD."""
    d = await ledger_svc.build_trades(
        await _selected(),
        ledger_svc._parse_date(f"{year}-01-01"),
        ledger_svc._parse_date(f"{year}-12-31"),
        None,
    )
    headers = ["Symbol", "Shares", "Acquired", "Sold", "Proceeds", "Cost basis", "Gain/Loss", "Term"]
    rows = []
    for t in d["trades"]:
        hold = t.get("hold_days")
        term = "Long-term" if (hold is not None and hold >= 365) else "Short-term"
        proceeds = round((t.get("sell_price") or 0) * (t.get("shares") or 0), 2)
        rows.append([t["symbol"], t["shares"], t["opened_at"], t["completed_at"],
                     proceeds, t["cost"], t["profit"], term])
    return _csv_response(f"schwab-tax-lots-{year}", headers, rows)


@router.get("/api/ledger/dividends")
async def ledger_dividends() -> dict:
    """Stored dividend/income rows + all-time & YTD totals for the selected account."""
    return await ledger_svc.get_dividends(await _selected())


@router.post("/api/ledger/dividends/refresh")
async def ledger_dividends_refresh() -> dict:
    """Force a full activity sync (one Schwab call: dividends + transfers + fees +
    margin interest) and report the dividend part in the shape the button expects."""
    r = await ledger_svc.sync_activity(await _selected(), force=True)
    if not r.get("ok"):
        return r
    return {"ok": True, "added": r.get("dividends_added", 0), "total": r.get("dividends_total")}


@router.get("/api/ledger/dividends.csv")
async def ledger_dividends_csv() -> Response:
    """The stored dividend/income log as a downloadable CSV."""
    d = await ledger_svc.get_dividends(await _selected())
    headers = ["Date", "Symbol", "Amount", "Type"]
    rows = [[r.get("day"), r.get("symbol") or "", r.get("amount"), r.get("type") or ""] for r in d.get("rows", [])]
    return _csv_response("schwab-dividends", headers, rows)


@router.get("/api/ledger/projection")
async def ledger_projection() -> dict:
    """PREDICTION tab: this-year annualized gains, goal pacing, and tax estimate."""
    return await ledger_svc.build_projection(await _selected())


class CashFlowBody(BaseModel):
    day: str                    # ISO date
    amount: float               # + deposit, - withdrawal
    memo: str | None = None


@router.get("/api/ledger/cashflows")
async def ledger_cashflows(start: str | None = None, end: str | None = None) -> dict:
    return await ledger_svc.list_cashflows(
        await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end)
    )


@router.get("/api/ledger/cashflows.csv")
async def ledger_cashflows_csv(start: str | None = None, end: str | None = None) -> Response:
    """Deposit/withdrawal log as a downloadable CSV (respects the current period)."""
    d = await ledger_svc.list_cashflows(
        await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end)
    )
    headers = ["Date", "Amount", "Kind", "Source", "Memo"]
    rows = [[r["day"], r["amount"], r["kind"], r["source"], r.get("memo") or ""] for r in d["rows"]]
    return _csv_response("schwab-deposits", headers, rows)


@router.post("/api/ledger/cashflows")
async def ledger_add_cashflow(body: CashFlowBody) -> dict:
    return await ledger_svc.add_cashflow(await _selected(), body.day, body.amount, body.memo)


@router.delete("/api/ledger/cashflows/{cf_id}")
async def ledger_delete_cashflow(cf_id: int) -> dict:
    return await ledger_svc.delete_cashflow(await _selected(), cf_id)


@router.post("/api/ledger/cashflows/refresh")
async def ledger_refresh_cashflows() -> dict:
    """Force a full activity sync (one Schwab call: transfers + dividends + fees +
    margin interest) and report the transfer part in the shape the button expects."""
    r = await ledger_svc.sync_activity(await _selected(), force=True)
    if not r.get("ok"):
        return {"ok": False, "error": r.get("error", "Schwab transactions unavailable"),
                "added": 0, "window_days": 60}
    return {"ok": True, "added": r.get("transfers_added", 0), "window_days": 60}


@router.post("/api/ledger/cashflows/import")
async def ledger_import_cashflows(body: CsvImportBody) -> dict:
    """Import deposits/withdrawals from a pasted Schwab transactions CSV — count-based
    dedup so re-imports and 60-day-pull overlaps don't double-count."""
    return await ledger_svc.import_cashflows_csv(await _selected(), body.csv)


@router.post("/api/ledger/dividends/import")
async def ledger_dividends_import(body: CsvImportBody) -> dict:
    """Import dividend/interest income from a Schwab Transactions CSV (full history, beyond
    the 60-day live pull); deduped against existing rows."""
    return await ledger_svc.import_dividends_csv(await _selected(), body.csv)


@router.get("/api/positions")
async def positions() -> dict:
    return await ledger_svc.build_positions(await _selected())


@router.get("/api/ledger/reg-trading")
async def ledger_reg_trading() -> dict:
    return {"blocked": True, "reason": "requires a daily_balance series + a withdrawals input"}


@router.get("/api/account/balance")
async def account_balance() -> dict:
    return await ledger_svc.latest_balance(await _selected())


@router.post("/api/account/snapshot")
async def account_snapshot() -> dict:
    """Record today's balance snapshot for the selected account."""
    acct = await accounts_svc.selected_account_positions()
    return await ledger_svc.write_snapshot(await _selected(), acct.get("liquidation_value"))
