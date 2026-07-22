# Schwab Trader — what's new

Patch notes for each release. The newest version's section is pulled into the GitHub
release automatically and shown inside the app when an update is ready to install.

## v0.56.0 — "Trades straight from the source of truth"

- **Fills now come from Schwab's transactions record instead of the orders list.** Schwab confirmed
  transactions are the authoritative log of what actually executed — the orders list can omit fills
  (notably from good-til-canceled orders) and carries canceled/rejected noise. On the connected
  account this reproduced every existing fill exactly *and* recovered two real fills the orders list
  had dropped (which previously needed a manual CSV import to recover).
- **Full trade history is pulled automatically, back to when the account was API-enabled** — no more
  ~1-year fetch limit. History older than the account's API-enablement (e.g. an account that traded
  for years before being connected) still needs a one-time CSV import; the API simply doesn't serve it.
- Under the hood this is idempotent — the switch re-imports nothing and only adds what was missing —
  and the orders list stays as an automatic fallback if the transactions feed is ever unavailable.

## v0.55.0 — "Buying power you can actually use"

- **The app now plans against what you can really trade with, not the optimistic margin number.**
  It was reading Schwab's Reg-T "buying power" (the big number under Funds Available → To Trade),
  which assumes everything is marginable — so orders sized to it got rejected. It now uses the
  conservative "settled funds + borrowing" figure (what Schwab shows as "Settled Funds" and "Funds
  Available to Withdraw"), which is the amount orders actually clear against.
- **New "Available to trade" figure** on the dashboard KPI, the Ledger, and the buy-review / order
  tickets — with the looser Reg-T buying power shown alongside so you can see both.
- **Settings → Diagnostics now lists the live balance fields** (Available to trade, non-marginable
  availability, Reg-T buying power, day-trading BP, cash, SMA) so the numbers can be matched to your
  Schwab balances page at a glance.

## v0.54.0 — "Your theme sticks"

- **Fixed: the theme and font size now persist across restarts.** They were only saved in the
  window's local storage, which the app couldn't hold onto between launches (each start uses a fresh
  internal port, which resets that storage) — so every reopen fell back to the default look. Appearance
  is now saved in the database, the same durable place your column layouts already live, and is restored
  the instant the app opens.
- It's a single global preference (not per-account), so your chosen look holds no matter which profile
  or account you're viewing.

## v0.53.0 — "Spring cleaning"

- **Internal code-quality release** — no feature or behavior changes. Nine copy-pasted number
  parsers and four CSV-header helpers consolidated into one shared module each; the API layer
  decoupled from the app entrypoint; money formatters moved out of the root component; a linter
  (ruff) added to the backend with all findings fixed, including a few genuinely dead code paths
  and two wasted database reads in the bulk-buy flow.
- Everything verified unchanged: 218 backend + 32 frontend tests green.

## v0.52.0 — "No double-counted deposits"

- **Fixed a duplicated-transfer bug that threw the cash cross-check off by whole deposits.** When you
  imported a Transactions CSV *before* Schwab had posted a recent transfer, the deposit got logged
  twice — once from the CSV (keyed to the transfer's effective date) and again when Schwab's live pull
  later saw it (keyed to the posted date, a day or two apart). Schwab's pull only checked for exact
  transaction-ID matches, so it never noticed the CSV twin. The app now recognizes a CSV deposit and
  its later Schwab copy as the same money and keeps just one — so the cross-check stops over-counting.
- **This self-heals.** The next time your Ledger syncs, any existing duplicate deposits are cleaned up
  automatically — no re-import needed. (For the reporting account this removes one duplicated $1,000
  transfer, closing the cross-check to within a couple of cents.)

## v0.51.0 — "The ledger, pinned"

- **Trade fees and margin interest now sync live from Schwab.** They used to arrive only when you
  imported a Transactions CSV, so the cash cross-check drifted by exactly the fees of every trade
  since the last import. Now one hourly pull keeps deposits, dividends, fees, and margin interest
  current automatically — the identity stays pinned continuously, not just at import time.
- **A verification verdict on the Ledger itself.** The Historic tab now opens with a reconciliation
  strip: green "Verified against Schwab" when every position matches share-for-share and the cash
  identity closes, or a specific list of what differs (with the full report still under
  Settings → Data health & import). No more wondering whether the numbers are right.
- **The manual "pull from Schwab" buttons now sync everything** (transfers, dividends, fees,
  interest) in a single call instead of one slice each.
- CSV re-imports remain exact no-ops — both sources compute identical numbers from the same Schwab
  records, verified by tests either direction (pull-then-import and import-then-pull).

## v0.50.0 — "The cursor behaves"

- **The text "I-beam" cursor now appears only where you actually type** — search boxes, amount fields,
  notes. Hovering ordinary text (tickers, dollar figures, labels) shows the normal arrow instead, so the
  app stops looking like a web page and starts feeling like an app. Text is still selectable.
- **Clickable things show the hand pointer** — buttons, tabs, links, the theme dropdown — even the ones
  the browser used to leave as a plain arrow.
- **Unavailable buttons show the "no" cursor,** and a button that's placing an order shows the "working"
  cursor while the request is in flight.

## v0.49.0 — "A theme dropdown + vivid colors"

- **The theme picker is now a compact dropdown** instead of a long grid — the Settings page no
  longer scrolls to reach it. The button shows a live preview of the current theme; opening it lists
  every theme grouped (Dark, Light, Vivid, High Contrast), each with its own preview, and the list
  scrolls on its own if it's tall.
- **A new "Vivid" group** of six saturated, color-forward themes, all still WCAG AA:
  **Tron** (sharp electric-cyan, digital-grid feel), **Synthwave** (magenta & cyan), **Cyberpunk**
  (neon yellow on black), **Amber CRT** (warm amber-phosphor terminal), **Miami** (hot pink & teal),
  and **Ultraviolet** (electric violet). 29 themes in total.

## v0.48.0 — "Twice the themes, grouped"

- **12 new themes**, all meeting WCAG AA contrast for text and profit/loss — 23 in total.
  New dark themes: **Dracula, One Dark, Monokai Pro, Everforest, Kanagawa, GitHub Dark, Ayu Mirage**.
  New light themes: **GitHub Light, One Light, Rosé Pine Dawn, Everforest Light**.
  Plus a new **High Contrast Light** for maximum-legibility on white.
- **The theme picker is now grouped** into Dark, Light, and High Contrast, each with a labeled
  header and a count, so it's easy to scan to the look you want.
- As always, themes swap color only — layout, spacing, and motion are identical across every one.

## v0.47.0 — "ƒ, explained once"

- **Dropped the redundant "ⓘ" marker.** A figure now carries at most the small **ƒ** — which means
  "a formula: the app calculated this from your fills and/or Schwab data" (everything without a ƒ
  comes straight from Schwab).
- **ƒ is explained once, at the top of the Ledger,** instead of repeating "calculated by the app" on
  every hover. Hovering a figure now explains only what that specific number means — nothing else.

## v0.46.0 — "Bigger fonts + tidier hovers"

- **The font-size options step up.** "Small" is now the original default size, and "Medium" and "Large"
  go bigger from there (Large is noticeably larger than before) — so the whole app can be easier to read.
- **A ring on what you're hovering.** When a hover description appears, the exact word/mark you're
  pointing at gets a subtle outline, so it's clear what the tooltip belongs to.
- **The Ledger's hovers are untangled.** Each stat's "ƒ" and "(i)" markers now share one clean tooltip
  (the same on-theme bubble as the dashboard) instead of two separate popovers that overlapped the card.

## v0.45.0 — "Readability + polish"

- **Three app-wide font sizes** — Small / Medium / Large, in Settings → Appearance. Scales the
  whole app's text so it's easier to read; saved on this install and applied before the window even
  paints.
- **Nicer data tooltips.** Hovering a column header (or an "(i)" / "ƒ" mark) now shows one on-theme
  bubble that fades in — a single hover target for the whole header (the label and the little ƒ share
  it), instead of two separate boxes — and it no longer gets clipped at the edge of the table.
- **Less ETF clutter** — a leveraged ETF's row no longer shows its underlying's 52-week %, so those
  rows read like every other row.
- **The Watchlist sits a bit lower** — a little extra space above it separates it from your holdings,
  instead of the highlight band.

## v0.44.0 — "Dashboard polish"

- **The ETF underlying's % of 52-week high** is now a quiet faint aside on the "% of 52wk High"
  cell (matching Price's "sold $x"), instead of a boxed pill that looked out of place.
- **A clearer Watchlist separator** — a stronger divider band between your holdings and the
  watchlist below.
- **Fixed the table's hover tooltips.** The "ƒ" mark's description no longer gets clipped by the
  table's scroll edge or double up with the column's sort tooltip. The soft fade-in bubble stays
  on the "(i)" info descriptions where it belongs.
- **KPI hover.** Hovering the header figures now highlights the one you're pointing at and slides
  out the gear to customize them (kept out while you reach for it), instead of the gear always
  sitting there.
- **No more "—" for blank cells** — the last stray dash placeholders (e.g. a watch ticker with no
  52-week figure) are now simply empty.

## v0.43.0 — "Columns, your way"

- **The Columns manager now controls folding.** Each column has a chevron toggle — fold it behind
  the table's chevron, or keep it always shown. Mix and match however you like; your choice is saved.
- **Every column is movable now, including Price and Last Pos P/L.** The only column you can't move or
  remove is the Ticker. Your default layout is unchanged — Price and Last Pos P/L still lead.
- **Simple is now a view pill** next to All, To-Do, and Top 10 — one click to switch, and it sticks.
- **Bulk Sell is always available.** Profitable positions are still pre-checked, but you can open it any
  time and manually pick any holding to sell — even one that isn't in profit yet.
- **A leveraged ETF's underlying % of 52-week high** now shows as a small aside on the "% of 52wk High"
  column (like Price's "sold $x"), instead of a chip beside the ticker.
- **Empty values are simply empty** — the "—" placeholder is gone.
- **Nicer hover descriptions.** The little "(i)" and "ƒ" descriptions now fade in as a soft, on-theme
  bubble after a brief pause, instead of the abrupt system tooltip.

## v0.42.0 — "Demo mode"

- **A "Demo" button in the header** (next to the market-hours badge) brings the dashboard to
  life when the market is closed. Turn it on and it simulates gentle price ticks and the
  occasional fill on your real positions — so you can see the themes, the rolling header
  figures, and the green/rose row flashes in motion even on a weekend when nothing is trading.
  A clear DEMO banner shows while it's on, with a one-click "Turn off." It is purely visual:
  nothing is live, no orders are ever placed, and a reload turns it off.

## v0.41.0 — "Feel"

- **Rows flash when a position changes.** The moment a fill lands — a buy-down rung firing, a
  position opening, a trim, or a sell-out — that row gives a brief wash of color (green for a
  buy, rose for a sell) and settles. It keys off your actual share count, so the ordinary
  price ticks that arrive every couple of seconds never flash: only real fills do.
- **The header figures roll to their new value** on a meaningful change (a fill, a deposit) and
  snap instantly on the tiny second-to-second ticks — so live numbers stay easy to read instead
  of jittering.
- **A calm "placing" state on order buttons.** While an order is in flight, the button shows a
  soft light sweep instead of a spinner — on single orders and the bulk actions alike.
- **All of it honors "reduce motion."** With that setting on (your OS accessibility preferences),
  the highlights and roll-ups become instant: every bit of information is still there, just
  without the movement. The theme you pick never changes any of this — motion is identical across
  every theme.

## v0.40.0 — "Themes"

- **Pick a color theme in Settings → Appearance.** Eleven of them: Midnight (the
  original), Terminal, Catppuccin Mocha, Nord, Gruvbox, Tokyo Night, Rosé Pine,
  Solarized (dark and light), Institutional Light for well-lit rooms, and a
  High-Contrast option. Each shows a live swatch of its surface, accent, and
  profit/loss colors, and applies to the whole app the moment you click it.
- **"Follow system"** tracks your computer's light/dark setting automatically; pick a
  specific theme any time to override it. Your choice is saved on this install and
  applies before the window even paints — no flash of the wrong theme on startup.
- **Every theme is accessibility-checked.** All text and the profit/loss colors meet
  WCAG AA contrast against their backgrounds, and profit/loss never relies on color
  alone — the sign, arrows, and labels stay. Switching themes changes only color:
  layout, spacing, and motion are identical across all of them.
- **Charts follow the theme too** — the price and equity-curve charts restyle to match
  whichever theme is active.

## v0.39.3 — "Held ETFs count as holdings"

- **An ETF you hold no longer hides in the watchlist just because you only watch its
  underlying.** When you own a leveraged ETF (e.g. a 2x fund) but only track the stock it
  follows, that group now sorts up among your holdings — placed by the ETF's own P/L —
  instead of being buried below the "Watchlist" divider. It still nests visually under its
  underlying for direction context. A group only drops to the watchlist when you hold
  nothing in it.

## v0.39.2 — "Watchlist grouping"

- **A clear "Watchlist" divider** now separates your held positions from the tickers you're
  only watching, so it's obvious where holdings end and the watchlist begins.
- **The watchlist sorts alphabetically** (instead of the order tickers happened to be
  added), so it stays predictable.

## v0.39.1 — "Dashboard sort + tidy-ups"

- **Dashboard sorts by Last Pos P/L by default.** Biggest winners at the top, descending;
  then the losers (biggest loss first); watchlist tickers sit at the very bottom. (Click
  any column header to sort by it instead; a third click returns to this default.)
- **Watchlist rows lost the eye.** Since a watched ticker already has no P/L number and a
  remove button, the eye was redundant — gone. The "sold $x" price stays next to the live
  price.
- **Remove (×) buttons line up.** The × on every watchlist row now sits at the same spot,
  so they form a clean column.
- **"Live" is readable again** — it was rendering in a near-black system color; now it uses
  the normal muted text color.
- **Removed the leftover dotted underlines** on the Orders "P/L" column (and the position
  detail's realized figure) — a holdover from the old app-calculated marker.

## v0.39.0 — "Cleaner watch rows + more finish"

- **Watchlist rows read cleaner.** The wordy "WATCH · LAST $x" tag is now a quiet little
  eye icon next to the ticker, and the price you last sold at moves next to the live
  price (as "sold $x") — so you can see at a glance whether it's back below your exit.
- **Leveraged-ETF context is a compact chip.** The line "QBTS at 43.08% of 52wk high"
  under an ETF becomes a small "QBTS 43%" chip right beside the ticker — same signal,
  far less clutter (hover it for the full explanation).
- **A bit more finish.** Filled buttons pick up a soft top-light sheen, and inputs now
  sit slightly recessed with an accent-colored text cursor — small touches that make the
  controls feel more physical.

## v0.38.0 — "Fit and finish"

A visual-quality pass over the whole app — no features changed, everything just
feels more considered and premium.

- **Real depth.** Panels, cards, and menus are now lit from above with a subtle
  highlight and a soft layered shadow, so surfaces read as physical instead of flat.
- **Buttons you can feel.** The primary, Buy, and Get-me-out buttons gently lift on
  hover and press back down on click — a small tactile cue that makes the app feel
  responsive.
- **Calmer motion.** Everything now shares one easing curve, so opening a menu, folding
  a column, or a toast sliding in all move the same, unhurried way.
- **Focus that glows.** Click into any input and it picks up a soft blue focus ring.
- **Softer, deeper palette.** Slightly richer surfaces, a touch more rounding, crisper
  antialiased text, and money figures that always line up to the pixel.
- **Nicer loading + dialogs.** Skeletons now shimmer across instead of blinking, and
  modals fade up over a gently blurred backdrop.

## v0.37.0 — "Minimalist pass"

- **The Sync button is gone — it syncs itself now.** The selected account reconciles in
  the background: on a steady ~2-minute timer, the moment you switch accounts, and when
  you come back to the app. It covers non-trading accounts too. Nothing to press.
- **Leaner header.** Dropped the "Schwab Trader" title and the notification bell — the
  unread count now rides on the **Notifications** tab instead.
- **Quieter table.** Removed the totals row, and company names stay hidden until you open
  a ticker (the symbol alone is enough at a glance).
- **Gears get out of the way.** The Bulk Buy / Bulk Sell settings gears stay tucked away
  until you hover the button for about half a second, then slide out. Bulk Exit lost its
  count and its gear (there was never a reason to skip a stock on a "get me out").
- **Rebuilt position view.** Chart, Rules, Alerts, and Notes are now one compact row of
  pills — nothing is expanded by default, so your positions sit right under the summary
  instead of being pushed down the page. The projected ladder is tucked behind a
  "Show projected (next 5)" toggle at the bottom.
- **"Positions" everywhere.** The strategy's "rungs" are now called "positions" across
  the whole app — same mechanics, plainer word.
- **No position cap.** The old "max rungs" setting is gone and the ladder is unlimited —
  if your dips justify a 17th position, the app just lets you add it.

## v0.36.3 — "Dashboard tidy-up, round 2"

- **Profile / account chip moved to the top-right corner**, right above the tabs, out of
  the toolbar under the header.
- **Sector exposure is no longer on the Ledger** — it lives on the Screen tab now.
- **Add a ticker right from the table.** The word "Ticker" at the top of the first column
  is now the add box: type a symbol there and press Enter. The other column headers stay
  as normal text.
- **Columns menu no longer opens off-screen.** The "Columns" popover now opens leftward so
  it never forces a sideways scroll.
- **Reset keeps the expand chevron.** Clicking Reset in the Columns menu now also
  re-collapses the extra columns, so the ▸ expand arrow stays put instead of scrolling
  off the right edge.

## v0.36.2 — "Dashboard tidy-up"

- **Sector exposure moved to the Screen tab.** The concentration bar now lives on Screen
  (and stays on the Ledger), clearing the top of the dashboard.
- **Cleaner All / To-Do / Top 10 switch.** The little pill bar got roomier hit targets and
  proper spacing so it no longer feels squished.
- **Add ticker sits on the left, and the Add button is gone** — just type a symbol and
  press Enter. Less clutter, one obvious way to do it.
- **Pause updates removed.** It wasn't earning its keep.
- **The "more columns" control is now a chevron in the table.** A right arrow ▸ appears
  right where the next column would go — click it to roll the extra columns open, click
  the left arrow ◂ to roll them back in.
- Dropped the "Click a ticker to open its buy ladder" hint (clicking a ticker still opens
  its ladder — the line was just noise).

## v0.36.1 — "Ctrl+F to find a ticker"

- **Find a ticker the way you find anything else.** The always-visible "Jump to ticker"
  box is gone; press **Ctrl+F** (Cmd+F on Mac) on the dashboard and a small find bar
  slides in at the top-right — type a few letters to filter your positions, see the live
  match count, and press **Esc** or the × to close it. Exactly how find works in your
  browser and every other app, so there's nothing new to learn.

## v0.36.0 — "A Profile tab for who + which account"

- **Profile & account moved to their own tab.** Switching your trading profile
  (Christian / Dave / …), picking which account is active, and connecting Schwab all
  now live on a single, calm **Profile** tab — instead of crowding the bar above the
  table. The sub-bar keeps one small chip showing who you're trading as and the active
  account; click it to jump straight to the Profile tab.
- **Nothing changed about how switching works** — the same guarded switch (it still
  respects unsaved Settings) and the same "All accounts" overview with each account's
  value, day profit, cash, and positions. It just has more room to breathe now.

## v0.35.1 — "Columns that roll in and out"

- **The extra columns now roll open in place.** Instead of being hidden away behind the
  Columns menu, the folded columns stay right where they belong on the table — a
  "+ N more columns" toggle above the grid rolls them open (and "− fewer columns" rolls
  them back in) with a smooth slide. The four essentials — Price, Last Pos P/L, LILO %,
  and % of 52wk High — are always shown; everything else tucks in by default and is one
  click away, without leaving the table.

## v0.35.0 — "Layout refresh + leaner columns"

- **Nav moved to the right.** The tab bar (Dashboard / Screen / Ledger / …) now sits on
  the right of the top bar; the live-status pills, KPI glance, and alerts bell moved to
  the left next to the title.
- **Leaner default columns.** The dashboard now shows just Price, Last Pos P/L, LILO %,
  and % of 52wk High by default. Every other column is folded away and one click from
  the **Columns** button (nothing lost — just tidier). Already-customized layouts are
  kept; use Columns → Reset to adopt the new lean default.
- **Sector exposure on the Ledger.** The sector-exposure bar now appears on the Ledger
  too, so you get the "where's my money concentrated" glance there as well.

(Still coming: moving profile/account selection out of the sub-bar into its own place —
held back so it can be done without disturbing account switching.)

## v0.34.0 — "Simple view"

A one-click **Simple view** for the dashboard — for anyone who wants their holdings and
nothing else. The "Simple view" button lives next to Sync from Schwab; the choice is
remembered.

When it's on, the dashboard shows just your **actual holdings** (watchlist rows hidden)
in **four columns** — Ticker, Price, P/L, Value — and hides the clutter: the sector bar,
the All / To-Do / Top-10 tabs, the filter/add/columns/pause toolbar, the Bulk buy/sell/exit
tools, and the ƒ calculation marks. Click a ticker to open its ladder exactly as before,
and flip back to the full **Advanced** view any time. Nothing about the advanced view
changed — Simple is purely additive.

## v0.33.1 — "Cleaner provenance mark + Ledger coverage"

Replaces the dotted-underline provenance style (from v0.33.0) with a cleaner one and
extends it to the Ledger.

- App-calculated figures now carry a small superscript **ƒ** on their label (a footnote
  convention — "this is a formula/derived figure"), instead of a dotted underline. It
  sits on the label, never the number, so it never clashes with gain/loss color.
- The **Ledger** is now marked too: its calculated figures (realized gains, cost basis,
  contributions, ROI, tax, activity totals, …) show the ƒ; the raw Schwab balances
  (account value, cash, buying power) stay plain. Same treatment on the dashboard and
  position detail (headers and the position's stat cards), with a one-line legend under
  each group.

## v0.33.0 — "Computed vs Schwab, at a glance"

- Every table column now shows where its number comes from. Columns the app
  **calculates** (from your fills and/or Schwab data — realized P/L, cost basis,
  unrealized, % down, sell targets, LILO, projected profit, totals, …) get a dotted
  underline on the header; numbers that come **straight from Schwab** (price, day P/L,
  held shares, 52-week high/low) are plain. Hover any header to see which it is, and a
  one-line legend sits under each table. Live on the dashboard and the position ladder;
  the Orders P/L column and order-ticket estimates carry the same marker. (The rule:
  if Schwab hands us the number it's Schwab's; if we compute it — even from Schwab
  inputs — it's ours.)

This completes the order-features batch (ask/bid defaults + sell lockout, Orders P/L,
single-ticker LIFO sell, and this provenance indicator).

## v0.32.2 — "Single-ticker LIFO sell"

- A new "Sell shares" box on each position: type how many shares to sell and the app
  shows exactly which rungs it retires — **newest first (LIFO)** — as a row of chips
  (rung 12 ×165, rung 11 ×91, …), plus estimated proceeds and estimated realized P/L at
  the current price. "All" fills in the whole position. "Review sell" opens the order
  ticket pre-filled (quantity locked, limit at the ask). The only thing you set is the
  share count; the app resolves the LIFO rungs and makes the order obvious before you
  place it.

## v0.32.1 — "P/L on the Orders page"

- The Orders page now shows realized **P/L** per order. When a sell fills, the app
  books the round-trips it closed (LIFO) and tags them with that Schwab order id, so
  the row can show exactly what that sale made. Buys and working orders show "—" (a buy
  has no realized P/L). It's an app-calculated number (Schwab doesn't return a per-order
  P/L), marked with a dotted underline — the first taste of the computed-vs-Schwab
  indicator coming platform-wide.

The P/L fills in after the next background sync (which re-tags recent sells with their
order id); sells that only exist in imported CSV history have no order id and stay "—".

## v0.32.0 — "Smarter order ticket"

Order-ticket improvements (first of a few waves working through the feature list):

- Limit price now defaults to the resting side of the spread: a SELL starts at the
  ask (the high), a BUY at the bid (the low). Under the price field are quick chips —
  Bid, Ask, and your strategy Target — so you can see all three and one-tap between
  them. Your own edits are never overwritten by the live quote.
- Sell quantity is locked by default. A sell order opens with its share count
  read-only ("Locked · Edit") so you can't fat-finger the size; click Edit to change
  it. Buys stay freely editable.

Still to come in this batch: P/L on the Orders page, single-ticker LIFO bulk sell,
and a platform-wide indicator for app-computed vs Schwab-provided numbers.

## v0.31.12 — "Count all deposits (Funds Received / checks / MoneyLink Adj)"

Fixes understated deposits / capital contributed. The importer only recognized cash
transfers whose action said "transfer" or "wire" (plus cash journals), so it silently
skipped other real external cash: "Funds Received" (incoming cashier's checks / wires
booked as funds), "Funds Paid" (Schwab One checks written), and "MoneyLink Adj" (a bank
transfer adjustment). On one account that left $159,400 of deposits uncounted — the
account still balanced against Schwab overall (the money was just filed under "other
cash"), but the capital-contributed figure and any ROI based on it were wrong.

- The deposit detector now also matches "funds" and "moneylink" actions, so
  Funds Received/Paid and MoneyLink adjustments count as deposits/withdrawals.

Re-import the account's Transactions CSV to recategorize the affected rows.

## v0.31.11 — "Fix blank dashboard (hotfix)"

Fixes the dashboard getting stuck on the loading skeletons (introduced in v0.31.10).
An unknown-cost position reported its unrealized gain as blank, and the account-total
that sums every position's unrealized choked on the blank value — which silently
aborted the whole dashboard update, so rows never arrived. Unknown-cost positions now
report a neutral $0 unrealized (still not a fake gain), and the totals ignore blanks.

## v0.31.10 — "Dividend reinvestments + honest unknown-cost lots"

Two fixes for holdings whose shares arrived through something other than a plain buy.

- Dividend reinvestments (DRIP) are now imported. A "Reinvest Shares" row is a real
  purchase (it carries the shares and the price), so it's treated as a buy — with the
  correct cost and the correct date. Before, these rows were dropped, so a
  dividend-reinvesting holding lost cost basis and its age collapsed to ~1 year (the
  shares fell back to a synthetic "prior holdings" lot). The money-market sweep fund
  (SWVXX) is excluded — its reinvestments are cash, not a tradable position.
- Lots with no known cost no longer fake a gain. When a holding's shares came in with
  no cost basis (e.g. a rights distribution the broker booked at $0, or a
  position-backfill Schwab reported no average for), the app used to treat them as free
  — showing a phantom positive gain. Those shares are now left out of the cost/gain
  math, and a position with no known cost shows "—" for unrealized instead of a made-up
  profit. (Its share count and market value are unchanged.)

Re-import the account's Transactions CSV to pull the reinvestment history in.

Note on other corporate actions: mergers and spin-offs are intentionally still handled
by reconciling to Schwab's reported holdings (which carry the correct post-event cost),
rather than reconstructed from the CSV — so those positions already show the right cost,
just with a ~1-year age stamp. Full merger/spin-off history is a future item.

## v0.31.9 — "No false SELL signal from un-priced lots"

Fixes positions that showed a SELL signal (and fired sell notifications) while
underwater. The cause: a backfilled lot the app couldn't assign a cost to — Schwab
sometimes reports no average price for a transferred-in holding, so the lot landed at
$0.00. A $0 lot has a sell target of ~$0, so the position's price is always "above
target" and the SELL mark stays on permanently.

- Buy/sell signals and the dip math now consider only lots with a KNOWN cost basis.
  A lot we couldn't price can't be judged in-profit, so it no longer drives the SELL
  mark, the next-buy suggestion, or the % from lowest buy. Its shares still count in
  the position size.

Note: a position whose recent (cheaper) rungs are in profit while older rungs are
underwater will still correctly signal SELL — that's the ladder taking profit on the
top rungs by design, even when the position is net negative. This fix only removes the
FALSE signals from lots with no real cost. A holding stuck at $0 cost (e.g. EOSER) also
needs its real basis — import an older Transactions CSV that covers its purchase.

## v0.31.8 — "Forward splits (not just reverse)"

Fixes cost basis on positions that went through a forward / "stock" split (common on
leveraged ETFs like the 2x quantum names, and on names like NVDA/CMG). Previously only
REVERSE splits were recognized; a forward split was dropped entirely, so pre-split buy
lots kept their pre-split price and share count. Example: a QBTX lot bought at $456
after a 3:1 forward split should read as ~$152 across 3x the shares — it was still
showing $456. The mismatch also forced a bogus $0-cost "prior shares" lot to be
backfilled to make the totals add up, which showed a fake positive gain on that rung.

- Forward / stock splits are now detected in the Transactions CSV, in both shapes
  Schwab exports them: a paired "Stock Split" + "Stock Split Adj" (new + old totals),
  and a single "Stock Split" row that only lists the shares received (the ratio is
  derived from the shares held at the split). Both share count AND per-share price are
  adjusted, cost basis preserved, no fake P/L.
- Removes the $0-cost backfilled lots these dropped splits used to create.

This is a CSV-sourced correction: after updating, re-import the account's Transactions
CSV (Settings) so the split enters the ledger, then the ladder rebuilds with corrected
lots. A plain sync won't add it — splits aren't orders, so they only arrive via the CSV.

## v0.31.7 — "No more phantom holdings"

Fixes two data-integrity bugs that could make an account show positions it doesn't
actually hold — inflating the position count, deployed capital, and unrealized P/L.
Found reconciling a heavily-traded account against Schwab.

- Same-day round trips now reconstruct correctly. A Transactions CSV isn't always
  execution-ordered within a day, so a buy and its same-day sell could arrive
  sell-first. That left the buy stranded as a fake open lot (and flagged a false
  "oversold"). Any day whose sequence would drive a long-only position negative is now
  recognized as mis-ordered and corrected to buys-before-sells for that day only —
  days with a valid order keep their real sequence untouched, so genuine same-day
  buy/sell/buy trades still attribute to the right lots.
- Sold-out positions are no longer kept as phantoms. Schwab's positions feed omits
  symbols you hold none of (it never reports "0 shares"). The reconciler used to keep
  any omitted symbol to avoid wiping a real holding on a partial read — but when the
  read is verified complete, an omitted symbol is genuinely sold out and is now
  dropped. (The conservative keep-on-omission behavior still applies to partial or
  failed reads, which never reach this path.)

After updating, the correction applies on the next sync (or use Rebuild from the fill
ledger in Settings to apply it immediately).

## v0.31.6 — "% Down sanity + no dashboard flicker-storm"

- The "% Down" column no longer shows a nonsensical large negative (like
  -571%). A rung that was added at or above the previous rung isn't a dip down,
  so it now shows a plain "—" (hover explains why) instead of a misleading
  number. Only real dips below the prior rung get a percentage.
- Fixed a rare case where opening a stack could make the screen appear to rapidly
  flicker or "spam." If the live dashboard feed hit a snag building one update, it
  used to drop the connection and immediately reconnect over and over; now a bad
  tick is skipped quietly and the feed stays up.

## v0.31.5 — "Three papercuts"

- The symbol/filter boxes on Ledger → Trades no longer reset after one keystroke.
  (They were being torn down and rebuilt on every letter, stealing focus.)
- Modals no longer close when you click a control inside — like a number's
  up/down arrow — and release the mouse outside the box. A modal now only closes
  on a click that both starts and ends on the dimmed background.
- Short activity is now visible. Settings → Data health shows a small "Short
  activity" line (sell-short and cover fills, net cash) so the numbers aren't
  hidden — while still being kept out of the long-only Trades and Activity
  totals, so they can't distort those figures.

## v0.31.4 — "Day change = Schwab's Total day change"

The dashboard's Day Change now matches the big number in Schwab's account summary
(their "Total day change") — the change in your total account value since
yesterday's close, deposits and withdrawals included. It comes straight from
Schwab's own balances (today's value minus its value at the open), so it lines up
with what Schwab shows. Move cash in from another account and it'll show here,
just like on Schwab. (Falls back to a local estimate only when offline.)

## v0.31.3 — "Day change, straight from Schwab"

Day Change now uses Schwab's own per-position number verbatim, so the header
matches Schwab's Positions "Day Chng" total to the penny — including how they
account for same-day buys and intraday round-trips (which are genuinely hard to
reproduce exactly from trade history). It refreshes about every 45 seconds; if
the app can't reach Schwab, it falls back to computing the figure locally. This
supersedes the local calculation from the last update.

## v0.31.2 — "Round-trips and journals count"

Two accuracy fixes:
- Day Change now includes the profit you realize by trading in and out during the
  day. Before, it only measured the paper move on shares you still hold — so a day
  where you sold a position for a gain and rebought it (an intraday round-trip)
  under-counted badly. It now matches Schwab's per-position "Day Chng" exactly:
  today's value + what today's sells brought in − what today's buys cost − where
  the position stood at yesterday's close.
- Cash journals are now counted as deposits/withdrawals. Moving cash between your
  Schwab accounts posts as a "Journal" — the app was skipping those, so a transfer
  in (e.g. from the LLC) went untracked and left the cash cross-check off. Cash
  journals now flow into the deposit log; share journals (which carry a ticker,
  not cash) are still left out. Re-import your Transactions CSV to pick up past
  journals — it's deduplicated, so nothing double-counts.

## v0.31.1 — "Day change, done right"

Day Change now matches how Schwab calculates it. Before, every share was
measured against yesterday's close — so a position you bought TODAY booked a
full day's move it never actually experienced, throwing the number off. Now
shares held from yesterday are measured from the prior close, and shares bought
today are measured from what you actually paid — exactly Schwab's per-position
"Day Chng." Deposits and withdrawals don't count (this is your holdings' move,
not account-value change).

## v0.31.0 — "Notifications, under control"

Notifications got a real home and a volume knob, and the whole app switched to
crisp vector icons.
- New Notifications tab. The bell in the header is now a shortcut into it. Inside:
  your feed, your price alerts, recent activity, and — finally — Settings.
- One clear place to decide what interrupts you: a grid of the three event types
  (price alerts, strategy triggers, order fills) across the three channels
  (in-app, desktop, phone). Tick exactly what you want where. Plus a master
  "mute everything" switch and per-ticker mutes. Muting never loses history —
  a muted item still lands in the feed, it just won't pop, badge, or text you.
  Order fills no longer pop a desktop notification by default (they were the
  noisiest).
- Fixed the annoying burst: switching profile or account no longer fires a pile
  of strategy-trigger notifications for the account you just opened.
- Signals moved from Settings to the Rules tab, where they belong (they're the
  flags your rules produce). Phone setup moved into the Notifications tab.
- Every icon is now a clean SVG (bell, gear, sync, close, chevrons, and the
  rest) instead of an emoji — consistent and sharp on every machine.

## v0.30.0 — "Your dashboard, your way"

A declutter and a new customizable header:
- The top-right metric boxes are now yours to choose. Click the gear beside them
  to pick from Invested, Day change, Harvestable, Market value, Unrealized P/L,
  Cash, and Buying power. The new default adds a dollar Day change (green/red,
  like Schwab) alongside the familiar three. Your selection is remembered.
- Dashboard cleanup: leveraged-ETF rows no longer carry a "tracks X" tag or the
  parent an "ETF" pill — the indent and the underlying line already say it. The
  resting-order marker is now just a compact count (hover for the detail, click
  to open Orders). A watch ticker's Buy button only appears once you open that
  row, so it never sits inline looking like a buy signal.
- The account picker is now a clean label of the active account; switching moved
  entirely into the "All accounts" view (which shows each account's numbers).
- Add ticker and Columns moved down next to the table where you use them.
- Better ETF matching: a leveraged single-stock ETF now links to its underlying
  even when the fund name isn't loaded yet, by matching the shared ticker prefix
  (so a freshly-added position groups right away). An ETF whose underlying you
  don't actually hold correctly stays on its own.

## v0.29.1 — "Enrichment, actually"

One fix: company-data enrichment (sector, industry, country) now runs at
startup as it always should have. A long-standing naming collision meant the
startup pass silently did nothing, so tickers only got tagged when you opened
the Screener or hit refresh. Now the app fills them in on its own — the
Screener's sector-exclusion and country guardrails work without a manual nudge.

## v0.29.0 — "Engine room"

Internals hardening — little to see, lots to trust:
- The app now keeps a proper log file (app.log in the data folder, self-rotating,
  never grows past a few MB), and Settings → About & diagnostics shows the most
  recent warnings and errors right in the app — no file digging when something
  looks off.
- Fixed a quiet inefficiency where every minute's sync re-added rows of history
  the app then immediately re-evicted. Imports and syncs now settle instead of
  churning.
- The notification bell now prunes old entries the same way the audit log does
  (180 days, always keeping the newest 2,000), so years of use can't bloat it.
- Accessibility: screen-reader labels on icon buttons, save confirmations that
  announce themselves, and tooltips/popovers that return focus where you were.
- Under the hood, the two largest files in the codebase were split into focused
  modules and the app gained its first end-to-end endpoint tests. Nothing
  changed in behavior — verified by the full 173-test suite and a route-by-route
  comparison.

## v0.28.0 — "Know your numbers"

Analytics depth on the Ledger:
- A profit calendar on Ledger → Activity: a month grid where each day is tinted
  by the realized profit it booked — deeper green or red means a bigger day.
  Hover for the day's exact numbers, click a traded day to open its closed
  trades, and page back through any month of your history.
- The Trades journal now shows your streaks and swings: longest win and loss
  streaks (plus the one you're on), best and worst day and week, and max
  drawdown with how far below the peak the account sits right now (from the
  daily balance history the app has been snapshotting).
- Click any row in the "By symbol" table for that ticker's mini-report: every
  close in the period, win rate, average hold, total P/L, and its own
  cumulative sparkline.

## v0.27.0 — "Daily driver"

Conveniences for the trading day:
- Edit a working order without the cancel-and-retype dance. Working limit orders
  in the Orders tab now have an Edit button: change the price or quantity and
  Schwab swaps the old order for the new one in a single operation — you are
  never left without an order resting mid-change. The same safety rails as
  placing apply (typo-sized prices and quantities ask for confirmation, sells
  can never exceed shares held, partial fills are called out).
- Dashboard rows now show a small "working" marker when a ticker already has a
  resting order, so you can't double-place a rung by accident. Click the marker
  to jump to the Orders tab filtered to that symbol.
- The Orders tab has a symbol filter box.
- An "All accounts" button next to the account picker shows every account on
  your profile at once — value, day profit, cash, and position count per
  account, plus combined totals. Click a card to switch to that account.

## v0.26.0 — "Welcome aboard"

The first ten minutes, made obvious:
- A setup guide now greets a fresh install on the dashboard: four steps
  (connect Schwab, choose your account, import your history, review the rules),
  each checked off live as you complete it, each one click. It retires itself
  when everything is done, and Settings can bring it back any time.
- The app now nudges you BEFORE the Schwab connection dies: a notification about
  two days out, another the day of, and one when it expires — once per stage, to
  the bell and your phone if configured. No more discovering stale quotes at
  market open.
- If the connection is already expired when the app opens, the reconnect window
  opens itself — no hunting for the banner.
- Demo mode is now unmissable: a labeled strip above the positions table says the
  numbers are synthetic and offers a one-click connect, on every tab.

## v0.25.0 — "Polish pass"

Small quality-of-life touches:
- Position notes preview on hover. The note dot on the dashboard now shows the
  note's text in a hover tooltip, so you can read your thesis without opening the
  ticker.
- The notification bell tags each entry with a small icon by type — price alert,
  strategy trigger, or order fill — so the history scans at a glance.
- Printed/PDF Ledger and Trade Journal pages now carry an account line (mask,
  type, and active profile) in the header, so a saved page says whose account
  it is.
- A note now shows a brief "Saved" confirmation when it autosaves, and an
  "unsaved" hint while you're mid-edit.
- Suggested-share counts in the projected ladder are comma-formatted.

## v0.24.1 — "To the penny"

The last cash-identity blind spot, closed: per-trade fees (the SEC cents on each
sell) are now captured exactly from the export's Fees column, aggregated per day
into the other-cash log on import. After a fresh import the cross-check should
sit within a few dollars of zero — what remains is only activity newer than the
import and same-day settlement timing, and the panel says so.

## v0.24.0 — "Every dollar accounted"

New this version:
- The cash cross-check is now essentially airtight. It accounts for short-sale
  cash flow (stored alongside the ledger, still excluded from the long-only
  ladder), margin debt (borrowed money no longer reads as a phantom surplus),
  and a new "other cash" import — margin interest, dividend adjustments, cash
  in lieu, awards, fund distributions — all routed automatically from the same
  one-file CSV import. What remains unexplained is per-trade fees (cents each)
  and anything newer than your last import. A large residual now genuinely
  means something is missing.
- Dashboard column sorting. Click any header to sort (click again to flip,
  third click restores the default order); remembered between sessions, and
  grouped ETFs always travel with their parent stock.
- Return % is now measured against your PEAK capital — the most of your own
  money that was ever in the account at once. Withdrawing and later
  re-depositing no longer inflates (or deflates) the base; the Ledger shows
  the peak alongside gross deposits. XIRR remains the timing-correct headline.
- Removed the Profit factor card from the Trades view (not meaningful for a
  strategy that rarely sells at a loss).

## v0.23.2 — "Shorts, seen"

Two follow-ups from the same live account:

- Open short positions are now recognized. If you're currently short a stock at
  Schwab, the Data health panel labels it as an open short (informational — the
  app's ladder is long-only) instead of reporting it as a share-count
  difference. The reconciliation also knows the difference now.
- Importing a CSV now cleans up its own history. Rows stored by an older version
  of the import logic that today's parser no longer produces (e.g. short-sale
  covering buys that briefly counted as long buys) are removed automatically —
  scoped strictly to the symbols and date range the file actually covers, so a
  partial export can never touch anything else. One re-import fully reconciles
  the stored history with the file. (Verified: the 400 phantom RUN shares from
  the earlier report are gone.)

## v0.23.1 — "The right lots"

A field-found fix to imported-history accuracy. On days where an imported trade
shared the date with live-synced trades, the imported one was treated as
happening at midnight — so a sell could pair against week-old lots instead of
the shares actually bought that same morning, leaving the wrong rung as your
"last position" (and sometimes flipping a SELL flag that shouldn't be there).

- Imports now preserve the export's real within-day sequence (Schwab's file is
  newest-first inside each day too — that ordering is real information).
- On mixed days, an imported trade is placed after the live-synced trades that
  actually preceded it, so LIFO retires the same lots it did in real life.
- Re-importing a CSV you've already imported repairs the ordering of the
  previously stored history — that's the whole fix for existing data: update,
  re-import once, done. Verified on the affected account: the INMB ladder's
  deepest rung is now exactly the expected 1,006 shares @ $1.9899, with every
  position total still matching Schwab.

## v0.23.0 — "Rules per ticker"

New this version:
- Per-ticker rules. Any symbol can now override the global strategy — its own sell
  target ($ gain or % above cost) and its own dip depth (a percentage of the global
  ladder: 50% buys dips half as deep, 200% waits for twice the drop). Set it from
  the ticker's detail page under "Ticker rules"; buy triggers, sell flags, the
  ladder and projections all follow immediately, and an amber diamond marks the
  ticker on the dashboard. One click puts it back on the global rules.
- The Ledger's Activity view gained a Profit column — the realized gain booked in
  each day/week/month/year (sell price minus that lot's buy price, times shares,
  summed across the period's closed trades) plus a Realized Profit total up top.
  Activity is also now sourced from the full stored history, so imported years
  show up, not just recent live activity.

Fixes:
- Dropdowns no longer clip their text vertically on Windows display scaling —
  anywhere in the app.
- The Data health panel now tells the difference between a real cost-basis gap
  (missing data) and a lot-accounting difference: when share counts match Schwab
  exactly, a basis difference is just LIFO (this app's ladder view) vs your Schwab
  tax-lot election, and it's labeled as informational instead of a warning.

## v0.22.1 — "Self-healing, proven"

A field-found fix. Importing a real two-year account exposed two subtle defects in
how live-synced trades and CSV history were matched up, causing some holdings to
show more shares than Schwab actually reports:

- After-hours fills were being dated on the wrong day. A fill at 7pm Eastern is
  the next calendar day in universal time, which made it miss its CSV twin and
  count twice. Trades are now dated on Schwab's ledger day (Eastern), matching
  the CSV.
- When live data and CSV history described the same trading day, the live side
  was assumed complete — but Schwab's live history can be PARTIAL at the very
  edge of its window, and trusting it there discarded a few real CSV trades.
  The two sources are now compared by total shares per day, and whichever
  accounts for more wins.

The ledger now heals itself: every sync re-checks dates and re-resolves any
overlap automatically. If your Data health panel showed share-count or cost-basis
differences after a big import, update, then re-import the same CSV once — the
numbers converge to exactly what Schwab holds. (Verified on the affected account:
every discrepancy resolved to a perfect match.)

## v0.22.0 — "Weird stuff handled"

Data-integrity hardening, part two — validated against a real 1,554-row,
two-year account export full of edge cases.

New this version:
- Reverse splits are handled. When an imported history contains a reverse split,
  the position is rescaled on the effective date with its cost basis carried over
  exactly — no phantom shares, no fake profit or loss. Applied before that day's
  trades, and the import summary tells you how many splits it found.
- Short sales no longer confuse an import. The ladder is long-only, and Schwab's
  export labels a short's covering purchase a plain "Buy" — the importer now nets
  those buys against the open short balance so they never fabricate long
  positions. Shorts excluded and covers netted are reported on import.
- Two new validations against Schwab on the Data health panel:
  - Cost-basis check — your reconstructed cost per holding vs Schwab's average
    price, flagged when they disagree meaningfully (catches a mispriced or
    missing lot even when share counts match).
  - Cash cross-check — deposits + sells - buys + income should roughly equal
    your actual cash; a large unexplained gap hints at missing history. Advisory,
    with its blind spots (fees, interest, shorts) listed right next to the number.

## v0.21.0 — "Your history, whole"

The data-integrity release: complete, self-healing data — built so someone with
years of trading history can start using the app without typing anything in.

New this version:
- A durable fill ledger. Every buy and sell the app ever sees is now stored
  permanently; your ladder and realized-trade history are rebuilt from it rather
  than from whatever the Schwab API happens to remember (it only reaches back
  about a year). Recent trades keep syncing automatically like before.
- One-file history import. Export your full transaction history from Schwab
  (Accounts › History › Export) and drop the CSV into Settings › Data health &
  import — trades, deposits, and dividends are all routed from that single file,
  years of ladder and realized history land at once, and the app re-derives
  everything. Importing the same file twice is always safe; nothing double-counts.
  Trades already known from the live connection are recognized and skipped.
- Data health panel. Settings now shows exactly what your history covers — how
  many fills are stored and from where, the date range, realized-trade depth,
  any holdings that predate the stored history, and any share-count differences
  vs Schwab — with plain instructions on how to fill a gap when one exists.

Under the hood, positions and realized trades are now a pure projection of the
stored history: they can be rebuilt at any time, and imports only ever add —
nothing in your source data is overwritten or deleted.

## v0.20.0 — "Group up, get out"

New this version:
- Leveraged ETFs now group under the stock they track. If you hold, say, a 2x QBTS
  fund, it shows as an indented row right beneath QBTS — tagged "tracks QBTS" and
  showing QBTS's % of 52-week high, since that's what really tells you the direction.
  The link is auto-detected from the fund name; you can set or clear it by hand on the
  ETF's detail page.
- New "Bulk Exit" button — the "get me out" companion to Bulk Buy and Bulk Sell. It
  places a good-till-canceled limit sell of each selected position at its last-buy
  price (nothing is pre-selected; the price offset is adjustable). The aim is to exit,
  not to profit — a limit only ever fills at your price or better, so it rests until
  filled. The three bulk buttons are now named Bulk Buy / Bulk Sell / Bulk Exit.
- Deployed % now measures against your own capital, not your margin. So fully invested
  with cash reads ~100%, and using margin to hold more pushes it over 100% — an at-a-
  glance "am I stretched?" number.

Fixes:
- The Signals settings now show the exact numbers the built-in rule fires at (e.g. "BUY
  at the next ladder rung, first dip -10% · SELL at +$50 profit"), and the rule dropdowns
  no longer clip their text before you open them.
- The "update ready" banner now renders its release notes cleanly (no more stray HTML
  tags) — matching the formatting you already see under Settings › What's new.

## v0.19.0 — "At a glance"

New this version:
- To-Do and Top 10 on the dashboard. Two new sub-tabs next to your holdings: To-Do narrows the
  list to just the names meeting a buy or sell signal right now, and Top 10 gives a quick glance at
  the biggest dips worth buying and the biggest gainers worth selling.
- Tickers are now color-coded by risk everywhere they appear. Blue is calmer (broad funds, large
  caps), amber is a small cap, and red flags the spicy stuff — leveraged/inverse funds and micro
  caps. Neutral names stay their usual color.
- New Activity view on the Ledger. See the dollars you bought and sold by day, week, month, or year,
  with the net cash flow for each period — for those "I did well last month, what did I actually do?"
  moments.

## v0.18.0 — "Signal it your way"

New this version:
- Custom signal rules. The built-in BUY/SELL flags stay as your default rule, but now you can add
  your own OR rules under Settings > Signals — e.g. flag a SELL when a position's profit is at least
  $50, or when it's up a set percentage from your cost — each with its own color and label. Tickers
  light up when the default or any of your rules match.
- Cash on the dashboard. Your settled cash now shows in the header; hover it to see your full buying
  power (cash plus available margin).
- The sector-exposure concentration alert is now opt-in — a small "Alerts" toggle on the strip, off
  by default (it's mainly useful for larger accounts). The exposure bar itself always shows.

## v0.17.0 — "Keep up with the trade"

New this version (all from real-use feedback):
- The dashboard updates right after you trade. Placing or canceling an order now kicks an
  immediate holdings refresh instead of waiting on Schwab's activity stream — so what you see
  matches your order confirmation within a second or two.
- Sell out of a position and it sticks around. When you close a position completely, its ticker
  automatically moves to your watchlist, tagged with the last price you held it at.
- Click into watchlist tickers. Watch names now open a detail view too — price chart, 52-week
  levels, your notes, and one-click alerts — even with no open position.

## v0.16.0 — "Quiet the pop-ups"

New this version:
- Desktop notification control. You can now choose which categories pop a desktop notification —
  price alerts, strategy triggers, and fills — right from the notification bell. (The bell itself
  still logs everything.)
- A small dot now marks any position that has a saved note, so your journal is visible at a glance
  from the dashboard.
- Export your dividend/income log as a CSV.
- The screener remembers your chosen sort between sessions.

## v0.15.0 — "Your notes, your noise"

New this version:
- Position notes. Every position now has a notes box — jot your thesis, targets, or reminders,
  and they're saved to your account and waiting next time you open it.
- Choose what reaches your phone. Under Phone notifications you can now toggle price alerts,
  strategy triggers, and order fills independently — the in-app bell still shows everything.
- The screener's candidate list is now sortable — click Symbol, Market cap, or % Chg.
- When you pause the dashboard, the chip now shows the time it froze at.

## v0.14.0 — "On your terms"

New this version:
- Pause the dashboard. A "Pause updates" button freezes the table so a live quote can't shift a
  row while you're reading or clicking — resume when you're ready.
- Print your trade journal. The Trades tab now has a "Print / Save PDF" button for a clean
  closed-trades report.
- A new break-even alert: on any position, one click sets "notify me when it's back above my cost."
- The dashboard totals row now sums the Total Return and Dividends columns too, and the
  notification feed groups by day (Today / Yesterday / date) so it's easier to scan.

## v0.13.0 — "For the record"

New this version:
- Print or save your ledger as a PDF. A "Print / Save PDF" button on the Ledger produces a clean
  one-page summary - account value, deposits, gain, ROI, XIRR, benchmark, dividends, and capital by
  year - ready for your records or an accountant.
- One-click price alerts. On any position, set "−5% from last buy" or "back above 52-week average"
  without typing a single number.
- A Total Return column for the dashboard (turn it on via Columns) - realized, unrealized, and
  dividends for each name, added up.
- The Dividends view now breaks your income down by year, too.

## v0.12.0 — "The whole picture"

New this version:
- Every position now shows its total return - realized gains, unrealized gains, and dividends
  for that name, added up, so you see a holding's full contribution at a glance.
- Search your history. The notification bell's feed and activity now have a filter box - type a
  symbol or a word to find past alerts and fills.
- Full dividend history. Alongside the 60-day live pull, you can now import a Schwab Transactions
  CSV to bring in dividends going back as far as you like, and the Dividends view highlights your
  top payers.
- Keyboard power: press "g" then a letter (d, s, l, o, r) to jump to a tab, vim-style - on top of
  the number keys.
- The screener can add every passing name to your watchlist in one click.

## v0.11.0 — "Count the dividends"

New this version:
- Dividend tracking. The Ledger now has a Dividends & income view - pull your dividend and
  interest payments straight from Schwab, see the all-time and this-year totals, and a list of
  every payment. (Dividends land as cash, so they're already part of your account value and
  returns - this just breaks out how much came from income.)
- The equity curve remembers your range choice (3M / 1Y / all) between visits.
- When you filter the dashboard, it now tells you how many positions you're seeing.
- A "Copy support bundle" button in Settings gathers your diagnostics and points to the log
  file, so reporting an issue is one click and one attachment.

## v0.10.0 — "Find it fast"

New this version:
- Jump straight to a ticker. Press "/" on the dashboard and start typing - the table narrows
  to what you're looking for. Escape clears it.
- Click a sector to focus. Tap any slice in the sector-exposure strip and the table filters to
  just those positions; tap again (or the x) to clear.
- The screener now shows its active filters. Cap band, country, excluded sectors, and the
  no-ETF rule appear as chips, so it's obvious why a name passed or didn't.
- The equity curve got a range switch - flip between 3 months, 1 year, and all time.
- The Orders tab shows a quick working / filled tally at a glance.

## v0.9.0 — "See it, prove it, file it"

New this version:
- Your account, drawn against the index. The equity curve now overlays a second line showing
  what the same deposits would have been worth in your benchmark - so "am I beating it?" is a
  picture over time, not just two numbers.
- A concentration heads-up. The dashboard's sector strip now flags when any one sector grows
  past a threshold you set, so an over-weighted book doesn't sneak up on you. Advisory only.
- Tax season, sorted. Export a year's closed trades as a tax-ready CSV - acquired and sold
  dates, proceeds, cost basis, gain/loss, and short vs long-term - from the Trades tab.
- Clearer position detail: each position now shows its realized and unrealized profit side by
  side, so you can see what's booked versus what's still riding.

## v0.8.0 — "Faster on your feet"

New this version:
- Keyboard shortcuts. Press number keys to jump between tabs, and "?" any time to see the
  full list. Your hands can stay off the mouse.
- Pick your benchmark. The "If it were all ..." comparison isn't stuck on SPY anymore -
  choose QQQ, VTI, or any ticker you like under Settings, and the Ledger updates to match.
- A "What's new" panel lives in Settings now, so you can re-read the notes for your version
  any time - and you'll get a small nudge the first time you open a freshly updated build.
- A sector-exposure strip on the dashboard shows at a glance where your money is concentrated,
  built from the sector tags you keep.
- Small niceties: the notifications bell gives a subtle pop when something new lands, and the
  order ticket remembers your last-used duration for the session.

## v0.7.0 — "Tell me when, and tell me how you did"

The app now updates itself gracefully. When a new version finishes downloading, you'll
see a friendly banner right in the app with these notes and a "Restart & update" button
- one click and you're on the latest, with all your data and settings untouched. No more
wondering whether you're up to date.

New this version:
- Live update notes. Every future release shows you exactly what changed, right when it's
  ready, so updating feels like unwrapping something rather than a chore.
- Am I actually beating the market? The "Since inception" card now shows what the very
  same deposits would be worth if you'd just bought and held SPY instead - so your return
  finally has an honest yardstick next to it, not just a number in a vacuum.

## v0.6.0 — "Know your numbers"

New this version:
- Your price chart now shows where your next ladder buys sit - dashed lines mark each
  projected rung, with faint 52-week average and median lines for context. No more
  guessing where the next dip-buy triggers.
- Buy tickets gently warn you when an order would run past your available buying power.
  It never blocks you - just a heads-up so nothing is a surprise.
- Phone alerts. Optionally get resting fills, strategy triggers, and price alerts pushed
  to your phone via ntfy (no account needed) or email. Set it up under Settings.
- A new "Since inception" card shows your true annualized return (XIRR) - the honest
  number that accounts for when you added money, not just how much.
- The dashboard dims and warns you when prices might be stale, so a frozen quote never
  gets mistaken for a real move.

## v0.5.0 — "The foundation"

- Strategy-trigger notifications when a held position crosses its next-buy or sell target.
- An equity curve on the Ledger, charting your account value over time.
- The whole app now lives in version control with automatic updates - the groundwork that
  makes everything above possible.
