# Data Integrity Plan

Goal: **complete, accurate, self-healing data — never manual-first.** A new user
with 3+ years and thousands of trades gets to a fully reconstructed account with
one login and one file upload. This doc is the inventory of every datum the app
uses: where it comes from, how it's stored, and how it heals.

## Source priority (applies to everything)

1. **Schwab API** — richest and freshest (timestamps, order ids, live truth).
   Always first. But its history is bounded (below).
2. **Schwab Transactions CSV export** — the *complete* history (back to account
   opening). Date-level granularity, no order ids. The bulk-intake vector.
3. **Manual entry** — last resort, for the rare row neither source has
   (e.g. a transfer older than the CSV export the user pulled).

The app must always be usable with sources 1 alone; source 2 upgrades depth;
source 3 patches holes. Re-running any source is **idempotent** — importing the
same CSV twice, or overlapping the API window, never double-counts.

## Known source limits (why each layer exists)

| Source | Covers | Limits |
|---|---|---|
| API: orders (fills) | ~1 yr reliably (we page 60-day windows, configurable to ~5 yr) | ephemeral responses; older orders silently absent |
| API: transactions (transfers) | ~60 days | hard Schwab cap |
| API: positions | live now | quantities + avg cost only — no history |
| API: balances | live now | snapshot only; we accrue our own daily series |
| CSV: Transactions export | **account inception → today** | date-only timestamps, no order ids, same-day order ambiguity |

## The core fix: a persistent fill ledger (`fill_record`)

Previously fills were **ephemeral** — refetched from the API on every resync and
never stored, so the reconstruction could never know more than the API window.

Now every fill ever seen, from any source, is stored append-only in
`fill_record` (account, symbol, side, shares, price, at, order_id, source,
unique fill_key). Open lots (`lot`) and closed trades (`completed_trade`) become
a **pure projection** of this ledger: reconstruct (LIFO) → reconcile against
live positions → write. The projection can be wiped and rebuilt at any time
without losing anything, because the source of truth is durable.

Identity & dedup:
- **API fill**: key = order_id + execution time + price + shares + side. Exact.
- **CSV fill**: key = trade_date + symbol + side + shares + price + occurrence#
  (occurrence# distinguishes two identical trades the same day).
- **Cross-source**: a CSV row and an API fill describing the same trade are
  matched by day-level multiset counting on (date, symbol, side, shares, price):
  if the ledger already holds N API fills for a day-key, the first N matching
  CSV occurrences are skipped (and vice versa, API upserts replace matching CSV
  rows — upgrading them to full fidelity). Pure function, unit-tested.

Same-day ordering: API fills carry real timestamps. CSV fills are stamped at
00:00 of their trade date; reconstruction breaks ties BUY-before-SELL, so a
same-day round trip pairs correctly. When several same-day buys and sells
interleave, per-lot pairing within that day is canonicalized (buys first);
total realized P/L is unaffected.

## Data inventory

| Datum | Primary source | Fallback | Stored in | Heals by |
|---|---|---|---|---|
| Fills (every buy/sell) | API orders (paged) | **CSV import** → manual | `fill_record` (append-only) | idempotent upsert on every resync; CSV backfills the deep past |
| Open lots / ladder | projection of fills | positions backfill (`source=position` lot) | `lot` (wipe+reproject) | every resync re-projects; reconcile guarantees totals match Schwab's live positions |
| Closed trades (realized P/L) | projection of fills | — (only as deep as the fill ledger) | `completed_trade` (wipe+reproject) | re-projection; deepens automatically when older fills arrive via CSV |
| Current positions (truth) | API positions | — | not stored (live), reconciled against | authoritative check on every resync; omission ≠ sold (never deletes by omission) |
| Cash transfers (deposits/withdrawals) | API transactions (60d, deduped by txn id) | CSV import (±4-day effective/posted window match) → manual | `cash_flow` | auto-pull on ledger view; CSV/manual merge idempotently |
| Dividends / interest | CSV import | manual refresh from API where exposed | app_setting JSON log (deduped day+amount+symbol) | re-import safe; per-symbol totals recompute |
| Daily balance series | nightly snapshot scheduler | — (accrues going forward only) | `daily_balance` | idempotent daily upsert; gaps are visible, not faked |
| Quotes / 52wk levels | API stream + price history | — | in-memory + `ticker` cache | demo-mode fallback is clearly labeled; money paths refuse untrusted quotes |
| Ticker classification (sector/industry/ETF) | FMP profile (day-cached) | user edit | `ticker` | enrich-on-add + bulk re-enrich button |
| Strategy config / prefs / rules | user | defaults | YAML + `app_setting` | versioned defaults; validation endpoint |
| Audit log (fills as events) | API fills | — | `audit_event` (unique fill_key) | insert-or-ignore on every resync |

## Onboarding a massive account (the "dad" flow)

1. **Connect Schwab** (in-app OAuth). Immediately: live positions, balances,
   quotes — the dashboard is fully usable with position-backfilled lots.
2. **Automatic API backfill**: first resync pulls the full available order
   history into `fill_record` — recent ladder + recent realized trades appear.
3. **One CSV upload** (Export from Schwab → Transaction History → CSV):
   the app routes *one file* three ways — Buy/Sell → fill ledger,
   transfers → deposit log, dividends/interest → income log — and re-projects.
   Years of ladder history, realized P/L, deposits and dividends land at once.
   Anything it skipped (unknown actions) is reported, never silently dropped.
4. **Data health panel** (Settings) shows coverage: earliest fill per source,
   per-symbol reconstructed-vs-live share diffs, how many lots are synthetic
   backfills, and exactly what to do about any gap ("import a CSV covering
   dates before X").

No manual entry unless the user *wants* to patch a hole older than their export.

## Self-healing invariants

- **Wipes only ever touch projections** (`lot`, `completed_trade`). Source
  ledgers (`fill_record`, `cash_flow`, dividends, audit) are append-only.
- A rebuild only commits from **trustworthy inputs**: fetch errors are no-ops;
  an empty read never deletes fill-derived history; positions omission never
  deletes a holding; every projection ends reconciled to Schwab's live totals.
- Every ingest path is **idempotent** — re-run anything, any time, safely.
- Degradation is **visible**: synthetic lots are tagged `source=position` in the
  UI, stale quotes are flagged, and the health panel names gaps instead of
  papering over them.
