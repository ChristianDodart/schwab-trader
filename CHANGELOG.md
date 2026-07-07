# Schwab Trader — what's new

Patch notes for each release. The newest version's section is pulled into the GitHub
release automatically and shown inside the app when an update is ready to install.

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
