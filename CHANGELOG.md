# Schwab Trader — what's new

Patch notes for each release. The newest version's section is pulled into the GitHub
release automatically and shown inside the app when an update is ready to install.

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
