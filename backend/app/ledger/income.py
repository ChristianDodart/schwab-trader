"""Income & capital movements: dividend/interest log, deposit/withdrawal cash
flows, and the misc other-cash log — Schwab pulls and Transactions-CSV imports."""
from __future__ import annotations

import logging
import math
from collections import Counter
from datetime import date

from sqlalchemy import select

from ..db import SessionLocal, dialect_insert as pg_insert
from ..db.models import AppSetting, CashFlow
from ._shared import _f, _parse_csv_date, _parse_date, _parse_money, _today

log = logging.getLogger(__name__)

# ===================== dividends / income =====================
# Stored as a JSON list in app_setting (NOT cash_flow — dividends are income, not the
# deposit/ROI base). Keyed by account_hash so it survives profile switches.
import json as _json

from .. import dividends as dividends_mod

_DIV_KEY = "dividends:"  # + account_hash


async def get_dividends(account_hash: str) -> dict:
    """Stored dividend rows (newest first) + all-time/YTD totals for the income view."""
    async with SessionLocal() as s:
        row = await s.get(AppSetting, _DIV_KEY + account_hash)
    try:
        rows = _json.loads(row.value) if row and row.value else []
    except Exception as e:
        log.warning(f"stored dividends blob for {account_hash[-4:]} is unreadable — treating as empty: {e!r}")
        rows = []
    if not isinstance(rows, list):
        rows = []
    summary = dividends_mod.summarize(rows, year=_today().year)
    return {"rows": rows, "summary": summary}


_OTHER_CASH_KEY = "other_cash:"  # + account_hash → JSON rows of misc cash (fees/interest/adjustments)
_OTHER_CASH_MAX_ROWS = 10_000   # cap the JSON blob; oldest days trimmed past this

# Actions the OTHER importers already own — everything else with an Amount lands in
# the other-cash log so the cash cross-check can account for it.
_OTHER_CASH_SKIP = ("buy", "sell", "sell short", "reverse split", "journal")


async def get_other_cash(account_hash: str) -> dict:
    """Misc cash rows imported from the Transactions CSV that are neither trades,
    transfers, nor positive dividend/interest income — margin interest, dividend
    adjustments, cash in lieu, awards, fund distributions, foreign tax. Kept so the
    cash identity accounts for them; net can be negative (mostly margin interest)."""
    async with SessionLocal() as s:
        row = await s.get(AppSetting, _OTHER_CASH_KEY + account_hash)
    try:
        rows = _json.loads(row.value) if row and row.value else []
    except Exception as e:
        log.warning(f"stored other-cash blob for {account_hash[-4:]} is unreadable — treating as empty: {e!r}")
        rows = []
    rows = rows if isinstance(rows, list) else []
    return {"rows": rows, "total": round(sum(_f(r.get("amount")) for r in rows), 2)}


async def import_other_cash_csv(account_hash: str, csv_text: str) -> dict:
    """Import the misc cash rows from a Schwab Transactions CSV (see get_other_cash).
    Deduped by (day, amount, type) so re-imports are no-ops."""
    import csv as _csvmod
    import io

    text = (csv_text or "").lstrip("﻿")
    if not text.strip():
        return {"ok": False, "added": 0}
    try:
        rows = list(_csvmod.DictReader(io.StringIO(text)))
    except Exception as e:
        log.warning(f"other-cash CSV import for {account_hash[-4:]} failed to parse: {e!r}")
        return {"ok": False, "added": 0}

    def col(r: dict, name: str):
        for k, v in r.items():
            if k and k.strip().lower() == name:
                return v
        return None

    fresh = []
    fee_by_day: dict[str, float] = {}
    day_min = day_max = None
    for r in rows:
        action = (col(r, "action") or "").strip()
        a = action.lower()
        d = _parse_csv_date(col(r, "date"))
        if d is not None:
            day_min = d if day_min is None or d < day_min else day_min
            day_max = d if day_max is None or d > day_max else day_max
        # Per-trade fees ("Fees & Comm" — SEC fees, cents each) — captured exactly,
        # aggregated per day, so the cash identity closes to the penny.
        if a in ("buy", "sell", "sell short") and d is not None:
            fee = _parse_money(col(r, "fees & comm"))
            if fee and math.isfinite(fee) and fee != 0:
                fee_by_day[d.isoformat()] = fee_by_day.get(d.isoformat(), 0.0) + abs(fee)
        if not action or a in _OTHER_CASH_SKIP:
            continue
        if any(k in a for k in _CSV_TRANSFER_KEYS):     # transfers → the deposit log
            continue
        amt = _parse_money(col(r, "amount"))
        if amt is None or d is None or not math.isfinite(amt) or amt == 0:
            continue
        if dividends_mod.is_dividend_action(action) and amt > 0:
            continue                                     # positive income → the income log
        fresh.append({"day": d.isoformat(), "amount": round(amt, 2), "type": action.upper()[:32]})

    existing = (await get_other_cash(account_hash))["rows"]
    # TRADE FEES rows are per-day AGGREGATES, so a newer export with more trades on a
    # boundary day changes the day's sum — REPLACE the file's coverage rather than
    # dedup (the file is authoritative for its range, same rule as fills). `added`
    # reports only the NET difference so a same-file re-import reads as a no-op.
    removed_fees: Counter = Counter()
    if day_min and day_max:
        lo, hi = day_min.isoformat(), day_max.isoformat()
        kept_existing = []
        for r in existing:
            if r.get("type") == "TRADE FEES" and lo <= str(r.get("day")) <= hi:
                removed_fees[(r.get("day"), r.get("amount"))] += 1
            else:
                kept_existing.append(r)
        existing = kept_existing
    fee_rows = [{"day": day, "amount": round(-total, 2), "type": "TRADE FEES"}
                for day, total in sorted(fee_by_day.items())]
    new_fee_count = 0
    _rf = Counter(removed_fees)
    for r in fee_rows:
        if _rf.get((r["day"], r["amount"]), 0) > 0:
            _rf[(r["day"], r["amount"])] -= 1
        else:
            new_fee_count += 1

    seen = Counter((r.get("day"), r.get("amount"), r.get("type")) for r in existing)
    added = []
    for r in fresh:
        k = (r["day"], r["amount"], r["type"])
        if seen.get(k, 0) > 0:
            seen[k] -= 1
            continue
        added.append(r)
    if added or fee_rows or removed_fees:
        merged = existing + added + fee_rows
        # Cap the blob (a JSON app_setting row, loaded whole on every cash check).
        # 10k rows ≈ 25 years of daily fees+misc; beyond that trim the OLDEST days —
        # ancient rows matter least to a cash identity dominated by recent activity.
        if len(merged) > _OTHER_CASH_MAX_ROWS:
            merged.sort(key=lambda r: str(r.get("day") or ""))
            merged = merged[len(merged) - _OTHER_CASH_MAX_ROWS:]
        payload = _json.dumps(merged)
        async with SessionLocal() as s:
            await s.execute(
                pg_insert(AppSetting).values(key=_OTHER_CASH_KEY + account_hash, value=payload)
                .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": payload})
            )
            await s.commit()
    return {"ok": True, "added": len(added) + new_fee_count, "parsed": len(fresh),
            "fees_captured": round(sum(fee_by_day.values()), 2)}


async def import_dividends_csv(account_hash: str, csv_text: str) -> dict:
    """Import dividend/interest income from a Schwab 'Transactions' CSV export — the way to
    get history older than the 60-day live pull. Rows are matched by Action containing
    'dividend'/'interest'; merged (deduped by day+amount+symbol) into the stored log, so
    re-importing or overlapping the pull is safe."""
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

    def col(r: dict, name: str):
        for k, v in r.items():
            if k and k.strip().lower() == name:
                return v
        return None

    if col(rows[0], "amount") is None or col(rows[0], "date") is None:
        return {"ok": False, "error": "This doesn't look like a Schwab transactions export (no Date/Amount columns).", "added": 0}

    fresh: list[dict] = []
    for r in rows:
        if not dividends_mod.is_dividend_action(col(r, "action")):
            continue
        d = _parse_csv_date(col(r, "date"))
        amt = _parse_money(col(r, "amount"))
        if d is None or amt is None or amt <= 0 or not math.isfinite(amt):
            continue
        sym = ((col(r, "symbol") or "").strip().upper()) or None
        fresh.append({"schwab_txn_id": None, "day": d.isoformat(), "amount": round(amt, 2),
                      "symbol": sym, "type": (col(r, "action") or "").strip().upper()})

    if not fresh:
        return {"ok": True, "added": 0, "parsed": 0, "note": "No dividend/interest rows found in this file."}

    existing = (await get_dividends(account_hash))["rows"]
    merged, added = dividends_mod.merge_dividends(existing, fresh)
    async with SessionLocal() as s:
        await s.execute(
            pg_insert(AppSetting).values(key=_DIV_KEY + account_hash, value=_json.dumps(merged))
            .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": _json.dumps(merged)})
        )
        await s.commit()
    return {"ok": True, "added": added, "parsed": len(fresh), "total": dividends_mod.summarize(merged)["total"]}


async def refresh_dividends(account_hash: str) -> dict:
    """Pull the trailing-60-day dividend window from Schwab and merge it into the stored
    log (idempotent). Returns {ok, added, total} or {ok: False, error} — never wipes the
    log on a failed/blocked pull."""
    from .. import accounts as accounts_svc

    fresh = await accounts_svc.fetch_dividends(account_hash)
    if fresh is None:
        return {"ok": False, "error": "Couldn't reach Schwab for transactions (or not connected)."}
    existing = (await get_dividends(account_hash))["rows"]
    merged, added = dividends_mod.merge_dividends(existing, fresh)
    async with SessionLocal() as s:
        await s.execute(
            pg_insert(AppSetting).values(key=_DIV_KEY + account_hash, value=_json.dumps(merged))
            .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": _json.dumps(merged)})
        )
        await s.commit()
    return {"ok": True, "added": added, "total": dividends_mod.summarize(merged)["total"]}


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
    from .. import accounts as accounts_svc

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
# Rows that move CASH into/out of THIS account count as contributions — never trades,
# dividends, or interest. Transfers & wires are outside money. A JOURNAL is an internal
# move between your own Schwab accounts; a CASH journal (no ticker, just an Amount, e.g.
# "JOURNAL FRM ...896 $1500.00") still adds/removes cash from THIS account, so per-account
# it must be counted for the cash identity to close. A journal WITH a ticker is a share
# transfer (no cash) and is skipped here. The 60-day Schwab transfer auto-pull excludes
# journals, so counting them from the CSV can't double-count.
# Action substrings that mark an external cash movement (deposit/withdrawal). Schwab
# labels these several ways: MoneyLink "Transfer"/"...Adj", "Wire" Received/Sent, and
# "Funds" Received/Paid (cashier's checks, Schwab One checks). All are real capital in/out
# of THIS account and belong in the deposit log — missing any of them understates
# "capital contributed" and skews ROI (found: $159.4k of "Funds Received" was uncounted).
_CSV_TRANSFER_KEYS = ("transfer", "wire", "funds", "moneylink")
# Max gap (days) between a CSV 'as of' effective date and Schwab's posted date for the
# same transfer — settlement is T+1, longer over weekends/holidays. Used for dedup only.
_CSV_DEDUP_WINDOW_DAYS = 4


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
        has_symbol = bool((col(r, "symbol") or "").strip())
        is_transfer = any(k in al for k in _CSV_TRANSFER_KEYS)
        is_cash_journal = ("journal" in al) and not has_symbol   # cash move; share journals carry a ticker
        if not (is_transfer or is_cash_journal):
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
