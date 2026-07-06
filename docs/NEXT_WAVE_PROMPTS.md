# Next-wave task prompts (for delegated execution)

> **STATUS: Wave 1 (P1–P5 below) was EXECUTED 2026-07-05 and shipped in v0.3.0.** Kept
> here for reference. The **live queue is "Wave 2" at the bottom of this file.**

Five self-contained tasks, designed 2026-07-05. Each prompt below can be handed to a
separate session/model verbatim. They are ordered by value; they do not depend on each
other unless noted.

**Rules that apply to EVERY task (paste along with the prompt):**

> - Read `CLAUDE.md` at the repo root first — it's the project brain. Obey its
>   maintenance rules and update it when you finish (edit lines, don't append history).
> - Repo: `C:\Users\dodar\projects\schwab-trader`. Backend = Python/FastAPI in
>   `backend/` (run tests: `cd backend && .venv\Scripts\python.exe -m pytest tests/ -q`
>   — 57 pass today). Frontend = React/TS/Vite in `frontend/` (verify:
>   `npx tsc --noEmit` then `npx vite build`). Do not ship with either failing.
> - **NEVER touch money-path logic** (`orders.place_order` guards, `bulk.py` rails,
>   sell/oversell/PDT/fat-finger checks) unless the task explicitly says so. Display
>   layers may READ anything.
> - **Design system:** colors/spacing ONLY via CSS vars from `frontend/src/tokens.css`
>   (`--pos`/`--neg` for money, `--accent` = controls, text tiers `--text/-muted/-dim/-faint`);
>   reuse primitives from `ui.css` (`.btn*`, `.panel`, `.tbl`, `.pill`, `.field`) and
>   patterns from existing components. Errors via `useToast()`, never `alert()`.
>   "Only surface exceptions": don't add always-on green/OK indicators.
> - The dev Schwab token may be dead (shows "Not live") — that's environmental, not
>   your bug. Anything needing live Schwab data should degrade gracefully.
> - When done: run backend tests + tsc + vite build, update `CLAUDE.md` (one tight
>   bullet), and do NOT rebuild the installer (the maintainer batches that).

---

## P1 — Trade journal & performance analytics (Ledger → "Trades" sub-tab)

**Goal.** The app records every closed round-trip (`completed_trade` table) but has no
per-trade view — the old Google Sheet's "Long Log" was exactly this and it's the biggest
remaining feature gap. Build a **Trades** sub-tab under Ledger showing the full trade
log + performance analytics.

**Backend** (new endpoint in `backend/app/main.py` + logic in `backend/app/ledger.py`):
- `GET /api/ledger/trades?start=&end=&symbol=` → for the SELECTED account (use
  `await _selected()` like the other ledger endpoints):
  - `trades`: list of completed trades, newest first — `{id, symbol, shares, buy_price,
    sell_price, cost, profit, opened_at, completed_at, hold_days (completed−opened, None
    if opened_at is null), is_day_trade (opened_at == completed_at)}`.
  - `summary`: `{count, wins, losses, win_rate, total_profit, avg_win, avg_loss,
    profit_factor (gross wins ÷ |gross losses|, None if no losses), avg_hold_days,
    day_trade_count, best {symbol, profit}, worst {symbol, profit}}`.
  - `by_symbol`: per-symbol rollup `{symbol, count, total_profit, win_rate}` sorted by
    total_profit desc.
  - All computed in Python from one query (the table is small); guard divide-by-zero.
- Follow the existing style in `ledger.py` (`_f()` float casts, scoped `account_hash`
  conditions, `_parse_date` for start/end).

**Frontend** (`frontend/src/LedgerTrades.tsx`, wired into `Ledger.tsx`):
- Add a third `SubTabs` entry: Historic / Predictive / **Trades** (see `Ledger.tsx` —
  the SubTabs component + `${tab}-panel` tabpanel pattern already exist; extend the
  union type).
- Layout: summary cards on top (use `Card` from `LedgerUI.tsx`): Win rate (e.g. "68% ·
  34W/16L"), Total P/L (colored via `moneyColor`), Profit factor, Avg hold. Then a
  `PeriodSelector` (already in `LedgerUI.tsx`) + optional symbol filter (text input).
  Then the trades table (`.tbl`): Date closed · Symbol · Shares · Buy · Sell · P/L
  (colored, signed) · Held (e.g. "3d", "same day" chip when is_day_trade) · . Then a
  compact "By symbol" table.
- Empty state: friendly text ("No closed trades in this period.").
- Loading: reuse `SkeletonCards`/`SkeletonPanel` from `Skeleton.tsx`.
- Add types to `types.ts`.

**Acceptance:** tab renders with real data for the selected account (the dev DB has
11+ completed trades); switching period/symbol filters correctly; win_rate/profit_factor
math verified by a small pytest (`tests/test_trade_stats.py`) against a hand-computed
fixture; tsc + build + all tests green.

---

## P2 — Diagnostics & About panel (Settings)

**Goal.** Surface "what build am I running / is everything healthy" in one place.
The backend already exposes everything needed: `GET /api/version` (`{version, data_dir}`),
`GET /health` (`{status, version, database, stream_mode}`), `GET /api/auth/status`
(liveness: `verified_live`, `last_checked_ago_s`, `latency_ms`, `check_source`),
`GET /api/backups` (`{dir, db_bytes, keep, backups[]}`), `GET /api/fmp-status`.

**Build** a "About & diagnostics" `Section` at the BOTTOM of `frontend/src/Settings.tsx`
(follow the existing Section/Field pattern in that file):
- App version (big-ish, `Schwab Trader v0.2.0`), data directory path (code style,
  word-break), database size (MB).
- A small status grid: Database (from /health `database`), Schwab API (from auth/status:
  "Live · verified Ns ago · Xms" green, or the failure message amber/red),
  Quote stream (`stream_mode`: schwab=Live / reauth=Offline / demo=Demo / starting=Connecting),
  Company data (FMP configured ✓/—), Last backup (from /api/backups).
- A "Copy diagnostics" button that copies a plain-text block of all the above to the
  clipboard (for pasting into a support conversation).
- Poll nothing aggressively — fetch once on mount + a manual "Refresh" button.
- Do NOT duplicate the backup controls (the "Data & backups" section already exists) —
  link the eye to it with a one-line mention instead.

**Acceptance:** section renders with real values; degraded states readable (kill the
token → Schwab row shows the failure); tsc + vite build green.

---

## P3 — Orders tab polish (live refresh + working-order visibility)

**Goal.** The Orders tab is a static list; working orders deserve ambient visibility.

1. **Auto-refresh:** `frontend/src/Orders.tsx` — refetch the list every 15s while the
   tab is visible (clear the interval on unmount; guard out-of-order responses with an
   `alive` flag like `Screener.tsx` does). Keep the manual refresh button if present.
2. **Status chips:** render order status as a colored chip (reuse `.pill`):
   WORKING/QUEUED/ACCEPTED/PENDING_ACTIVATION → amber; FILLED → green (`--pos`);
   CANCELED/REJECTED/EXPIRED → dim (`--text-faint`). Keep the raw text inside the chip.
3. **Nav badge:** show a small count of WORKING-ish orders on the "Orders" nav tab
   (App.tsx `NAV` render) — e.g. "Orders ·2". Backend: add `GET /api/orders/working-count`
   in `main.py` delegating to a new `orders.working_count()` that reuses the existing
   `list_orders` fetch and counts statuses in {WORKING, QUEUED, ACCEPTED,
   PENDING_ACTIVATION} — READ-ONLY, do not touch place/cancel logic. Poll it in App.tsx
   every 60s; hide the badge at 0 (only-surface-exceptions).
4. Do NOT add any bulk-cancel button (money-path; out of scope).

**Acceptance:** chips render for the real order history on the dev DB; badge appears
only when a working order exists (can be simulated by temporarily returning a fake
count locally — do not place real orders); intervals cleaned up (no leaks on tab
switch); tsc + build + tests green.

---

## P4 — Frontend test harness (vitest) + pure-logic tests

**Goal.** The frontend has ZERO tests. Stand up vitest and cover the pure logic that
guards real behavior. NO component/DOM tests in this pass (no jsdom complexity) —
pure functions only.

1. `cd frontend && npm i -D vitest` ; add `"test": "vitest run"` to package.json
   scripts; create `vitest.config.ts` (node environment is fine for pure logic).
2. Extract-and-test (move functions into small exported helpers where needed, WITHOUT
   changing behavior — keep the same imports working):
   - `columns.tsx`: the `sanitize` logic inside `useColumnPrefs` (extract to an exported
     `sanitizeColumnIds(arr, validIds)` used by the hook) — test: drops unknown ids,
     de-dupes preserving order, honors explicitly-empty, returns null on corrupt input.
   - `FinancialRules.tsx`: `sizingSentence` (export it) — test the rung-range wording;
     and the ladder-preview math (extract `ladderPreviewRows(drops, maxRungs)` returning
     `{rung, price, drop}[]` from `LadderPreview`'s useMemo) — test tier boundaries
     (rung 2 = 10%, rungs 3+ pick the right drop, caps at 6 rows shown).
   - `Screener.tsx`: `fmtVol` and `fmtCap` (already module-level) — test the B/M/K
     thresholds and null handling.
3. Keep every extraction a pure move (same behavior); run `npx tsc --noEmit`,
   `npx vite build`, AND the new `npm test` — all green.

**Acceptance:** `npm test` runs ≥12 assertions across ≥3 files and passes; build
unchanged; no component behavior changed (extractions only).

---

## P5 — Small-fixes bundle (three independent items)

1. **Session dropdown gated by order type** (`frontend/src/OrderTicket.tsx`): Schwab
   rejects MARKET orders in AM/PM sessions. When order type is MARKET (or STOP/
   TRAILING_STOP — anything that becomes a market order), restrict the Session select
   to NORMAL (disable/hide AM/PM/SEAMLESS options and force value NORMAL if currently
   invalid). LIMIT/STOP_LIMIT keep all sessions. Don't touch the server.
2. **Skip pointless nightly fills-probes for no-fills accounts** (`backend/app/rebuild.py`
   area): the managed LLC account exposes NO fills, but every nightly sync still pages
   7 empty `get_orders` windows. Cache a per-account "exposes_fills" hint in
   `app_setting` (key `fills_capable:{account_hash}`, value "0"/"1"): set "0" after a
   sync where fills came back genuinely EMPTY (not None/error) AND the account has no
   fill-derived data (`_has_fill_derived_data()` false); set "1" whenever any fill is
   seen. When the hint is "0", `resync_account` may skip the fills fetch and go straight
   to positions mirroring — BUT still do a full fills probe once every 7 days (store
   last-probe date in the same setting, e.g. "0:2026-07-05") so a newly-enabled account
   is eventually rediscovered. SAFETY: any doubt → probe (default to probing). Add a
   pytest for the hint parse/refresh logic (pure helper).
3. **Audit-log retention** (`backend/app/notifications.py` or a small helper): the
   `audit_event` table grows forever. In the nightly snapshot scheduler (or a similar
   existing daily hook), delete audit rows older than 180 days AND beyond the newest
   5,000 (both conditions must hold — keep at least 5k rows regardless of age). Log
   how many were pruned. Add a pytest with an in-memory session if the test harness
   supports it, else a pure date-cutoff helper test.

**Acceptance:** each item verified as described; 57+ backend tests still pass; tsc +
build green; CLAUDE.md updated with one bullet per item.

---
---

# WAVE 2 — EXECUTED 2026-07-05, shipped v0.4.0

> W2-2..W2-5 done and verified. **W2-1 auto-updater is BLOCKED** — no git repo exists
> yet; wiring is done (`build-installer.ps1 -Publish`) but needs the maintainer to
> `git init`, create a GitHub repo, and fill `desktop/package.json` build.publish. Once
> that's set, W2-1's in-app "check for updates" UI is the only remaining piece.

(original prompts kept below for reference)

# WAVE 2 — live queue (designed 2026-07-05)

Same shared-rules header as Wave 1 applies (read CLAUDE.md; never touch money-path
logic unless told; design-system + toast rules; verify backend `pytest` + `npm test` +
`tsc` + `vite build`; do NOT rebuild the installer — that's batched via
`build-installer.ps1`). Ordered by value.

## W2-1 — Auto-updater wiring (finish the distribution story)

**Goal.** The Electron app already bundles `electron-updater` and builds a `latest.yml`,
but `desktop/package.json` `build.publish` still has `REPLACE_WITH_GH_OWNER/REPO`, so
silent updates don't work. Wire it to a real GitHub repo so a `build-installer.ps1`
release actually pushes an update non-tech users receive automatically.

- Ask the maintainer for the GitHub owner/repo (or read it from the git remote:
  `git -C <repo> remote get-url origin`). Fill `build.publish[0].owner`/`repo`.
- Add a `release` path to `build-installer.ps1` (a `-Publish` switch → `electron-builder
  --publish always`, requires `GH_TOKEN` in the env — document this in the script header
  and `desktop/README.md`).
- In-app: add an **"Updates" row** to the Settings "About & diagnostics" panel showing
  the current version + a "Check for updates" button that asks the Electron main process
  (via a new `preload.js` bridge `window.desktop.checkForUpdates()` →
  `ipcMain.handle` → `autoUpdater.checkForUpdatesAndNotify()`), and surfaces
  update-available / downloading / ready states. Guard everything on
  `window.desktop?.isDesktop` (dev browser shows "desktop app only").
- **Acceptance:** package.json has a real repo; `-Publish` documented; the Settings
  updates row renders in-app and no-ops gracefully in the browser. (Actual GitHub
  release upload needs the maintainer's token — don't attempt it, just wire it.)

## W2-2 — "Rules health" checks on the Financial Rules tab

**Goal.** The Rules tab lets you edit the strategy freely — including into nonsensical
states (drops that don't increase with depth, sizing tiers with gaps, a deployment
tier at >100%). Add a **non-blocking validation panel** that surfaces suspicious config.

- Pure backend helper `strategy.validate.check(cfg_mapping) -> list[{level, message}]`
  (level = "warn"|"info"). Checks: ladder drops non-monotonic vs rung depth; sizing
  tiers with a gap or non-ascending dollars; `max_rungs` < deepest tier; deployment
  tiers not descending / a `min_deployed_pct` >100 or `drop_multiplier` <1; sell
  `pct_above` <=0; universe `market_cap_min` >= `market_cap_max`. Pure + unit-tested.
- `GET /api/strategy/validate` runs it on the SELECTED account's config.
- Frontend: a subtle panel at the top of `FinancialRules.tsx` listing any findings
  (amber for warn), or a quiet "✓ Rules look consistent" when clean. Re-run on save.
- **Acceptance:** feed it a deliberately broken config → the right warnings; clean
  config → the ok state; pure checker unit-tested; never blocks saving (advisory only).

## W2-3 — Dashboard totals footer

**Goal.** The dashboard table has per-row numbers but no bottom-line. Add a **totals
row** (or footer band) summing the meaningful columns for the visible held positions:
total Invested, total Market value, total Unrealized P/L (colored), total Day P/L,
and total Harvestable — matching whatever money columns are currently shown.

- Frontend-only if the dashboard payload already carries the per-row fields (it does:
  invested, current_value, unrealized, day_change, last_pos_profit). Compute the sums
  in `DashboardTable.tsx` over `rows.filter(r => !r.is_watch)`; render a sticky `<tfoot>`
  styled distinctly (heavier top border, `--panel-2`). Respect the dynamic column set —
  only total the columns that are numeric money columns AND currently visible; blank the
  rest. Skip totals for columns where a sum is meaningless (price, %s, basis/share).
- **Acceptance:** totals match a hand sum of the visible rows; hiding/showing/reordering
  columns keeps totals under the right columns; watch rows excluded; tsc + build green.

## W2-4 — CSV export (trades + deposits)

**Goal.** Christian imports a Schwab CSV; let him get his OWN data back out (taxes,
spreadsheets, records). Add CSV export for the trade journal and the deposit log.

- Backend: `GET /api/ledger/trades.csv` and `GET /api/ledger/cashflows.csv` (reuse
  `build_trades` / `list_cashflows`), returning `text/csv` with a
  `Content-Disposition: attachment` filename incl. the account mask + date. A tiny
  shared `_rows_to_csv(headers, rows)` helper (stdlib `csv` + `io.StringIO`).
- Frontend: an "⬇ Export CSV" button on the Trades sub-tab and the deposit-log panel
  (respects the current period/symbol filter via query params — just forward them).
- **Acceptance:** files open cleanly in Excel with correct headers/values scoped to the
  current filter; no new deps; verified against the dev account's real trades.

## W2-5 — Small-fixes bundle #2

1. **Bundle chunk-size:** the vite build warns ">500 kB chunk". Add
   `build.rollupOptions.output.manualChunks` in `frontend/vite.config.ts` to split
   `lightweight-charts` (and optionally react) into a separate chunk. Acceptance: build
   warning gone; app still loads (verify via preview).
2. **`get_trading_account()` clarity:** when an order is refused because the account
   isn't trading-enabled, the toast just says so. Add the account mask to the message
   ("…8719 isn't trading-enabled — enable it in Settings") so multi-account users know
   WHICH one. Backend message only; no logic change.
3. **Backup restore affordance:** the backups list is backend-only. Add a read-only
   list of recent backups (filename + date + size) under Settings "Data & backups" (from
   the existing `GET /api/backups`), each with a "Reveal in folder"-style hint text
   (`explorer /select,<path>` is NOT wired — just show the full path + a copy button).
   Acceptance: list renders newest-first; no delete/restore buttons (too dangerous to
   automate — restore stays a manual file swap, documented).

---
---

# WAVE 3 — EXECUTED 2026-07-05, shipped v0.5.0

- **W3-1 Strategy-trigger notifications** — `strategy_triggers.py` watcher pushes a bell+desktop
  alert when a held position crosses its next-buy trigger or a sell target (edge-detected,
  reuses build_dashboard marks). Advisory only.
- **W3-2 Equity curve** — `EquityCurve.tsx` charts the nightly daily_balance `series` on Ledger→Historic.

# WAVE 4 — EXECUTED 2026-07-05, shipped v0.6.0

- **W4-1 Chart overlays** — `PriceChart` draws projected ladder-rung triggers (dashed) + 52wk avg/median
  (dotted) via `createPriceLine`; overlay managed apart from the candle stream (no rebuild on price tick).
  Backend `build_position_detail` now returns `avg_52wk`/`median_52wk`.
- **W4-2 Buying-power awareness** — `suggest_buy` + `bulk buy_plan` return `buying_power` (+ `affordable`);
  OrderTicket & BulkReviewModal show a soft "exceeds buying power" note. ADVISORY, never blocks.
- **W4-3 Phone reach** — `phone.py` optional ntfy.sh / SMTP channel (Fernet-encrypted), fired from the three
  loud emitters (resting fills, strategy triggers, price alerts) via `dispatch`; Settings panel + test button.
- **W4-4 XIRR** — pure `xirr.py` (Newton + bisection fallback) + 8 unit tests; `build_historic` adds `xirr_pct`;
  "Since inception" card on Ledger→Historic (deposited / value / gain+ROI / annualized XIRR).
- **W4-5 Small fixes #3** — dashboard dims + "prices may be stale" note when not live (reuses verified_live via
  `useLiveness`); cumulative-P/L sparkline on the Trades sub-tab; Screener remembers index/sort in localStorage.

# WAVE 5 — EXECUTED 2026-07-05, shipped v0.7.0

- **W5-1 In-app update banner** — `main.js` forwards electron-updater `update-available/downloaded/error`
  through the preload bridge; `UpdateBanner.tsx` shows the new version + patch notes + a one-click
  "Restart & update" (quitAndInstall) with a plain "or relaunch later" note. No-op on web.
- **W5-2 CHANGELOG + release-notes automation** — `CHANGELOG.md` holds fun per-version notes;
  `build-installer.ps1 -Publish` extracts the version's section, appends a standard "how to update"
  footer, sets it as the GitHub release body, and flips the draft to published (one source of truth →
  web release page AND the in-app banner via electron-updater's releaseNotes).
- **W5-3 SPY benchmark** — pure `benchmark.py` (`simulate` buy-and-hold over the account's own dated
  contributions) + 7 unit tests; `market_data` gained a "5Y" range; `ledger.build_benchmark` +
  `/api/ledger/benchmark`; an "If it were all SPY" card on the since-inception block, tinted by whether
  the active strategy is ahead of / behind the index. Fails soft (card hides) when history is short.

# WAVE 6 — EXECUTED 2026-07-05, shipped v0.8.0

- **W6-1 "What's new" viewer + update toast** — `CHANGELOG.md` bundled into the frontend via Vite `?raw`
  (`changelog.ts` parses per-version sections); a "What's new" panel in Settings shows the running
  version (expandable to older ones); a one-time "you're now on vX" toast compares `/api/version` to a
  localStorage `lastSeenVersion`.
- **W6-2 Benchmark polish** — pickable benchmark ticker (Settings → Benchmark, `benchmark_symbol` in
  app_setting, `/api/benchmark-symbol`); `build_benchmark` cached per (account, symbol) for 5 min so the
  Ledger view doesn't refetch 5Y history on every scope change. (Equity-curve overlay deferred → W7.)
- **W6-3 Keyboard shortcuts** — global keydown: digits 1..N switch tabs (through the dirty-settings
  guard), "?" toggles a help overlay; ignored while typing or when a modal is open.
- **W6-4 Small fixes #4** — OrderTicket remembers the last-used duration per session (type stays
  session-aware for safety); notifications bell pops on a new unread; compact sector-exposure strip on
  the dashboard (`SectorStrip.tsx`) from sector tags + market values.

# WAVE 7 — EXECUTED 2026-07-05, shipped v0.9.0

- **W7-1 Benchmark line on the equity curve** — pure `benchmark.value_series` (+3 tests) marks the
  benchmark position to each close; `build_benchmark` returns a `series`; `EquityCurve` overlays a
  dashed gold line with a legend. Single line when history is short.
- **W7-2 Sector concentration guardrail** — `SectorStrip` flags the biggest named sector when it exceeds
  a localStorage threshold (default 40%, inline control); tints the segment/chip + an advisory note.
- **W7-3 Tax-lot CSV** — `/api/ledger/tax-lots.csv?year=` emits acquired/sold dates, proceeds, cost
  basis, gain/loss, short/long-term; Trades tab has a year picker + "Tax" button.
- **W7-4 Realized/unrealized split** — `build_position_detail` adds `realized` (summed round-trips) +
  `unrealized` (mark-to-market); PositionDetail shows both as header stats.

# WAVE 8 — EXECUTED 2026-07-05, shipped v0.10.0

- **W8-1 Quick symbol jump** — "/" focuses a ticker filter on the dashboard (App keydown + `symInputRef`);
  narrows the table (SectorStrip/bulk keep the full row set); Escape clears.
- **W8-2 Screener filter chips** — candidates payload now returns a `filters` summary (cap band, country,
  excluded sectors, no-ETF); `FilterChips` renders them read-only with a pointer to Rules.
- **W8-4 Small fixes #6** — EquityCurve range switch (3M/1Y/All, client-side slice); click a SectorStrip
  chip to filter the table to that sector (removable); Orders tab working/filled/other tally.
- **W8-3 DEFERRED → W9-1** — dividend tracking needs a schema migration + live Schwab transaction parsing
  that can't be verified against the running DB; moved to Wave 9 to do carefully.

# WAVE 9 — EXECUTED 2026-07-05, shipped v0.11.0

- **W9-1 Dividend / income tracking** — pure `dividends.py` (parse + idempotent merge + summarize) + 7
  tests; `accounts.fetch_dividends` mirrors the verified transfer pull; stored as JSON in app_setting
  (NO migration — dividends stay out of cash_flow so the ROI/deposit base is untouched);
  `/api/ledger/dividends` + `/refresh`; "Dividends & income" panel on the Ledger with all-time + YTD
  totals, a per-payment list, and a Pull-from-Schwab button.
- **W9-2 folded in** — rather than a separate "total return" card (dividends are already in account value →
  would double-count), the income panel shows the dividend total and states plainly it's already reflected
  in returns. Honest framing beat a misleading rollup.
- **W9-4 Small fixes #7** — equity-curve range persists (localStorage); dashboard shows "showing N of M"
  when filtered; Settings "Copy support bundle" (diagnostics + log/backups paths).

# WAVE 10 — EXECUTED 2026-07-05, shipped v0.12.0

- **W10-1 Notification history search** — a filter box on the bell's feed + activity tabs (client-side over
  loaded rows) matches message or symbol.
- **W10-2 Dividend CSV import** — `is_dividend_action` (pure, tested) + `ledger.import_dividends_csv`
  (reuses the verified transfer-CSV parsing; deduped via `merge_dividends`); `/api/ledger/dividends/import`
  + an Import CSV button on the dividends panel. Covers history beyond the 60-day live pull.
- **W10-3 Per-symbol total return** — `build_position_detail` adds `dividends` (for the symbol) + a
  `total_return` (realized + unrealized + dividends); PositionDetail shows both stats.
- **W10-4 Small fixes #8** — top-payers breakdown on the dividends panel; "g"+letter vim tab jumps;
  screener "add all passing to watchlist".

# WAVE 11 — EXECUTED 2026-07-05, shipped v0.13.0

- **W11-1 Dashboard total-return column** — `build_dashboard` loads dividends once (grouped by symbol) and
  `_summary_row` returns `dividends` + `total_return` (realized + unrealized + dividends); two opt-in
  columns in the registry (watchNA for watch rows).
- **W11-2 Alert templates** — `AlertTemplates` on PositionDetail: one-click "−5% from last buy" / "above
  52wk avg" that compute the threshold from live data and POST the existing create_alert. Hidden when data
  is missing.
- **W11-3 Printable ledger summary** — a `PrintSummary` (.print-only) block + `@media print` CSS trick
  (visibility) so `window.print()` emits a clean one-pager; "Print / Save PDF" button on the Ledger.
- **W11-4 Small fixes #9** — dividends-by-year table; a "press ? for shortcuts" tip in Settings.

# WAVE 12 — EXECUTED 2026-07-05, shipped v0.14.0

- **W12-1 Break-even alert template** — "back above break-even" (threshold = basis/share) added to
  PositionDetail AlertTemplates. Dashboard-row templates deferred (would need a per-row menu → W13).
- **W12-2 Trade-journal print/PDF** — a `.print-only` closed-trades table + "Print / Save PDF" button on
  the Trades tab (reuses the global @media print CSS).
- **W12-3 Pause/resume dashboard** — a pause toggle freezes live ws updates (via `pausedRef` guard in the
  onmessage handler) + a "updates paused" chip. Configurable interval N/A (ws-push, not polling).
- **W12-4 Small fixes #10** — total_return + dividends added to the dashboard totals-footer sum set;
  notification feed grouped by day (Today / Yesterday / date).

# WAVE 13 — EXECUTED 2026-07-06, shipped v0.15.0

- **W13-2 Phone notification category prefs** — per-category toggles (price alerts / strategy triggers /
  fills) in the phone config; each `phone.dispatch` call site passes its category; `phone.send` gates on it.
  Settings checkboxes. In-app bell still gets everything. (Desktop-channel gating deferred — needs a
  notification `kind` field.)
- **W13-3 Position notes** — per-symbol free-text note stored per account in app_setting JSON (no
  migration); GET/PUT `/api/positions/{symbol}/note`; autosaving note box on PositionDetail.
- **W13-4 Small fixes #11** — pause chip shows the freeze time; screener candidate table sortable by
  Symbol / Market cap / % Chg. (Print account-name header deferred → W14.)
- **W13-1 NOT pursued** — per-row alert popover on the dashboard is marginal over the existing row bell
  (prefills the alert form) + position-detail templates; dropped to avoid low-value per-row menu UI.

# WAVE 14 — candidate queue (unstarted)

Same shared-rules header as Wave 1. Ordered by value.

## W14-1 — Notification `kind` + desktop-channel prefs
Add a `kind` (alert|trigger|fill) to the Notification model + push payload (migration), so the FRONTEND can
gate DESKTOP notifications by category too (completing W13-2's other half) and the bell can show a type icon.

## W14-2 — Account name in print headers
Thread the selected account mask/name into the Ledger + Trades print blocks (fetch once), so a printed/PDF
report is unambiguously tied to an account.

## W14-3 — Notes surfaced on the dashboard
A small indicator on dashboard rows that have a note (hover to preview), so the journal isn't hidden behind
opening each position.

## W14-4 — Small-fixes bundle #12
1. Position notes: show a "last edited" timestamp.
2. Screener: persist the chosen sort in localStorage.
3. Dividends: a CSV export of the income log (mirrors the trades/tax export).
