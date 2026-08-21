# CONTEXT — schwab-trader domain glossary

A living glossary of the domain terms this codebase uses, so names in code, reviews, and
architecture work stay consistent. Add a term when a module is named after a concept that
isn't here yet; sharpen a definition when a conversation clarifies it.

## Glossary

**Order intent** — a proposed order described in plain domain terms (symbol, side,
quantity, order type, limit/stop price), with no broker types or I/O. What the pre-trade
guards judge before anything is sent. See `backend/app/order_guards.py::OrderIntent`.

**Pre-trade guards** — the money-path safety rails evaluated against an order intent before
placement: *stop-direction* (a stop must sit on the correct side of the market),
*fat-finger* (a limit absurdly far from the last price is likely a typo — confirm),
*notional* (an oversized BUY is likely a quantity typo — confirm), and *held-shares* (a
SELL may never exceed shares held — fail closed). One pure module,
`backend/app/order_guards.py`; its interface is the test surface. A guard returns a
**verdict**: `ok`, `confirm` (soft — the user may override), or `reject` (hard).

**Trusted last price** — the last price used to validate a real order, taken only from a
schwab-sourced quote; a demo/synthetic quote reads as "no reference" so the guards fail
closed. `backend/app/orders.py::trusted_last_price`.

**Order status classification** — the single taxonomy over a broker order status, in
`backend/app/order_status.py`, read by the nav badge, the cancel/edit guards, and the
ticket's fill poll: *working* (live — cancelable/editable, allowlist), *cancelable* (cancel
unless known-terminal — a denylist, robust to Schwab adding new live statuses), *settled*
(a truly-final state — stop polling). The client never re-derives these; the order payload
carries `working` (per row) and `settled` (on the single-order lookup).

**Single-order placement** — the `place_order` / `replace_order` path: one order at a time,
sharing the pre-trade guards and their thresholds (20% fat-finger band, $10k notional).

**Bulk placement** — the `bulk.py` path: many orders reviewed together, with its own
per-item guard model (reject/skip, wider 25% / $25k thresholds) that then routes each item
through `place_order`. Deliberately separate from the single-order guards; reconciling the
two is an open decision, not a settled one.

**DashboardRow contract** — the wide per-symbol row the backend builds and the frontend
renders. Held and watch rows share one builder base (`dashboard.py::_base_row`, the ~14
identical quote/reference fields); `_summary_row` and `_watch_row` add their specifics on
top, so the two can't drift and every field the type promises is present on both kinds
(watch rows set the held-only fields to zero/None rather than omitting them).

**Row derivations** — the money-math computed off a `DashboardRow`, in one pure module
`frontend/src/rowDerived.ts`, so the table, account band, at-a-glance strip, Top-10 view,
and signal rules all read the same values instead of re-deriving (and drifting): *last
position gain %* (`lastPosGainPct`, guarded on a positive cost — also the sell-signal
metric), *today's % move* (`dayPct(change, value)` — change over start-of-day value, used at
account and position level), and *over the concentration cap* (`isOverConcentrationCap`, the
5% single-stock RULE 10). Money→color is the separate `moneyColor` (positive green, negative
red, exactly zero neutral) — the one money-color function.
