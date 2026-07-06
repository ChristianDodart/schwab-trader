"""Dividend / income parsing — pure, dependency-free, unit-tested.

Dividends are pulled from Schwab's transactions endpoint (same records `fetch_transfers`
uses, so the shape is known-good). They are deliberately kept OUT of the cash_flow table:
a dividend is a credit, and cash_flow's positive amounts are the ROI/deposit base — mixing
them would inflate "deposited" and distort every return figure. Instead they live as a
small JSON list in app_setting (no schema migration), summarized in an income view.

Note on returns: a paid dividend lands as cash in the account, so it's ALREADY reflected in
account value (and thus in gain/XIRR). The income view reports dividends received; it does
NOT add them on top of the account-value gain (that would double-count).
"""
from __future__ import annotations


def _f(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


# Schwab transaction `type` values that represent dividend/interest income. We also match
# any type containing "DIVIDEND" so a variant we didn't enumerate still counts.
_DIVIDEND_TYPES = {
    "DIVIDEND_OR_INTEREST", "CASH_DIVIDEND", "QUALIFIED_DIVIDEND",
    "NON_QUALIFIED_DIVIDEND", "DIVIDEND", "DIVIDEND_REINVEST",
    "REINVEST_DIVIDEND", "SPECIAL_DIVIDEND",
}


def _symbol(t: dict) -> str | None:
    """Best-effort ticker from a transaction's transferItems instrument."""
    for it in (t.get("transferItems") or []):
        sym = (it.get("instrument") or {}).get("symbol")
        if sym:
            return sym
    return None


def parse_dividends(data: list | None) -> list[dict]:
    """Filter raw Schwab transactions to dividend CREDITS → normalized rows. Pure."""
    out: list[dict] = []
    for t in data or []:
        ty = (t.get("type") or "").upper()
        if not (ty in _DIVIDEND_TYPES or "DIVIDEND" in ty):
            continue
        amt = _f(t.get("netAmount"))
        if amt <= 0:  # income is a credit; skip zero/negative (fees, reversals)
            continue
        day = (t.get("tradeDate") or t.get("time") or "")[:10]
        txid = str(t.get("activityId") or t.get("transactionId") or t.get("id") or "")
        out.append({
            "schwab_txn_id": txid or None,
            "day": day,
            "amount": round(amt, 2),
            "symbol": _symbol(t),
            "type": ty,
        })
    return out


def merge_dividends(existing: list[dict], fresh: list[dict]) -> tuple[list[dict], int]:
    """Idempotently merge freshly-pulled rows into the stored list. Dedup by Schwab txn id,
    or by (day, amount, symbol) when an id is absent. Returns (merged_desc_by_day, added)."""
    merged = list(existing or [])
    seen_ids = {d.get("schwab_txn_id") for d in merged if d.get("schwab_txn_id")}
    seen_keys = {(d.get("day"), d.get("amount"), d.get("symbol")) for d in merged}
    added = 0
    for d in fresh or []:
        tid = d.get("schwab_txn_id")
        key = (d.get("day"), d.get("amount"), d.get("symbol"))
        if tid and tid in seen_ids:
            continue
        if not tid and key in seen_keys:
            continue
        merged.append(d)
        added += 1
        if tid:
            seen_ids.add(tid)
        seen_keys.add(key)
    merged.sort(key=lambda x: (x.get("day") or ""), reverse=True)
    return merged, added


def is_dividend_action(action: str | None) -> bool:
    """Whether a Schwab CSV 'Action' cell denotes dividend/interest income (used by the CSV
    import). Broad on purpose — 'Cash Dividend', 'Qualified Dividend', 'Reinvest Dividend',
    'Bank Interest', etc. all count. The share-buy leg ('Reinvest Shares') doesn't match."""
    a = (action or "").lower()
    return "dividend" in a or "interest" in a


def summarize(rows: list[dict], year: int | None = None) -> dict:
    """Totals for the income view: all-time and (optionally) a given calendar year."""
    total = round(sum(_f(r.get("amount")) for r in rows or []), 2)
    ytd = None
    if year is not None:
        ytd = round(sum(_f(r.get("amount")) for r in rows or []
                        if (r.get("day") or "").startswith(str(year))), 2)
    return {"total": total, "year": year, "ytd": ytd, "count": len(rows or [])}
