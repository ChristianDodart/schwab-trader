"""The persistent fill ledger (fill_record) — ingest, dedupe, load.

Open lots + completed trades are PROJECTIONS of this ledger (see rebuild.py);
this module owns the durable source of truth. Three jobs:

  1. upsert_api_fills()  — persist every fill the Schwab API returns, idempotently
     (unique fill_key). An API fill REPLACES a matching CSV fill (same day-key) —
     upgrading it to full fidelity (real timestamp + order id).
  2. import_csv_fills()  — persist Buy/Sell rows from a Schwab Transactions CSV
     export, skipping rows the ledger already knows (from either source).
  3. load_fills()        — the full merged history as reconstruct.Fill objects,
     datetimes normalized to naive UTC so the chronological sort can never crash.

Cross-source identity: day-level MULTISET matching on (trade_date, symbol, side,
shares, price) — two identical trades on the same day are two distinct fills, so
we count occurrences per key rather than treating the key as unique.
"""
from __future__ import annotations

import csv as _csvmod
import io
from collections import Counter
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select

from .db import SessionLocal
from .db.models import FillRecord
from .reconstruct import Fill

_EPS = 1e-9
# Schwab's ledger day (and the Transactions CSV) is the EASTERN trade date. An
# after-hours fill at 7pm ET is the NEXT calendar day in UTC — deriving trade_date
# from the UTC timestamp made such fills miss their CSV twins in the (day, symbol,
# side) dedup group and double-count (found live on a real account, v0.22.1).
_MARKET_DAY_TZ = ZoneInfo("America/New_York")


def _naive_utc(dt: datetime) -> datetime:
    """tz-aware → UTC-naive; naive stays as-is. The DB stores naive; reconstruct
    sorts — mixing naive and aware datetimes raises, so normalize at the boundary."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def api_trade_date(at: datetime) -> date:
    """The EASTERN calendar date of an API fill timestamp (naive = assumed UTC)."""
    aware = at if at.tzinfo is not None else at.replace(tzinfo=timezone.utc)
    return aware.astimezone(_MARKET_DAY_TZ).date()


def day_key(trade_date: date, symbol: str, side: str, shares: float, price: float) -> tuple:
    """The cross-source identity of a fill at CSV (day-level) fidelity."""
    return (trade_date.isoformat(), symbol.upper(), side.upper(),
            round(float(shares), 4), round(float(price), 4))


def dedupe_incoming(incoming: list[dict], existing_keys: list[tuple]) -> tuple[list[dict], int]:
    """Pure: filter `incoming` fill dicts (each with a precomputed 'dkey') against a
    MULTISET of existing day-keys. If the ledger already holds N fills for a key,
    the first N incoming occurrences of that key are skipped (they describe trades
    we already know); occurrences beyond N are genuinely new (two identical trades
    the same day). Returns (fresh, skipped_count)."""
    remaining = Counter(existing_keys)
    fresh: list[dict] = []
    skipped = 0
    for f in incoming:
        k = f["dkey"]
        if remaining.get(k, 0) > 0:
            remaining[k] -= 1
            skipped += 1
        else:
            fresh.append(f)
    return fresh, skipped


def group_key(trade_date, symbol: str, side: str) -> tuple:
    """(day, symbol, side) — the granularity at which the API's coverage is COMPLETE.
    The API reports per-execution legs while the CSV aggregates per order (a partial
    fill is 5+6 legs vs one 11-share CSV row), so exact matching can't pair them.
    Instead: if the API has ANY fill in a group, it saw every order in that group —
    the API owns the whole group and CSV rows in it are redundant."""
    d = trade_date.isoformat() if hasattr(trade_date, "isoformat") else str(trade_date)
    return (d, symbol.upper(), side.upper())


def resolve_group_conflicts(incoming: list[dict], api_totals: dict[tuple, float]) -> tuple[list[dict], int]:
    """Pure: decide incoming CSV fills against the API per (day, symbol, side) group by
    TOTAL SHARES — the source accounting for more volume wins the group (tie → API,
    for its leg-level fidelity).

    Why totals, not mere presence: the API queries orders by ENTERED time, so its
    first-sync boundary day is only PARTIALLY covered (an order entered before the
    cutoff but filled inside it is invisible), and a long-resting GTC order can fill
    inside the window despite being entered before it. 'API touched the group ⇒ API
    owns it' evicted REAL CSV fills in exactly those cases (found live). The CSV is
    complete per day by construction, so: csv_total > api_total ⇒ keep the CSV rows
    (heal_ledger then evicts the API's partial rows); csv_total <= api_total ⇒ the
    API already accounts for everything ⇒ drop the CSV rows."""
    csv_totals: Counter = Counter()
    for f in incoming:
        csv_totals[group_key(f["trade_date"], f["symbol"], f["side"])] += float(f["shares"])
    keep_group = {g: (t > api_totals.get(g, 0.0) + _EPS) if g in api_totals else True
                  for g, t in csv_totals.items()}
    kept: list[dict] = []
    dropped = 0
    for f in incoming:
        if keep_group[group_key(f["trade_date"], f["symbol"], f["side"])]:
            kept.append(f)
        else:
            dropped += 1
    return kept, dropped


async def _existing_keys(account_hash: str, source: str | None = None) -> list[tuple]:
    conds = [FillRecord.account_hash == account_hash]
    if source:
        conds.append(FillRecord.source == source)
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(FillRecord.trade_date, FillRecord.symbol, FillRecord.side,
                   FillRecord.shares, FillRecord.price).where(*conds)
        )).all()
    return [day_key(d, sym, side, float(sh), float(px)) for d, sym, side, sh, px in rows]


async def upsert_api_fills(account_hash: str, fills: list[Fill]) -> dict:
    """Persist API fills idempotently. Exact identity = the API fill_key (unique
    column ⇒ re-syncing the same window is a no-op). A matching CSV fill (same
    day-key) is DELETED first — the API row supersedes it with full fidelity."""
    if not fills:
        return {"added": 0, "skipped": 0, "upgraded_csv": 0}

    incoming = []
    for f in fills:
        if isinstance(f.at, datetime):
            td = api_trade_date(f.at)      # EASTERN trade day (matches the CSV's dating)
            at = _naive_utc(f.at)
        else:
            at = datetime(f.at.year, f.at.month, f.at.day)
            td = f.at
        key = f"api|{account_hash}|{f.order_id}|{at.isoformat()}|{round(float(f.price), 4)}|{round(float(f.shares), 4)}|{f.side.upper()}"
        incoming.append({
            "symbol": f.symbol.upper(), "side": f.side.upper(),
            "shares": round(float(f.shares), 4), "price": round(float(f.price), 4),
            "at": at, "trade_date": td, "order_type": f.order_type or None,
            "order_id": f.order_id or None, "fill_key": key[:180],
            "dkey": day_key(td, f.symbol, f.side, f.shares, f.price),
        })

    added = skipped = 0
    async with SessionLocal() as s:
        known = set((await s.execute(
            select(FillRecord.fill_key).where(FillRecord.account_hash == account_hash,
                                              FillRecord.source == "api")
        )).scalars().all())
        for f in incoming:
            if f["fill_key"] in known:
                skipped += 1
                continue
            f.pop("dkey", None)
            s.add(FillRecord(account_hash=account_hash, source="api", **f))
            known.add(f["fill_key"])
            added += 1
        await s.commit()
    # Cross-source conflicts (a CSV row describing a trade the API now also has) are
    # resolved centrally by heal_ledger's totals rule — resync runs it right after this.
    return {"added": added, "skipped": skipped, "upgraded_csv": 0}


# --- Schwab Transactions CSV → fills ----------------------------------------

_TRADE_ACTIONS = {"buy", "sell"}  # exact-match after lowering; variants reported, not guessed


def _parse_money(s) -> float | None:
    if s is None:
        return None
    t = str(s).strip().replace("$", "").replace(",", "")
    neg = t.startswith("(") and t.endswith(")")
    t = t.strip("()")
    if not t:
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    return -v if neg else v


def _parse_date(s) -> date | None:
    """Schwab CSV dates: '07/06/2026' or '07/01/2026 as of 06/30/2026'. For a TRADE
    the first (posted) date IS the trade date; 'as of' appears on transfers."""
    if not s:
        return None
    first = str(s).strip().split(" ")[0]
    try:
        m, d, y = first.split("/")
        return date(int(y), int(m), int(d))
    except (ValueError, AttributeError):
        return None


def _pair_splits(split_rows: list[dict]) -> tuple[list[dict], int]:
    """Pure: pair Schwab 'Reverse Split' row PAIRS into SPLT adjustments. A split
    exports as two rows on the effective date: the NEW share count under the ticker
    (positive qty) and the OLD count removed under a CUSIP (negative qty, description
    like 'COMPANYXXXREVERSE SPLIT EFF: ...'). Pair positives to negatives per date by
    description prefix; a lone positive/negative is reported unmatched, never guessed."""
    out: list[dict] = []
    unmatched = 0
    by_date: dict = {}
    for r in split_rows:
        by_date.setdefault(r["date"], []).append(r)
    for d, rows in by_date.items():
        pos = [r for r in rows if r["qty"] > 0]
        neg = [r for r in rows if r["qty"] < 0]
        for p in pos:
            match = None
            if len(pos) == 1 and len(neg) == 1:
                match = neg[0]
            else:
                pref = (p["desc"] or "")[:12].upper()
                match = next((n for n in neg if pref and (n["desc"] or "").upper().startswith(pref)), None)
            if match is None:
                unmatched += 1
                continue
            neg.remove(match)
            new_total, old_total = round(p["qty"], 4), round(-match["qty"], 4)
            out.append({
                "symbol": p["symbol"], "side": "SPLT", "shares": new_total, "price": old_total,
                "at": datetime(d.year, d.month, d.day), "trade_date": d,
                "order_type": None, "order_id": None,
                "fill_key": f"csvsplit|{d.isoformat()}|{p['symbol']}|{new_total}|{old_total}",
                "dkey": day_key(d, p["symbol"], "SPLT", new_total, old_total),
            })
        unmatched += len(neg)
    return out, unmatched


def parse_csv_trades(csv_text: str) -> dict:
    """Pure: parse a Schwab Transactions export into fill dicts + a report of what was
    routed elsewhere / skipped. Handles the real-world hazards:

    - SHORT SALES: 'Sell Short' rows are excluded (long-only ladder), and because
      Schwab labels the covering purchase a plain 'Buy', buys are NETTED against the
      open short balance chronologically per symbol — only the portion beyond covering
      becomes a long BUY fill. Same-day canonical order: shorts, buys, sells (you can't
      be long and short the same equity simultaneously, so regimes alternate).
    - REVERSE SPLITS: paired rows become a SPLT adjustment (new/old totals) that the
      reconstruction applies by rescaling the open stack, preserving cost basis with
      zero fake P/L.
    - Everything else is counted and surfaced (other_actions), never silently dropped."""
    text = (csv_text or "").lstrip("﻿")
    if not text.strip():
        return {"ok": False, "error": "The file is empty.", "fills": []}
    try:
        rows = list(_csvmod.DictReader(io.StringIO(text)))
    except Exception as e:
        return {"ok": False, "error": f"Couldn't parse the CSV ({e}).", "fills": []}

    def col(r: dict, name: str):
        for k, v in r.items():
            if k and k.strip().lower() == name:
                return v
        return None

    if not rows or col(rows[0], "date") is None or col(rows[0], "action") is None:
        return {"ok": False, "error": "This doesn't look like a Schwab transactions export "
                "(no Date/Action columns).", "fills": []}

    trades: list[dict] = []      # {date, sym, kind: short|buy|sell, qty, px}
    split_rows: list[dict] = []
    other_actions: Counter = Counter()
    bad_rows = 0
    for r in rows:
        action = (col(r, "action") or "").strip()
        a = action.lower()
        d = _parse_date(col(r, "date"))
        sym = (col(r, "symbol") or "").strip().upper()
        qty = _parse_money(col(r, "quantity"))
        if a == "reverse split":
            if d is None or not sym or not qty:
                bad_rows += 1
                continue
            split_rows.append({"date": d, "symbol": sym, "qty": qty, "desc": col(r, "description")})
            continue
        if a not in _TRADE_ACTIONS and a != "sell short":
            if action:
                other_actions[action] += 1
            continue
        px = _parse_money(col(r, "price"))
        if d is None or not sym or not qty or qty <= 0 or not px or px <= 0:
            bad_rows += 1
            continue
        kind = "short" if a == "sell short" else a   # short | buy | sell
        trades.append({"date": d, "symbol": sym, "kind": kind, "qty": round(qty, 4), "px": round(px, 4)})

    # Chronological, canonical same-day order per symbol: shorts open, buys (cover
    # first), sells. Ambiguity within a day is irreducible from a date-only export;
    # a mis-order self-flags as `oversold` at reconstruction rather than corrupting.
    _KIND_ORD = {"short": 0, "buy": 1, "sell": 2}
    trades.sort(key=lambda t: (t["date"], _KIND_ORD[t["kind"]]))

    fills: list[dict] = []
    occ: Counter = Counter()
    short_open: dict[str, float] = {}
    shorts_excluded = 0
    covers_netted = 0.0

    def add_fill(d, sym, side, qty, px):
        dk = day_key(d, sym, side, qty, px)
        n = occ[dk]
        occ[dk] += 1
        fills.append({
            "symbol": sym, "side": side, "shares": round(qty, 4), "price": round(px, 4),
            "at": datetime(d.year, d.month, d.day), "trade_date": d,
            "order_type": None, "order_id": None,
            "fill_key": f"csv|{d.isoformat()}|{sym}|{side}|{round(qty, 4)}|{round(px, 4)}|#{n}",
            "dkey": dk,
        })

    for t in trades:
        sym = t["symbol"]
        if t["kind"] == "short":
            short_open[sym] = short_open.get(sym, 0.0) + t["qty"]
            shorts_excluded += 1
            continue
        if t["kind"] == "buy":
            cover = min(t["qty"], short_open.get(sym, 0.0))
            if cover > _EPS:
                short_open[sym] = short_open.get(sym, 0.0) - cover
                covers_netted += cover
            remainder = t["qty"] - cover
            if remainder > _EPS:
                add_fill(t["date"], sym, "BUY", round(remainder, 4), t["px"])
            continue
        add_fill(t["date"], sym, "SELL", t["qty"], t["px"])

    splits, unmatched_splits = _pair_splits(split_rows)
    fills.extend(splits)

    span = (min((f["trade_date"] for f in fills), default=None),
            max((f["trade_date"] for f in fills), default=None))
    return {"ok": True, "fills": fills, "other_actions": dict(other_actions),
            "bad_rows": bad_rows, "coverage": {"from": span[0], "to": span[1]},
            "splits": len(splits), "unmatched_splits": unmatched_splits,
            "shorts_excluded": shorts_excluded, "covers_netted": round(covers_netted, 4),
            "short_still_open": {s: round(q, 4) for s, q in short_open.items() if q > _EPS}}


async def import_csv_fills(account_hash: str, csv_text: str) -> dict:
    """Route a Schwab Transactions CSV's Buy/Sell rows into the ledger, skipping
    any trade the ledger already knows. Two-stage dedup: (1) drop rows in any
    (day, symbol, side) group the API already covers — the API is complete per
    group and its per-leg fills can't exact-match a CSV per-order aggregate;
    (2) exact multiset dedup against previously imported CSV rows. Idempotent."""
    parsed = parse_csv_trades(csv_text)
    if not parsed["ok"]:
        return {"ok": False, "error": parsed["error"], "added": 0}
    incoming = parsed["fills"]

    async with SessionLocal() as s:
        api_rows = (await s.execute(
            select(FillRecord.trade_date, FillRecord.symbol, FillRecord.side, FillRecord.shares)
            .where(FillRecord.account_hash == account_hash, FillRecord.source == "api")
        )).all()
    api_totals: dict[tuple, float] = {}
    for d, sym, side, sh in api_rows:
        g = group_key(d, sym, side)
        api_totals[g] = api_totals.get(g, 0.0) + float(sh)
    incoming, dropped_api = resolve_group_conflicts(incoming, api_totals)

    existing = await _existing_keys(account_hash, source="csv")
    fresh, skipped = dedupe_incoming(incoming, existing)
    skipped += dropped_api

    added = 0
    async with SessionLocal() as s:
        known = set((await s.execute(
            select(FillRecord.fill_key).where(FillRecord.account_hash == account_hash)
        )).scalars().all())
        for f in fresh:
            key = f"{account_hash[:24]}|{f['fill_key']}"[:180]
            if key in known:
                continue
            s.add(FillRecord(
                account_hash=account_hash, symbol=f["symbol"], side=f["side"],
                shares=f["shares"], price=f["price"], at=f["at"], trade_date=f["trade_date"],
                order_type=None, order_id=None, source="csv", fill_key=key,
            ))
            known.add(key)
            added += 1
        await s.commit()
    cov = parsed["coverage"]
    return {"ok": True, "added": added, "skipped_known": skipped,
            "bad_rows": parsed["bad_rows"], "other_actions": parsed["other_actions"],
            "splits": parsed.get("splits", 0), "unmatched_splits": parsed.get("unmatched_splits", 0),
            "shorts_excluded": parsed.get("shorts_excluded", 0),
            "covers_netted": parsed.get("covers_netted", 0),
            "coverage": {"from": cov["from"].isoformat() if cov["from"] else None,
                         "to": cov["to"].isoformat() if cov["to"] else None}}


async def heal_ledger(account_hash: str) -> dict:
    """Idempotent self-repair, run on every resync before projection:
      1. Re-stamp any API fill whose trade_date isn't its EASTERN calendar date
         (rows written before v0.22.1 used the UTC date — after-hours fills off by one).
      2. Resolve every (day, symbol, side) group where BOTH sources have rows by the
         TOTALS rule: the source accounting for more shares keeps the group; the other
         source's rows are evicted (tie → API wins for leg-level fidelity). This both
         removes duplicates AND lets a complete CSV group displace a partial API one
         (first-sync boundary day / GTC orders entered before the window).
    Costs one account scan; a healthy ledger is a no-op."""
    redated = evicted_csv = evicted_api = 0
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(FillRecord).where(FillRecord.account_hash == account_hash,
                                     FillRecord.side.in_(["BUY", "SELL"]))
        )).scalars().all()
        for r in rows:
            if r.source == "api":
                correct = api_trade_date(r.at)
                if r.trade_date != correct:
                    r.trade_date = correct
                    redated += 1

        groups: dict[tuple, dict[str, list]] = {}
        for r in rows:
            g = group_key(r.trade_date, r.symbol, r.side)
            groups.setdefault(g, {"api": [], "csv": []}).setdefault(r.source, []).append(r)
        doomed_ids: list[int] = []
        for g, by in groups.items():
            api_rows, csv_rows = by.get("api", []), by.get("csv", [])
            if not api_rows or not csv_rows:
                continue
            api_tot = sum(float(r.shares) for r in api_rows)
            csv_tot = sum(float(r.shares) for r in csv_rows)
            if csv_tot > api_tot + _EPS:      # CSV accounts for more → API rows were partial
                doomed_ids += [r.id for r in api_rows]
                evicted_api += len(api_rows)
            else:                              # API covers it (or tie) → CSV rows redundant
                doomed_ids += [r.id for r in csv_rows]
                evicted_csv += len(csv_rows)
        if doomed_ids:
            await s.execute(delete(FillRecord).where(FillRecord.id.in_(doomed_ids)))
        await s.commit()
    if redated or evicted_csv or evicted_api:
        print(f"[heal] {account_hash[-4:]} fill ledger: {redated} api dates fixed, "
              f"{evicted_csv} duplicate csv + {evicted_api} partial api fills evicted")
    return {"redated": redated, "evicted": evicted_csv, "evicted_api": evicted_api}


async def load_fills(account_hash: str) -> list[Fill]:
    """The complete merged fill history for reconstruction, all sources."""
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(FillRecord).where(FillRecord.account_hash == account_hash)
        )).scalars().all()
    return [
        Fill(symbol=r.symbol, side=r.side, shares=float(r.shares), price=float(r.price),
             at=_naive_utc(r.at) if isinstance(r.at, datetime) else r.at,
             order_type=r.order_type or "", order_id=r.order_id or "")
        for r in rows
    ]


async def ledger_stats(account_hash: str) -> dict:
    """Coverage summary for the data-health report."""
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(FillRecord.source, FillRecord.trade_date)
            .where(FillRecord.account_hash == account_hash)
        )).all()
    by_source: dict[str, int] = {}
    earliest = latest = None
    for src, d in rows:
        by_source[src] = by_source.get(src, 0) + 1
        earliest = d if earliest is None or d < earliest else earliest
        latest = d if latest is None or d > latest else latest
    return {"total": len(rows), "by_source": by_source,
            "earliest": earliest.isoformat() if earliest else None,
            "latest": latest.isoformat() if latest else None}
