"""FastAPI app — Phase 1: prove the pipe (OAuth-ready, DB, live quote -> browser)."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import text

from . import accounts as accounts_svc
from . import backup as backup_svc
from . import bulk as bulk_svc
from . import config_store
from . import credentials as credentials_svc
from . import ledger as ledger_svc
from . import market_data as market_svc
from . import notifications as notifications_svc
from . import orders as orders_svc
from . import phone as phone_svc
from . import profiles as profiles_svc
from . import rebuild as rebuild_svc
from . import screener as screener_svc
from . import watchlist as watchlist_svc
from .config import settings
from .dashboard import build_dashboard, build_position_detail, invalidate_dashboard_cache
from .db import SessionLocal, init_db
from .schwab import hub, run_activity_resync, run_quote_stream
from .schwab.auth import begin_reauth, complete_reauth, get_client, token_status
from .schwab.auth import probe_live as auth_probe_live
from .schwab.enrich import enrich_tickers
from .strategy import StrategyConfig
from .version import APP_VERSION

strategy = StrategyConfig.load()


async def _enrich_on_startup() -> None:
    try:
        client = get_client()
    except Exception:
        client = None
    if client is not None:
        await enrich_tickers(client)


async def _liveness_prober() -> None:
    """Background heartbeat: keep the token-liveness state fresh so the banner is
    accurate even between UI polls. probe_live() no-ops when a recent stream heartbeat
    already proves life, so a healthy stream means ~no extra Schwab calls."""
    while True:
        try:
            await auth_probe_live()
        except Exception:
            pass
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Load/seed profiles FIRST — Schwab creds are now per-profile (scoped to the active
    # profile), and get_client()/the quote stream resolve the active profile's token, so
    # the active pointer must be set before creds or any client is built. A migration
    # hiccup must not brick startup — degrade to no-active-profile (DEMO) and resume next boot.
    try:
        await profiles_svc.ensure_default()
    except Exception as e:
        print(f"[profiles] ensure_default failed ({e!r}); starting without an active profile.")
    # Resolve Schwab API creds (per-profile DB over legacy-global over .env) for the active profile.
    try:
        await credentials_svc.load()
    except Exception as e:
        print(f"[credentials] load failed ({e!r}); using .env defaults.")
    app.state.stream_task = asyncio.create_task(run_quote_stream())
    enrich_task = asyncio.create_task(_enrich_on_startup())
    alert_task = asyncio.create_task(notifications_svc.run_alert_watcher())
    resync_task = asyncio.create_task(run_activity_resync())
    snapshot_task = asyncio.create_task(ledger_svc.run_snapshot_scheduler())
    liveness_task = asyncio.create_task(_liveness_prober())
    backup_task = asyncio.create_task(backup_svc.run_backup_scheduler())
    from . import strategy_triggers
    strategy_task = asyncio.create_task(strategy_triggers.run_strategy_trigger_watcher())
    try:
        yield
    finally:
        # Cancel AND await so a task mid-DB-transaction (e.g. resync inside a
        # rebuild) unwinds cleanly before the loop shuts down.
        tasks = [app.state.stream_task, enrich_task, alert_task, resync_task, snapshot_task,
                 liveness_task, backup_task, strategy_task]
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="Schwab Trader", version=APP_VERSION, lifespan=lifespan)

# CORS only in DEV: Vite (:5173) calls the backend (:8000) cross-origin. In the
# PACKAGED app the backend serves the SPA same-origin (SCHWAB_FRONTEND_DIR set /
# frozen), so no CORS is needed — and NOT enabling it there keeps the unauthenticated
# local trading API from being reachable cross-origin by any web page.
import os as _cors_os  # noqa: E402
import sys as _cors_sys  # noqa: E402

if not (_cors_os.environ.get("SCHWAB_FRONTEND_DIR") or getattr(_cors_sys, "frozen", False)):
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/health")
async def health() -> dict:
    db_ok = True
    try:
        async with SessionLocal() as s:
            await s.execute(text("SELECT 1"))
    except Exception as e:
        db_ok = False
        db_err = repr(e)
    return {
        "status": "ok" if db_ok else "degraded",
        "version": APP_VERSION,
        "database": "connected" if db_ok else db_err,  # type: ignore[name-defined]
        "stream_mode": hub.mode,
        "watchlist": settings.watchlist_symbols,
    }


@app.get("/api/version")
async def app_version() -> dict:
    """Which build am I running? Single source: app/version.py (synced to the
    installer version by build-installer.ps1)."""
    return {"version": APP_VERSION, "data_dir": str(settings.data_dir)}


@app.get("/api/strategy/validate")
async def validate_strategy() -> dict:
    """Advisory sanity checks on the SELECTED account's strategy config (never blocks)."""
    from .strategy import validate as strategy_validate

    cfg = await config_store.get_strategy(await _selected())
    return {"findings": strategy_validate.check(cfg.to_mapping())}


@app.get("/api/backups")
async def get_backups() -> dict:
    """List database backups (newest first) + where they live."""
    return backup_svc.list_backups()


@app.post("/api/backup")
async def create_backup() -> dict:
    """Back up the trading database now (online, safe while running)."""
    return await backup_svc.run_backup()


@app.get("/api/strategy")
async def get_strategy() -> dict:
    """Expose the loaded (malleable) strategy config to the UI."""
    return {
        "sizing_tiers": [t.__dict__ for t in strategy.sizing_tiers],
        "max_rungs": strategy.max_rungs,
        "ladder_drops": [d.__dict__ for d in strategy.ladder_drops],
        "sell": strategy.sell.__dict__,
        "guardrails": strategy.guardrails,
        "universe": strategy.universe,
    }


@app.get("/api/quotes")
async def latest_quotes() -> dict:
    return {"mode": hub.mode, "quotes": hub.latest}


@app.get("/api/auth/status")
async def auth_status() -> dict:
    """Schwab token health. Actively verifies liveness with a cheap authenticated call
    (cached ~45s; a healthy stream counts as fresh) so 'connected' reflects a real
    round-trip, not just the token-file timestamp."""
    await auth_probe_live()
    return token_status()


@app.post("/api/auth/check")
async def auth_check() -> dict:
    """Force an immediate liveness probe (the banner's 'Check now' button)."""
    await auth_probe_live(force=True)
    return token_status()


class SchwabCredsBody(BaseModel):
    client_id: str | None = None
    client_secret: str | None = None
    callback_url: str | None = None


@app.get("/api/schwab-creds")
async def get_schwab_creds() -> dict:
    """Active profile's Schwab API credential status (never returns the secret)."""
    return credentials_svc.status()


@app.get("/api/schwab-creds/reveal")
async def reveal_schwab_creds() -> dict:
    """Full creds for the active profile — backs the Settings reveal/copy controls
    (local single-user app; served over localhost only)."""
    return credentials_svc.reveal()


@app.post("/api/schwab-creds")
async def set_schwab_creds(body: SchwabCredsBody) -> dict:
    """Save this install's own Schwab developer-app creds (blank secret keeps the
    existing one). Takes effect on the next client build."""
    return await credentials_svc.set_creds(body.client_id, body.client_secret, body.callback_url)


class FmpKeyBody(BaseModel):
    key: str


@app.get("/api/fmp-status")
async def get_fmp_status() -> dict:
    """Whether an optional Financial Modeling Prep key is configured (never the key)."""
    return await credentials_svc.fmp_status()


@app.post("/api/fmp-key")
async def set_fmp_key(body: FmpKeyBody) -> dict:
    """Save the optional FMP key (Fernet-encrypted). Powers sector/industry/country auto-tagging."""
    return await credentials_svc.set_fmp_key(body.key)


class PhoneNotifyBody(BaseModel):
    channel: str | None = None       # "off" | "ntfy" | "email"
    ntfy_url: str | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_pass: str | None = None     # blank = keep the stored one
    smtp_from: str | None = None
    smtp_to: str | None = None
    smtp_tls: bool | None = None
    cat_alerts: bool | None = None
    cat_triggers: bool | None = None
    cat_fills: bool | None = None


@app.get("/api/phone-notify")
async def get_phone_notify() -> dict:
    """Phone-notification config, secret-free (never returns the SMTP password)."""
    return await phone_svc.status()


@app.post("/api/phone-notify")
async def set_phone_notify(body: PhoneNotifyBody) -> dict:
    """Save the optional phone channel (ntfy topic or SMTP; password Fernet-encrypted)."""
    return await phone_svc.set_config(body.model_dump(exclude_none=True))


@app.post("/api/phone-notify/test")
async def test_phone_notify() -> dict:
    """Send a test message on the current config and report success/failure."""
    return await phone_svc.send_test()


class EnrichBody(BaseModel):
    force: bool = False


@app.post("/api/tickers/enrich")
async def enrich_tickers(body: EnrichBody) -> dict:
    """Auto-tag every ticker's sector/industry/country from FMP (fills missing; force re-fetches)."""
    res = await watchlist_svc.enrich_all(force=body.force)
    invalidate_dashboard_cache()  # sector shows on the dashboard
    return res


class ReceivedUrlBody(BaseModel):
    received_url: str


@app.post("/api/auth/begin")
async def auth_begin() -> dict:
    """Start UI re-auth: returns the Schwab authorization URL to open."""
    return begin_reauth()


def _restart_stream() -> None:
    """Cancel and relaunch the quote stream so it reconnects with the CURRENT
    active-profile token (used after re-auth and after a profile switch)."""
    old = getattr(app.state, "stream_task", None)
    if old is not None:
        old.cancel()
    app.state.stream_task = asyncio.create_task(run_quote_stream())


@app.post("/api/auth/complete")
async def auth_complete(body: ReceivedUrlBody) -> dict:
    """Finish UI re-auth: exchange the pasted redirect URL for a fresh token,
    then restart the quote stream so the live feed reconnects with it."""
    result = await asyncio.to_thread(complete_reauth, body.received_url)
    if result.get("ok"):
        _restart_stream()
    return result


# ---- profiles (separate Schwab logins: Christian, Dave, …) ----

class ProfileCreateBody(BaseModel):
    name: str


class ProfileRenameBody(BaseModel):
    name: str


@app.get("/api/profiles")
async def get_profiles() -> dict:
    """List profiles + which is active + each one's connection/token status."""
    return await profiles_svc.list_profiles()


@app.post("/api/profiles")
async def create_profile(body: ProfileCreateBody) -> dict:
    return await profiles_svc.create_profile(body.name)


@app.post("/api/profiles/{pid}/activate")
async def activate_profile(pid: str) -> dict:
    """Switch active profile → its token becomes the one get_client() uses, and the
    live feed reconnects under it. The UI reloads so all views re-read under it."""
    result = await profiles_svc.set_active(pid)
    if result.get("ok"):
        await credentials_svc.load()  # creds are per-profile — load the new profile's
        _restart_stream()
    return result


@app.post("/api/profiles/{pid}/rename")
async def rename_profile(pid: str, body: ProfileRenameBody) -> dict:
    return await profiles_svc.rename_profile(pid, body.name)


@app.delete("/api/profiles/{pid}")
async def delete_profile(pid: str) -> dict:
    return await profiles_svc.delete_profile(pid)


@app.get("/api/accounts")
async def get_accounts() -> dict:
    """List Schwab accounts visible to the API + which one is selected."""
    return await accounts_svc.list_accounts()


class SelectAccountBody(BaseModel):
    hash: str


@app.post("/api/accounts/select")
async def post_select_account(body: SelectAccountBody) -> dict:
    return await accounts_svc.select_account(body.hash)


@app.get("/api/accounts/trading")
async def get_trading_account() -> dict:
    """The account orders go to (the selected account, if trading-enabled)."""
    return {"trading_hash": await accounts_svc.get_trading_account()}


async def _selected() -> str:
    return await accounts_svc.get_setting(accounts_svc._sel_key()) or ""


def _csv_response(name: str, headers: list[str], rows: list[list]) -> Response:
    """Build a downloadable CSV (stdlib csv → attachment). `name` gets today's date."""
    import csv
    import io
    from datetime import date as _date

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    fname = f"{name}-{_date.today().isoformat()}.csv"
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


class ConfigBody(BaseModel):
    trading_enabled: bool | None = None
    tax_filing: str | None = None
    tax_state_rate: float | None = None
    strategy: dict | None = None
    # Ledger predictive inputs — nullable (can be cleared). We use model_fields_set
    # below so an OMITTED field is left as-is while an explicit null clears it.
    year_end_goal: float | None = None
    other_annual_income: float | None = None


@app.get("/api/config")
async def get_config() -> dict:
    """Per-account config (strategy + trading-enable + tax) for the selected account."""
    return await config_store.get_config(await _selected())


@app.post("/api/config")
async def post_config(body: ConfigBody) -> dict:
    # Only forward the nullable ledger fields when the caller actually included them,
    # so a partial POST (e.g. just the goal from the ledger) doesn't wipe the other.
    extra = {}
    fs = body.model_fields_set
    if "year_end_goal" in fs:
        extra["year_end_goal"] = body.year_end_goal
    if "other_annual_income" in fs:
        extra["other_annual_income"] = body.other_annual_income
    return await config_store.set_config(
        await _selected(),
        trading_enabled=body.trading_enabled, tax_filing=body.tax_filing,
        tax_state_rate=body.tax_state_rate, strategy=body.strategy, **extra,
    )


class PrefBody(BaseModel):
    value: Any = None


@app.get("/api/prefs/{key}")
async def get_pref(key: str) -> dict:
    """Per-PROFILE UI preference (e.g. column layouts), JSON-decoded. Scoped to the
    active profile so each profile keeps its own layout; persists in the DB."""
    raw = await accounts_svc.get_setting(profiles_svc.pkey(f"uipref:{key}"))
    try:
        return {"key": key, "value": json.loads(raw) if raw else None}
    except (ValueError, TypeError):
        return {"key": key, "value": None}


@app.post("/api/prefs/{key}")
async def set_pref(key: str, body: PrefBody) -> dict:
    await accounts_svc.set_setting(profiles_svc.pkey(f"uipref:{key}"), json.dumps(body.value))
    return {"ok": True}


@app.get("/api/account/positions")
async def get_account_positions() -> dict:
    """Live positions/balances for the selected account (basis for reconciliation)."""
    return await accounts_svc.selected_account_positions()


@app.get("/api/ledger/summary")
async def ledger_summary() -> dict:
    return await ledger_svc.build_summary(await _selected())


@app.get("/api/ledger/cap-gains")
async def ledger_cap_gains(grain: str = "month", start: str | None = None, end: str | None = None) -> dict:
    return await ledger_svc.build_cap_gains(
        grain, await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end)
    )


@app.get("/api/ledger/tax")
async def ledger_tax() -> dict:
    return await ledger_svc.build_tax(await _selected())


@app.get("/api/ledger/historic")
async def ledger_historic(start: str | None = None, end: str | None = None) -> dict:
    """FACT tab: live balances + realized/contributions/series scoped to [start,end]
    (both omitted = all-time)."""
    return await ledger_svc.build_historic(
        await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end)
    )


@app.get("/api/ledger/benchmark")
async def ledger_benchmark() -> dict:
    """Buy-and-hold benchmark: what the account's own dated contributions would be worth
    in the chosen benchmark instead. {available: False, reason} when not computable."""
    return await ledger_svc.build_benchmark(await _selected(), await ledger_svc.get_benchmark_symbol())


@app.get("/api/benchmark-symbol")
async def get_benchmark_symbol() -> dict:
    """The chosen buy-and-hold benchmark ticker (default SPY)."""
    return {"symbol": await ledger_svc.get_benchmark_symbol()}


class BenchmarkSymbolBody(BaseModel):
    symbol: str


@app.post("/api/benchmark-symbol")
async def set_benchmark_symbol(body: BenchmarkSymbolBody) -> dict:
    """Set the benchmark ticker used by the since-inception comparison."""
    return await ledger_svc.set_benchmark_symbol(body.symbol)


@app.get("/api/ledger/trades")
async def ledger_trades(start: str | None = None, end: str | None = None,
                        symbol: str | None = None) -> dict:
    """Trade journal + performance analytics (closed round-trips) for the selected account."""
    return await ledger_svc.build_trades(
        await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end), symbol
    )


@app.get("/api/ledger/trades.csv")
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


@app.get("/api/ledger/tax-lots.csv")
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


@app.get("/api/ledger/dividends")
async def ledger_dividends() -> dict:
    """Stored dividend/income rows + all-time & YTD totals for the selected account."""
    return await ledger_svc.get_dividends(await _selected())


@app.post("/api/ledger/dividends/refresh")
async def ledger_dividends_refresh() -> dict:
    """Pull the trailing-60-day dividend window from Schwab and merge it in (idempotent)."""
    return await ledger_svc.refresh_dividends(await _selected())


@app.get("/api/ledger/dividends.csv")
async def ledger_dividends_csv() -> Response:
    """The stored dividend/income log as a downloadable CSV."""
    d = await ledger_svc.get_dividends(await _selected())
    headers = ["Date", "Symbol", "Amount", "Type"]
    rows = [[r.get("day"), r.get("symbol") or "", r.get("amount"), r.get("type") or ""] for r in d.get("rows", [])]
    return _csv_response("schwab-dividends", headers, rows)


@app.get("/api/ledger/projection")
async def ledger_projection() -> dict:
    """PREDICTION tab: this-year annualized gains, goal pacing, and tax estimate."""
    return await ledger_svc.build_projection(await _selected())


class CashFlowBody(BaseModel):
    day: str                    # ISO date
    amount: float               # + deposit, - withdrawal
    memo: str | None = None


@app.get("/api/ledger/cashflows")
async def ledger_cashflows(start: str | None = None, end: str | None = None) -> dict:
    return await ledger_svc.list_cashflows(
        await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end)
    )


@app.get("/api/ledger/cashflows.csv")
async def ledger_cashflows_csv(start: str | None = None, end: str | None = None) -> Response:
    """Deposit/withdrawal log as a downloadable CSV (respects the current period)."""
    d = await ledger_svc.list_cashflows(
        await _selected(), ledger_svc._parse_date(start), ledger_svc._parse_date(end)
    )
    headers = ["Date", "Amount", "Kind", "Source", "Memo"]
    rows = [[r["day"], r["amount"], r["kind"], r["source"], r.get("memo") or ""] for r in d["rows"]]
    return _csv_response("schwab-deposits", headers, rows)


@app.post("/api/ledger/cashflows")
async def ledger_add_cashflow(body: CashFlowBody) -> dict:
    return await ledger_svc.add_cashflow(await _selected(), body.day, body.amount, body.memo)


@app.delete("/api/ledger/cashflows/{cf_id}")
async def ledger_delete_cashflow(cf_id: int) -> dict:
    return await ledger_svc.delete_cashflow(await _selected(), cf_id)


@app.post("/api/ledger/cashflows/refresh")
async def ledger_refresh_cashflows() -> dict:
    """Pull the trailing 60 days of transfers from Schwab (idempotent upsert)."""
    return await ledger_svc.refresh_cashflows_from_schwab(await _selected())


class CsvImportBody(BaseModel):
    csv: str                    # raw text of a Schwab "Transactions" CSV export


@app.post("/api/ledger/cashflows/import")
async def ledger_import_cashflows(body: CsvImportBody) -> dict:
    """Import deposits/withdrawals from a pasted Schwab transactions CSV — count-based
    dedup so re-imports and 60-day-pull overlaps don't double-count."""
    return await ledger_svc.import_cashflows_csv(await _selected(), body.csv)


@app.post("/api/ledger/dividends/import")
async def ledger_dividends_import(body: CsvImportBody) -> dict:
    """Import dividend/interest income from a Schwab Transactions CSV (full history, beyond
    the 60-day live pull); deduped against existing rows."""
    return await ledger_svc.import_dividends_csv(await _selected(), body.csv)


@app.get("/api/positions")
async def positions() -> dict:
    return await ledger_svc.build_positions(await _selected())


class NoteBody(BaseModel):
    text: str


@app.get("/api/positions/{symbol}/note")
async def get_position_note(symbol: str) -> dict:
    """The free-text journal note for a symbol on the selected account."""
    return {"symbol": symbol.upper(), "note": await ledger_svc.get_note(await _selected(), symbol)}


@app.put("/api/positions/{symbol}/note")
async def set_position_note(symbol: str, body: NoteBody) -> dict:
    """Save (or clear, when blank) the journal note for a symbol."""
    return await ledger_svc.set_note(await _selected(), symbol, body.text)


@app.get("/api/account/margin")
async def account_margin() -> dict:
    """Capital-deployment / leverage summary for the selected account."""
    return await accounts_svc.margin_summary(await _selected())


@app.get("/api/price-history/{symbol}")
async def price_history(symbol: str, range: str = "6M") -> dict:
    return await market_svc.price_history(symbol, range)


class AddTickerBody(BaseModel):
    symbol: str


@app.post("/api/tickers")
async def add_ticker(body: AddTickerBody) -> dict:
    return await watchlist_svc.add_ticker(body.symbol)


@app.delete("/api/tickers/{symbol}")
async def remove_ticker(symbol: str) -> dict:
    return await watchlist_svc.remove_ticker(symbol)


class SectorBody(BaseModel):
    sector: str | None = None


@app.put("/api/tickers/{symbol}/sector")
async def set_ticker_sector(symbol: str, body: SectorBody) -> dict:
    """Tag a ticker's sector (user-maintained — Schwab omits it)."""
    res = await watchlist_svc.set_sector(symbol, body.sector)
    invalidate_dashboard_cache()  # sector shows on the dashboard + drives concentration
    return res


# ---------- price-hit alerts & notifications ----------

class AlertBody(BaseModel):
    symbol: str
    direction: str            # above | below
    threshold: float
    note: str | None = None
    repeat: bool = False


@app.get("/api/alerts")
async def list_alerts() -> dict:
    return await notifications_svc.list_alerts()


@app.post("/api/alerts")
async def create_alert(body: AlertBody) -> dict:
    return await notifications_svc.create_alert(
        body.symbol, body.direction, body.threshold, body.note, body.repeat
    )


@app.delete("/api/alerts/{alert_id}")
async def delete_alert(alert_id: int) -> dict:
    return await notifications_svc.delete_alert(alert_id)


@app.get("/api/notifications")
async def list_notifications(limit: int = 50) -> dict:
    return await notifications_svc.list_notifications(limit)


@app.get("/api/audit")
async def list_audit(limit: int = 100) -> dict:
    """The quiet activity log — every fill (incl. market), reviewed on demand."""
    return await notifications_svc.list_audit(limit)


@app.post("/api/notifications/read-all")
async def read_all_notifications() -> dict:
    return await notifications_svc.mark_all_read()


@app.post("/api/notifications/{note_id}/read")
async def read_notification(note_id: int) -> dict:
    return await notifications_svc.mark_read(note_id)


# ---------- market discovery & screening ----------

@app.get("/api/market-hours")
async def market_hours() -> dict:
    return await screener_svc.market_hours()


@app.get("/api/movers")
async def movers(index: str = "EQUITY_ALL", sort: str = "PERCENT_CHANGE_UP") -> dict:
    return await screener_svc.movers(index, sort)


@app.get("/api/screener/candidates")
async def screen_candidates(index: str = "EQUITY_ALL", sort: str = "PERCENT_CHANGE_UP") -> dict:
    """Screen a candidate POOL (today's movers + your watchlist) against the strategy
    universe — cap band, country, sector-exclusion, no-ETF. Free (Schwab movers + FMP
    profiles), not a whole-market scan."""
    return await screener_svc.screen_candidates(await _selected(), index, sort)


@app.get("/api/screen/{symbol}")
async def screen_symbol(symbol: str) -> dict:
    """Fundamentals for one symbol + pass/fail vs the selected account's guardrails."""
    return await screener_svc.vet(symbol, await _selected())


@app.websocket("/ws/notifications")
async def ws_notifications(ws: WebSocket) -> None:
    """Push each newly-fired notification to the browser as it happens."""
    await ws.accept()
    queue = notifications_svc.subscribe_feed()
    try:
        while True:
            note = await queue.get()
            await ws.send_json(note)
    except WebSocketDisconnect:
        pass
    finally:
        notifications_svc.unsubscribe_feed(queue)


# ---------- Phase 5: trading ----------

class PlaceOrderBody(BaseModel):
    symbol: str
    side: str                       # BUY | SELL
    quantity: int
    order_type: str = "LIMIT"       # MARKET | LIMIT | STOP | STOP_LIMIT | TRAILING_STOP
    limit_price: float | None = None
    stop_price: float | None = None
    trailing_offset: float | None = None
    trailing_type: str = "PERCENT"  # PERCENT | VALUE
    duration: str = "DAY"           # DAY | GOOD_TILL_CANCEL | FILL_OR_KILL | IMMEDIATE_OR_CANCEL
    session: str = "NORMAL"         # NORMAL | AM | PM | SEAMLESS
    account_hash: str | None = None
    confirm: bool = False           # override the fat-finger (limit-far-from-market) guard


@app.get("/api/orders")
async def list_orders(days: int = 7, account_hash: str | None = None) -> dict:
    return {"orders": await orders_svc.list_orders(days, account_hash)}


@app.get("/api/orders/working-count")
async def orders_working_count() -> dict:
    """Count of still-working orders on the selected account (drives the nav badge)."""
    return {"count": await orders_svc.working_count()}


@app.get("/api/orders/{order_id}")
async def get_order(order_id: str, account_hash: str | None = None) -> dict:
    return await orders_svc.get_order(order_id, account_hash)


@app.post("/api/orders")
async def place_order(body: PlaceOrderBody) -> dict:
    return await orders_svc.place_order(
        body.symbol, body.side, body.quantity, body.order_type,
        limit_price=body.limit_price, stop_price=body.stop_price,
        trailing_offset=body.trailing_offset, trailing_type=body.trailing_type,
        duration=body.duration, session=body.session,
        account_hash=body.account_hash, confirm=body.confirm,
    )


@app.delete("/api/orders/{order_id}")
async def cancel_order(order_id: str, account_hash: str | None = None) -> dict:
    return await orders_svc.cancel_order(order_id, account_hash)


@app.get("/api/suggest/buy/{symbol}")
async def suggest_buy(symbol: str) -> dict:
    return await orders_svc.suggest_buy(symbol, await _selected())


@app.get("/api/suggest/sell/{lot_id}")
async def suggest_sell(lot_id: int) -> dict:
    return await orders_svc.suggest_sell(lot_id, await _selected())


# ---- bulk actions (harvest profitable last-positions / buy triggered dips) ----
class BulkSellItem(BaseModel):
    lot_id: int
    symbol: str          # identity check: must match the lot the id resolves to
    shares: int
    limit_price: float | None = None


class BulkBuyItem(BaseModel):
    symbol: str
    shares: int
    limit_price: float | None = None


class BulkSellBody(BaseModel):
    items: list[BulkSellItem]
    order_type: str = "LIMIT"   # LIMIT (at the reviewed price) | MARKET
    confirm: bool = False


class BulkBuyBody(BaseModel):
    items: list[BulkBuyItem]
    order_type: str = "LIMIT"   # LIMIT (at the reviewed price) | MARKET
    confirm: bool = False


@app.get("/api/bulk/sell-plan")
async def bulk_sell_plan() -> dict:
    """Read-only: symbols whose LAST lot is profitable now (harvest candidates)."""
    return await bulk_svc.sell_plan(await _selected())


@app.get("/api/bulk/buy-plan")
async def bulk_buy_plan() -> dict:
    """Read-only: symbols whose price dropped to/through the next-rung trigger."""
    return await bulk_svc.buy_plan(await _selected())


@app.post("/api/bulk/sell")
async def bulk_sell(body: BulkSellBody) -> dict:
    """Place a sell for each item — only if its lot is the LAST lot for its symbol."""
    items = [{"lot_id": i.lot_id, "symbol": i.symbol, "shares": i.shares, "limit_price": i.limit_price} for i in body.items]
    return await bulk_svc.bulk_sell(await _selected(), items, order_type=body.order_type, confirm=body.confirm)


@app.post("/api/bulk/buy")
async def bulk_buy(body: BulkBuyBody) -> dict:
    """Buy each given item at the reviewed shares/price."""
    items = [{"symbol": i.symbol, "shares": i.shares, "limit_price": i.limit_price} for i in body.items]
    return await bulk_svc.bulk_buy(await _selected(), items, order_type=body.order_type, confirm=body.confirm)


class BulkPrefsBody(BaseModel):
    sell_min_gain_pct: float | None = None
    buy_dip_pct: float | None = None


@app.get("/api/bulk/prefs")
async def bulk_prefs() -> dict:
    """Auto-select thresholds for the bulk sell/buy tools."""
    return await bulk_svc.get_prefs()


@app.post("/api/bulk/prefs")
async def bulk_set_prefs(body: BulkPrefsBody) -> dict:
    return await bulk_svc.set_prefs({"sell_min_gain_pct": body.sell_min_gain_pct, "buy_dip_pct": body.buy_dip_pct})


@app.get("/api/ledger/reg-trading")
async def ledger_reg_trading() -> dict:
    return {"blocked": True, "reason": "requires a daily_balance series + a withdrawals input"}


@app.get("/api/account/balance")
async def account_balance() -> dict:
    return await ledger_svc.latest_balance(await _selected())


@app.post("/api/account/snapshot")
async def account_snapshot() -> dict:
    """Record today's balance snapshot for the selected account."""
    acct = await accounts_svc.selected_account_positions()
    return await ledger_svc.write_snapshot(await _selected(), acct.get("liquidation_value"))


@app.post("/api/account/rebuild")
async def account_rebuild() -> dict:
    """Rebuild the trading account's lots + completed trades from real Schwab fills
    (LIFO). Targets get_trading_account() — selected AND trading-enabled — so it can
    never run against the managed LLC account. fetch+write are serialized in resync."""
    target = await accounts_svc.get_trading_account()
    if not target:
        return {"ok": False, "error": "select a trading-enabled account first (Settings)"}
    return await rebuild_svc.resync_account(target)


@app.get("/api/diag/account-data/{account_hash}")
async def diag_account_data(account_hash: str, days: int = 60) -> dict:
    """READ-ONLY probe: what trade data does Schwab actually expose for this
    account? (orders by status + transactions by type over `days`). Used to decide
    if a managed account's per-lot ladder can be rebuilt from fills."""
    from collections import Counter
    from datetime import datetime, timedelta, timezone

    client = get_client()
    if client is None:
        return {"error": "no Schwab client"}

    def go() -> dict:
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=min(days, 60))
        out: dict = {}
        try:
            r = client.get_orders_for_account(account_hash, from_entered_datetime=start,
                                              to_entered_datetime=end)
            data = r.json() if r.status_code == 200 else None
            if isinstance(data, list):
                out["orders"] = {
                    "http": r.status_code, "count": len(data),
                    "by_status": dict(Counter(o.get("status") for o in data)),
                    "sample": [{
                        "symbol": ((o.get("orderLegCollection") or [{}])[0].get("instrument", {}) or {}).get("symbol"),
                        "instruction": ((o.get("orderLegCollection") or [{}])[0]).get("instruction"),
                        "status": o.get("status"), "qty": o.get("quantity"),
                        "filled": o.get("filledQuantity"),
                        "has_exec_legs": bool(o.get("orderActivityCollection")),
                        "entered": (o.get("enteredTime") or "")[:10],
                    } for o in data[:6]],
                }
            else:
                out["orders"] = {"http": r.status_code, "payload": str(data)[:200]}
        except Exception as e:
            out["orders"] = {"error": repr(e)}
        try:
            rt = client.get_transactions(account_hash, start_date=start, end_date=end)
            tx = rt.json() if rt.status_code == 200 else None
            if isinstance(tx, list):
                out["transactions"] = {
                    "http": rt.status_code, "count": len(tx),
                    "by_type": dict(Counter(t.get("type") for t in tx)),
                    "trade_sample": [{
                        "type": t.get("type"), "tradeDate": (t.get("tradeDate") or t.get("time") or "")[:10],
                        "n_items": len(t.get("transferItems", []) or []),
                        "symbols": [((it.get("instrument") or {}).get("symbol")) for it in (t.get("transferItems") or []) if (it.get("instrument") or {}).get("symbol")],
                    } for t in tx if t.get("type") == "TRADE"][:6],
                }
            else:
                out["transactions"] = {"http": rt.status_code, "payload": str(tx)[:200]}
        except Exception as e:
            out["transactions"] = {"error": repr(e)}
        return out

    return await asyncio.to_thread(go)


@app.post("/api/account/sync")
async def account_sync(account_hash: str | None = None) -> dict:
    """Refresh an account's holdings from Schwab (the single source of truth):
    reconstruct the per-rung ladder from real fills, then RECONCILE against Schwab's
    current positions so the totals always match (backfilling any holdings whose buys
    predate the fill window, and mirroring a managed account that exposes no fills)."""
    h = account_hash or await _selected()
    if not h:
        return {"ok": False, "error": "no account selected"}
    return await rebuild_svc.resync_account(h)


@app.get("/api/dashboard")
async def dashboard() -> dict:
    """Stock Data view (selected account): one computed summary row per held ticker."""
    return await build_dashboard(await _selected())


@app.get("/api/positions/{symbol}")
async def position_detail(symbol: str):
    """Longs view: the ladder detail for one ticker on the selected account."""
    detail = await build_position_detail(symbol, await _selected())
    return detail or {"error": f"no position for {symbol.upper()}"}


@app.websocket("/ws/dashboard")
async def ws_dashboard(ws: WebSocket) -> None:
    """Push a dashboard snapshot ~1x/sec for the selected account — but only when it
    changed, so an idle/closed market doesn't force a full JSON serialize + React
    table re-render every second."""
    await ws.accept()
    last = None
    try:
        while True:
            snap = await build_dashboard(await _selected())
            if snap != last:
                await ws.send_json(snap)
                last = snap
            await asyncio.sleep(1.0)
    except WebSocketDisconnect:
        pass


@app.websocket("/ws/quotes")
async def ws_quotes(ws: WebSocket) -> None:
    await ws.accept()
    queue = hub.subscribe()
    # Send whatever we already have so the UI paints immediately.
    for q in hub.latest.values():
        await ws.send_json(q)
    try:
        while True:
            quote = await queue.get()
            await ws.send_json(quote)
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(queue)


# --- packaged desktop: serve the built SPA same-origin (mounted LAST so it never
# shadows the /api or /ws routes above). In dev SCHWAB_FRONTEND_DIR is unset → no
# mount → Vite serves the frontend and CORS handles cross-origin. In the Electron
# bundle, the sidecar sets SCHWAB_FRONTEND_DIR to the packaged frontend dist and the
# window loads http://127.0.0.1:<port>/ — same origin as the API, so no CORS. ---
import os as _os  # noqa: E402
import sys as _spa_sys  # noqa: E402

_frontend_dir = _os.environ.get("SCHWAB_FRONTEND_DIR")
if _frontend_dir and _os.path.isdir(_frontend_dir):
    from fastapi.staticfiles import StaticFiles  # noqa: E402

    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="spa")
elif _frontend_dir:
    # SCHWAB_FRONTEND_DIR was set (packaged app) but doesn't exist → a broken bundle.
    # Fail LOUD instead of serving raw JSON 404s at "/" (which is what a stale/missing
    # frontend looked like). Electron's exit-code handler surfaces this.
    print(f"[spa] FATAL: SCHWAB_FRONTEND_DIR={_frontend_dir!r} is not a directory — bundle is broken.")
    _spa_sys.exit(2)
