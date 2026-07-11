"""Account endpoints: list/select, rollup helpers, margin, resync/rebuild, and
the read-only Schwab data-exposure probe."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

from .. import accounts as accounts_svc
from .. import rebuild as rebuild_svc
from ._shared import _selected
from ..schwab.auth import get_client

router = APIRouter()


@router.get("/api/accounts")
async def get_accounts() -> dict:
    """List Schwab accounts visible to the API + which one is selected."""
    return await accounts_svc.list_accounts()


class SelectAccountBody(BaseModel):
    hash: str


@router.post("/api/accounts/select")
async def post_select_account(body: SelectAccountBody) -> dict:
    return await accounts_svc.select_account(body.hash)


@router.get("/api/accounts/trading")
async def get_trading_account() -> dict:
    """The account orders go to (the selected account, if trading-enabled)."""
    return {"trading_hash": await accounts_svc.get_trading_account()}


@router.get("/api/account/positions")
async def get_account_positions() -> dict:
    """Live positions/balances for the selected account (basis for reconciliation)."""
    return await accounts_svc.selected_account_positions()


@router.get("/api/account/margin")
async def account_margin() -> dict:
    """Capital-deployment / leverage summary for the selected account."""
    return await accounts_svc.margin_summary(await _selected())


@router.post("/api/account/rebuild")
async def account_rebuild() -> dict:
    """Rebuild the trading account's lots + completed trades from real Schwab fills
    (LIFO). Targets get_trading_account() — selected AND trading-enabled — so it can
    never run against the managed LLC account. fetch+write are serialized in resync."""
    target = await accounts_svc.get_trading_account()
    if not target:
        return {"ok": False, "error": "select a trading-enabled account first (Settings)"}
    return await rebuild_svc.resync_account(target)


@router.get("/api/diag/account-data/{account_hash}")
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


@router.post("/api/account/sync")
async def account_sync(account_hash: str | None = None) -> dict:
    """Refresh an account's holdings from Schwab (the single source of truth):
    reconstruct the per-rung ladder from real fills, then RECONCILE against Schwab's
    current positions so the totals always match (backfilling any holdings whose buys
    predate the fill window, and mirroring a managed account that exposes no fills)."""
    h = account_hash or await _selected()
    if not h:
        return {"ok": False, "error": "no account selected"}
    return await rebuild_svc.resync_account(h)
