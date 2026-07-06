"""Read an account's CURRENT holdings from Schwab (the `get_account` positions
endpoint) as {symbol: (shares, avg_price)}. This is the authoritative current
quantity Schwab reports; `rebuild.resync_account` reconciles the fill-reconstructed
ladder against it (backfilling holdings whose buys predate the fill window, and
fully populating a managed account that exposes no fills).

Only SHARE-based instruments are returned (equities/ETFs/funds); options/futures/
forex are skipped (see fills._SKIP_ASSET_TYPES).
"""
from __future__ import annotations

from .fills import _SKIP_ASSET_TYPES


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _fetch_positions_sync(client, account_hash):
    """Sync (call inside asyncio.to_thread). Returns list[(symbol, shares, avg_price)]
    for share-based long positions, or None if the account isn't readable."""
    r = client.get_account(account_hash, fields=client.Account.Fields.POSITIONS)
    if r.status_code != 200:
        return None  # restricted / transient → caller treats as "don't reconcile"
    body = r.json()
    sa = body.get("securitiesAccount") if isinstance(body, dict) else None
    if not isinstance(sa, dict):
        # 200 but no account object (degraded / shape-changed / list payload) → NOT a
        # trustworthy 'you hold nothing'; signal unavailable so we don't reconcile.
        print(f"[positions] {account_hash[-4:]}: 200 but no securitiesAccount — treating as unavailable")
        return None
    out = []
    for p in sa.get("positions", []) or []:
        instr = p.get("instrument", {}) or {}
        if instr.get("assetType") in _SKIP_ASSET_TYPES:  # skip options/futures/forex
            continue
        sym = instr.get("symbol")
        qty = _f(p.get("longQuantity"))
        avg = _f(p.get("averagePrice"))
        if sym and qty > 0:
            out.append((sym, qty, avg))
    return out
