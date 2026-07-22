// The GLOSSARY — one canonical definition per concept, referenced everywhere by id.
//
// This is the single source of truth behind the hover/click "definition" affordance
// (see Glossary.tsx / <Term>). A term appears the same and links the same wherever it
// shows up, so there's exactly one place to edit a definition. It also absorbs the old
// "ƒ = app-calculated" provenance mark: every entry carries a `source` (straight from
// Schwab / the app calculates it / a mix), shown as a line in the definition box, so
// numbers no longer need a separate glyph.
//
// Definition shape is deliberately uniform: a one-line plain-English `oneLiner`, then
// optional `howItWorks` (mechanics) and `howCalculated` (the formula, only when the app
// computes it), then `source`, then `related` cross-links (which are themselves terms
// you can drill into).

import { usd } from "./format";

export type TermSource = "schwab" | "computed" | "hybrid";

// A snapshot of the SELECTED account's live figures, fed to the glossary so a
// definition can show its formula worked out on real numbers ("on your account now").
// All optional/nullable — an example() returns null when the pieces it needs aren't in.
export interface GlossaryFigures {
  accountValue?: number | null;
  cash?: number | null;
  invested?: number | null;        // open-lot cost basis
  marketValue?: number | null;     // open-lot market value
  unrealized?: number | null;
  longMarketValue?: number | null;
  equity?: number | null;
  deployedPct?: number | null;
  leverage?: number | null;
  marginDebt?: number | null;
  maintenance?: number | null;
  maintCushion?: number | null;
  tradableFunds?: number | null;
  buyingPower?: number | null;
  harvestable?: number | null;
  dayChange?: number | null;
}

export interface GlossaryEntry {
  term: string; // canonical display label
  oneLiner: string; // plain-English, one sentence
  howItWorks?: string;
  howCalculated?: string; // present when source involves app computation
  // A live worked example on the selected account, e.g. "$5,048 ÷ $4,678 × 100 = 108%".
  // Return null when the needed figures aren't available (never throw).
  example?: (f: GlossaryFigures) => string | null;
  source: TermSource;
  related?: string[]; // other term ids
}

// helpers for example() strings
const has = (...xs: (number | null | undefined)[]) => xs.every((x) => typeof x === "number" && isFinite(x));
const signed = (n: number) => (n >= 0 ? "+" : "") + usd(n);

export const SOURCE_LABEL: Record<TermSource, string> = {
  schwab: "Straight from Schwab",
  computed: "The app calculates this",
  hybrid: "Schwab data, combined by the app",
};

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ---- account value / cash ----
  account_value: {
    term: "Account value",
    oneLiner: "What the account is worth right now if everything were sold.",
    howItWorks: "Schwab's liquidation value — the market value of your positions plus cash, minus any margin loan. It moves every second the market is open.",
    source: "schwab",
    related: ["cash", "invested", "margin_debt"],
  },
  cash: {
    term: "Cash",
    oneLiner: "Settled cash sitting in the account.",
    howItWorks: "The conservative 'free money' figure — it excludes anything you'd have to borrow on margin. Can be negative on a margin account when you're carrying a loan.",
    source: "schwab",
    related: ["available_to_trade", "margin_debt"],
  },
  available_to_trade: {
    term: "Available to trade",
    oneLiner: "What you can actually put into an order right now.",
    howItWorks: "Settled cash plus borrowing against fully-paid stock — Schwab's 'Settled Funds' / 'Funds Available to Withdraw'. This is the real limit: orders above it get rejected, so it's usually smaller than the looser Reg-T buying power.",
    source: "schwab",
    related: ["reg_t_buying_power", "cash"],
  },
  reg_t_buying_power: {
    term: "Reg-T buying power",
    oneLiner: "The looser margin buying power, assuming every security is marginable.",
    howItWorks: "Bigger than 'Available to trade' because it assumes you can borrow up to the 25% maintenance floor on everything. Sizing an order to this number often gets rejected — which is why the app plans against Available to trade instead.",
    source: "schwab",
    related: ["available_to_trade", "leverage", "maintenance_cushion"],
  },

  // ---- position value / P&L ----
  invested: {
    term: "Invested",
    oneLiner: "What you paid for the shares you currently hold.",
    howItWorks: "The cost basis of every open position — excludes cash. Compare it to market value to see the paper gain.",
    howCalculated: "Sum over open lots of shares × buy price.",
    source: "computed",
    related: ["market_value", "unrealized_pl", "cost_basis"],
  },
  market_value: {
    term: "Market value",
    oneLiner: "What your open positions are worth at the current price.",
    howCalculated: "Sum over open lots of shares × the latest quote (= cost basis + unrealized P/L).",
    example: (f) => has(f.invested, f.unrealized, f.marketValue)
      ? `${usd(f.invested)} cost ${signed(f.unrealized!)} = ${usd(f.marketValue)}` : null,
    source: "hybrid",
    related: ["invested", "unrealized_pl"],
  },
  unrealized_pl: {
    term: "Unrealized P/L",
    oneLiner: "The paper gain or loss on positions you still hold.",
    howItWorks: "Not locked in until you sell — it moves with the price.",
    howCalculated: "Market value − cost basis, across everything you hold.",
    example: (f) => has(f.marketValue, f.invested, f.unrealized)
      ? `${usd(f.marketValue)} − ${usd(f.invested)} = ${signed(f.unrealized!)}` : null,
    source: "computed",
    related: ["invested", "market_value", "realized_pl"],
  },
  realized_pl: {
    term: "Realized P/L",
    oneLiner: "Profit or loss you've actually locked in by selling.",
    howItWorks: "Every closed round-trip (a buy later sold) contributes its gain or loss. Scoped by the period selector on the Ledger.",
    howCalculated: "For each sell, proceeds − the cost of the specific lots it closed (the app matches sells to lots LIFO, per the ladder).",
    source: "computed",
    related: ["cost_basis", "day_trade", "last_position"],
  },
  day_change: {
    term: "Day change",
    oneLiner: "How much total account value moved since yesterday's close.",
    howItWorks: "Matches Schwab's 'Total day change'. Includes trading AND any deposits/withdrawals, so moving cash in shows up here too.",
    source: "schwab",
    related: ["account_value", "unrealized_pl"],
  },
  harvestable: {
    term: "Harvestable",
    oneLiner: "Profit you could lock in right now by selling every profitable last position.",
    howItWorks: "Equals what the 'Sell profitable' bulk action would realize — it only counts positions currently in the green.",
    howCalculated: "Sum over profitable last positions of (current price − last-buy price) × shares.",
    source: "computed",
    related: ["last_position", "realized_pl"],
  },

  // ---- margin ----
  margin_debt: {
    term: "Margin debt",
    oneLiner: "Money you've borrowed against your positions.",
    howItWorks: "Interest accrues on it daily. Shown as 'Debt on Owned' — a negative margin balance at Schwab.",
    source: "schwab",
    related: ["leverage", "maintenance_cushion", "reg_t_buying_power"],
  },
  leverage: {
    term: "Leverage",
    oneLiner: "How far your market exposure exceeds your own money.",
    howItWorks: "1.0× means unlevered (all your own cash); above 1.0× means you're using margin to hold more than you funded.",
    howCalculated: "Long market value ÷ equity (your own money).",
    example: (f) => has(f.longMarketValue, f.equity, f.leverage) && f.equity
      ? `${usd(f.longMarketValue)} ÷ ${usd(f.equity)} = ${f.leverage!.toFixed(2)}×` : null,
    source: "computed",
    related: ["margin_debt", "deployed_pct"],
  },
  deployed_pct: {
    term: "Deployed %",
    oneLiner: "How much of your own capital is currently in the market.",
    howItWorks: "Measured against your equity, NOT counting margin — so fully invested reads ~100%, and using margin to buy more pushes it OVER 100%. It's the 'am I stretched?' signal.",
    howCalculated: "Long market value ÷ equity × 100.",
    example: (f) => has(f.longMarketValue, f.equity, f.deployedPct) && f.equity
      ? `${usd(f.longMarketValue)} ÷ ${usd(f.equity)} × 100 = ${f.deployedPct!.toFixed(1)}%` : null,
    source: "computed",
    related: ["leverage", "margin_debt"],
  },
  maintenance_cushion: {
    term: "Maintenance cushion",
    oneLiner: "How much your equity sits above the margin-call floor.",
    howItWorks: "If it hits zero you'd face a maintenance call. The bigger the cushion, the more room prices have to fall before that happens.",
    howCalculated: "Equity − Schwab's maintenance requirement.",
    example: (f) => has(f.equity, f.maintenance, f.maintCushion)
      ? `${usd(f.equity)} − ${usd(f.maintenance)} = ${usd(f.maintCushion)}` : null,
    source: "computed",
    related: ["margin_debt", "leverage"],
  },

  // ---- returns / ledger ----
  net_deposits: {
    term: "Net deposits",
    oneLiner: "Your own money in, minus money out — the capital you actually contributed.",
    howItWorks: "Transfers and wires in/out, plus cash journals. NOT trades or dividends. It's the base every return figure is measured against.",
    source: "hybrid",
    related: ["roi", "xirr", "cash_identity"],
  },
  roi: {
    term: "ROI",
    oneLiner: "Return on the capital you put in.",
    howCalculated: "Account value gain ÷ the capital you contributed (net deposits, on a peak-capital base).",
    source: "computed",
    related: ["net_deposits", "xirr"],
  },
  xirr: {
    term: "XIRR",
    oneLiner: "Your annualized return, accounting for WHEN each deposit landed.",
    howItWorks: "A dollar added yesterday shouldn't count like one invested a year ago — XIRR weights each cash flow by its date, giving a true time-adjusted annual rate.",
    howCalculated: "The rate that makes the dated deposits/withdrawals and today's value net to zero (internal rate of return on the actual cash-flow dates).",
    source: "computed",
    related: ["roi", "net_deposits", "benchmark"],
  },
  benchmark: {
    term: "Benchmark",
    oneLiner: "What your dated contributions would be worth in an index instead.",
    howItWorks: "Takes your actual deposits on their actual dates and buys the benchmark (default SPY) with them, so it's an apples-to-apples 'what if I'd just bought the index' comparison.",
    source: "computed",
    related: ["xirr", "net_deposits"],
  },
  cash_identity: {
    term: "Cash cross-check",
    oneLiner: "A proof that the app's money history reconciles with Schwab's actual cash.",
    howItWorks: "If deposits + trading + income + fees don't add up to the real cash balance, something's missing — the check surfaces the gap instead of hiding it.",
    howCalculated: "net deposits + trading + income + other cash − margin debt, compared to Schwab's actual cash.",
    source: "computed",
    related: ["net_deposits", "margin_debt"],
  },

  // ---- ladder / strategy ----
  last_position: {
    term: "Last position",
    oneLiner: "Your most recent buy in a symbol — the bottom rung of its ladder.",
    howItWorks: "The strategy adds to a position in rungs; the 'last position' is the newest, deepest one. Its price sets where the next sell target and buy-dip are measured from.",
    source: "computed",
    related: ["ladder_rung", "sell_target", "buy_dip", "harvestable"],
  },
  ladder_rung: {
    term: "Ladder rung",
    oneLiner: "One step in a staged position — a single buy at a progressively lower price.",
    howItWorks: "Rather than buying all at once, the strategy ladders in: each dip adds a rung, and sells peel rungs back off (newest first, LIFO).",
    source: "computed",
    related: ["last_position", "buy_dip", "sell_target"],
  },
  buy_dip: {
    term: "Buy dip",
    oneLiner: "How far a price must fall below your last position before the app suggests adding.",
    howCalculated: "Last-position price × (1 − your dip %). Configurable per account and per symbol.",
    source: "computed",
    related: ["last_position", "ladder_rung", "sell_target"],
  },
  sell_target: {
    term: "Sell target",
    oneLiner: "The price at which the app suggests selling a position for profit.",
    howCalculated: "Last-position price × (1 + your sell-target %). Configurable per account and per symbol.",
    source: "computed",
    related: ["last_position", "sell_min_gain", "harvestable"],
  },
  sell_min_gain: {
    term: "Minimum gain",
    oneLiner: "The smallest profit a position must show before it's eligible to sell.",
    howItWorks: "Keeps the bulk 'sell profitable' action from dumping barely-green positions — anything below this floor is left alone.",
    source: "computed",
    related: ["sell_target", "harvestable"],
  },
  simple_view: {
    term: "Simple view",
    oneLiner: "A pared-down dashboard showing only the essentials.",
    howItWorks: "Hides the denser columns and marks so the table reads at a glance. Toggle it from the view pills.",
    source: "computed",
  },

  // ---- trades / tax ----
  cost_basis: {
    term: "Cost basis",
    oneLiner: "What you paid for the shares — the number gains are measured from.",
    howItWorks: "For shares bought within the API/CSV history it's the exact fill price. For older shares it may be Schwab's average cost (see Backfilled lot).",
    source: "hybrid",
    related: ["invested", "realized_pl", "backfilled_lot"],
  },
  day_trade: {
    term: "Day trade",
    oneLiner: "A position bought and fully sold on the same day.",
    howItWorks: "Flagged in the trade journal. Purely informational here — the pattern-day-trade rule was repealed, so nothing blocks them.",
    source: "computed",
    related: ["realized_pl", "hold_days"],
  },
  hold_days: {
    term: "Hold days",
    oneLiner: "How long you held a position from first buy to final sell.",
    howItWorks: "Drives the short- vs long-term tax split (365+ days = long-term).",
    howCalculated: "Calendar days between the opening buy and the closing sell.",
    source: "computed",
    related: ["day_trade", "progressive_tax"],
  },
  progressive_tax: {
    term: "Progressive tax estimate",
    oneLiner: "Estimated tax on your gains, stacked on top of your other income.",
    howItWorks: "Gains are taxed at your marginal bracket, so the app stacks them ON your salary rather than taxing them in isolation. An estimate, not tax advice.",
    howCalculated: "federal tax(salary + gains) − federal tax(salary), plus a flat state rate. Salary is an editable field used only to place the bracket.",
    source: "computed",
    related: ["realized_pl", "hold_days"],
  },
  backfilled_lot: {
    term: "Backfilled lot",
    oneLiner: "A holding the app couldn't reconstruct from history, priced at Schwab's average.",
    howItWorks: "Happens when shares were bought before the account's API history begins and no CSV covers them. The share count is right; the cost is Schwab's average rather than the exact fills. Import a Transactions CSV covering those buys to make it exact.",
    source: "hybrid",
    related: ["cost_basis", "invested"],
  },
  "52wk_high_pct": {
    term: "% of 52-week high",
    oneLiner: "Where the price sits relative to its highest point in the last year.",
    howCalculated: "Current price ÷ 52-week high × 100.",
    source: "hybrid",
    related: [],
  },
};

/** All defined term ids (handy for tests + Alt-reveal). */
export const TERM_IDS = Object.keys(GLOSSARY);
