"""Data & ops endpoints: health checks, version, one-file CSV intake, the
data-integrity report, backups, and recent diagnostics logs."""
from __future__ import annotations

import logging

from fastapi import APIRouter
from sqlalchemy import text

from .. import accounts as accounts_svc
from .. import backup as backup_svc
from .. import ledger as ledger_svc
from ..config import settings
from ..db import SessionLocal
from ..logsetup import recent_warnings
from ._shared import CsvImportBody, _selected
from ..schwab import hub
from ..version import APP_VERSION

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
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


@router.get("/api/version")
async def app_version() -> dict:
    """Which build am I running? Single source: app/version.py (synced to the
    installer version by build-installer.ps1)."""
    return {"version": APP_VERSION, "data_dir": str(settings.data_dir)}


@router.get("/api/logs/recent")
async def logs_recent(limit: int = 50) -> dict:
    """Newest-first WARNING+ log lines from this run (Settings → Diagnostics)."""
    return {"entries": recent_warnings(max(1, min(limit, 200))),
            "log_file": str(settings.data_dir / "app.log")}


@router.get("/api/backups")
async def get_backups() -> dict:
    """List database backups (newest first) + where they live."""
    return backup_svc.list_backups()


@router.post("/api/backup")
async def create_backup() -> dict:
    """Back up the trading database now (online, safe while running)."""
    return await backup_svc.run_backup()


@router.post("/api/data/import-csv")
async def data_import_csv(body: CsvImportBody) -> dict:
    """ONE-FILE intake for a Schwab Transactions export: routes Buy/Sell rows into the
    persistent fill ledger, transfers into the deposit log, dividends/interest into the
    income log — each deduped and idempotent — then re-projects the ladder + realized
    trades from the full history. The onboarding path for an account with years of data."""
    from .. import fill_store, rebuild as rebuild_svc

    acct = await _selected()
    trades = await fill_store.import_csv_fills(acct, body.csv)
    if not trades.get("ok"):
        return {"ok": False, "error": trades.get("error", "Couldn't parse the CSV.")}
    cash = await ledger_svc.import_cashflows_csv(acct, body.csv)
    divs = await ledger_svc.import_dividends_csv(acct, body.csv)
    other = await ledger_svc.import_other_cash_csv(acct, body.csv)
    changed = trades.get("added") or trades.get("removed_stale") or trades.get("reordered")
    projection = await rebuild_svc.project_account(acct) if changed else {"ok": True, "skipped": "no ledger changes"}
    return {
        "ok": True,
        "trades": {k: trades.get(k) for k in ("added", "skipped_known", "removed_stale",
                                              "bad_rows", "coverage",
                                              "splits", "unmatched_splits",
                                              "shorts_excluded", "covers_netted")},
        "other_actions": trades.get("other_actions") or {},
        "cashflows": {"added": cash.get("added", 0)},
        "dividends": {"added": divs.get("added", 0)},
        "other_cash": {"added": other.get("added", 0)},
        "projection": projection,
    }


@router.get("/api/data/health")
async def data_health() -> dict:
    """Data-integrity report for the selected account: fill-ledger coverage, projection
    depth, synthetic (position-backfilled) lots, and per-symbol reconstructed-vs-live
    share differences when Schwab is reachable."""
    from sqlalchemy import func as _func, select as _select

    from .. import fill_store, rebuild as rebuild_svc
    from ..db import SessionLocal as _SL
    from ..db.models import CompletedTrade as _CT, Lot as _Lot
    from ..reconstruct import reconstruct as _recon

    acct = await _selected()
    ledger = await fill_store.ledger_stats(acct)
    async with _SL() as s:
        lots = (await s.execute(
            _select(_Lot.symbol, _Lot.source, _Lot.shares, _Lot.buy_price)
            .where(_Lot.account_hash == acct)
        )).all()
        trade_count = (await s.execute(
            _select(_func.count()).select_from(_CT).where(_CT.account_hash == acct)
        )).scalar()
        earliest_trade = (await s.execute(
            _select(_func.min(_CT.completed_at)).where(_CT.account_hash == acct)
        )).scalar()
    synthetic = [{"symbol": sym, "shares": float(sh)} for sym, src, sh, _bp in lots if src == "position"]

    # Reconstructed open totals from the ledger vs Schwab's live positions (when reachable).
    stored = await fill_store.load_fills(acct)
    recon_totals: dict[str, float] = {}
    if stored:
        for sym, ls in _recon(stored)["open_lots"].items():
            recon_totals[sym] = round(sum(l.shares for l in ls), 4)
    positions = await rebuild_svc._fetch_positions_map(acct)
    diffs = []
    short_positions = []
    if positions is not None:
        for sym in sorted(set(recon_totals) | set(positions)):
            have = recon_totals.get(sym, 0.0)
            actual = round(positions.get(sym, (0.0, 0.0))[0], 4)
            if actual < 0:
                # An open SHORT at Schwab — deliberately outside the long-only ledger.
                # Label it; only a remaining LONG reconstruction is a real discrepancy.
                short_positions.append({"symbol": sym, "shares": -actual})
                actual = 0.0
            if abs(have - actual) > 1e-6:
                diffs.append({"symbol": sym, "reconstructed": have, "actual": actual,
                              "diff": round(actual - have, 4)})

    # --- VALIDATION vs Schwab #1: per-symbol COST BASIS. Schwab's avg price x held
    # shares vs our open-lot cost. A sizeable gap = mispriced/missing lots even when
    # the share COUNTS agree (counts alone can't catch a wrong-priced backfill).
    basis_diffs = []
    count_diff_syms = {d["symbol"] for d in diffs}
    if positions is not None:
        our_cost: dict[str, float] = {}
        for sym, _src, sh, bp in lots:
            our_cost[sym] = our_cost.get(sym, 0.0) + float(sh) * float(bp)
        for sym, (qty, avg) in positions.items():
            if qty <= 1e-9:
                continue
            schwab_basis = qty * (avg or 0.0)
            ours = our_cost.get(sym, 0.0)
            gap = ours - schwab_basis
            if schwab_basis > 0 and abs(gap) > max(50.0, 0.02 * schwab_basis):
                # When the share COUNT matches, a basis gap is normally a lot-ATTRIBUTION
                # difference, not missing data: the app assigns sells LIFO (the ladder
                # strategy), while Schwab's remaining-cost figure follows the account's
                # tax-lot election (FIFO/optimizer). Same trades, different surviving lots.
                basis_diffs.append({"symbol": sym, "our_cost": round(ours, 2),
                                    "schwab_basis": round(schwab_basis, 2), "diff": round(gap, 2),
                                    "count_matches": sym not in count_diff_syms})

    # --- VALIDATION vs Schwab #2: the GLOBAL CASH IDENTITY (advisory). In any account,
    # net cash position ~= net deposits + trading (LONGS and SHORTS) + income + other
    # cash rows (margin interest, adjustments, awards...). "Actual" is cash MINUS any
    # margin loan — borrowed money spent on stock otherwise reads as a phantom surplus.
    # A big residual now genuinely points at missing history; remaining blind spots are
    # small: per-trade fees and anything newer than the last import.
    cash_check = None
    shorts_summary = None
    try:
        from ..db.models import CashFlow as _CF
        from ..db.models import FillRecord as _FR
        async with _SL() as s:
            net_deposits = float((await s.execute(
                _select(_func.coalesce(_func.sum(_CF.amount), 0)).where(_CF.account_hash == acct)
            )).scalar() or 0)
            frows = (await s.execute(
                _select(_FR.side, _FR.shares, _FR.price)
                .where(_FR.account_hash == acct,
                       _FR.side.in_(["BUY", "SELL", "SSEL", "BCOV"]))
            )).all()
        trading_net = sum((float(sh) * float(px)) * (1 if side in ("SELL", "SSEL") else -1)
                          for side, sh, px in frows)
        short_net = sum((float(sh) * float(px)) * (1 if side == "SSEL" else -1)
                        for side, sh, px in frows if side in ("SSEL", "BCOV"))
        # Short activity is deliberately kept OUT of the long-only Trades/Activity totals
        # (the ladder is long-only), but we surface it so the numbers aren't invisible.
        n_ssel = sum(1 for side, _sh, _px in frows if side == "SSEL")
        n_bcov = sum(1 for side, _sh, _px in frows if side == "BCOV")
        if n_ssel or n_bcov:
            shorts_summary = {"sell_short_fills": n_ssel, "cover_fills": n_bcov,
                              "net_cash": round(short_net, 2)}
        div_data = await ledger_svc.get_dividends(acct)
        income = sum(float(d.get("amount") or 0) for d in div_data.get("rows", []))
        other_cash = (await ledger_svc.get_other_cash(acct))["total"]
        expected = net_deposits + trading_net + income + other_cash
        ms = await accounts_svc.margin_summary(acct)
        actual_cash = None
        if not ms.get("blocked") and ms.get("cash") is not None:
            actual_cash = float(ms["cash"]) - float(ms.get("debt") or 0.0)
        if actual_cash is not None and ledger["total"] > 0:
            residual = round(actual_cash - expected, 2)
            gross = sum(abs(float(sh) * float(px)) for _sd, sh, px in frows) or 1.0
            cash_check = {
                "expected_cash": round(expected, 2), "actual_cash": round(actual_cash, 2),
                "residual": residual, "residual_pct_of_flow": round(abs(residual) / gross * 100, 2),
                "components": {"net_deposits": round(net_deposits, 2),
                               "trading_net": round(trading_net, 2),
                               "short_net": round(short_net, 2),
                               "income": round(income, 2),
                               "other_cash": round(other_cash, 2),
                               "margin_debt": round(float(ms.get("debt") or 0.0), 2)},
                "caveats": "fees, interest, dividends, and transfers auto-sync from Schwab "
                           "(hourly); remaining blind spots: history older than any import "
                           "and same-day settlement timing",
            }
    except Exception as e:
        log.warning(f"[health] cash identity check failed: {e!r}")

    recs = []
    if ledger["total"] == 0:
        recs.append("No fill history stored yet — connect Schwab (recent trades sync "
                    "automatically) and import a Transactions CSV for the deep past.")
    elif diffs or synthetic:
        earliest = ledger["earliest"] or "?"
        recs.append(f"Some holdings predate the stored history (earliest fill {earliest}). "
                    f"Export a Transactions CSV covering earlier dates and import it under "
                    f"Settings to recover the full ladder and realized history.")
    real_basis_gaps = [b for b in basis_diffs if not b["count_matches"]]
    if real_basis_gaps:
        recs.append("Cost basis differs from Schwab on: "
                    + ", ".join(b["symbol"] for b in real_basis_gaps)
                    + " — usually a backfilled lot at an estimated price; importing a CSV "
                    "covering those buys fixes the basis exactly.")
    if cash_check and abs(cash_check["residual"]) > max(100.0, 0.01 * abs(cash_check["expected_cash"]) if cash_check["expected_cash"] else 100.0):
        recs.append(f"Cash identity residual of ${cash_check['residual']:,.2f} — if this looks "
                    f"large relative to your account, some deposits or trades may be missing "
                    f"(see the listed caveats first).")
    return {
        "ok": True,
        "fill_ledger": ledger,
        "projection": {
            "open_lots": len(lots),
            "synthetic_lots": synthetic,
            "completed_trades": int(trade_count or 0),
            "earliest_completed": earliest_trade.isoformat() if earliest_trade else None,
        },
        "position_diffs": diffs,
        "short_positions": short_positions,
        "shorts": shorts_summary,
        "basis_diffs": basis_diffs,
        "cash_check": cash_check,
        "positions_checked": positions is not None,
        "positions_total": len(positions) if positions is not None else None,
        "recommendations": recs,
    }
