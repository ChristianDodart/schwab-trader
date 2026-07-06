export type DashboardRow = {
  symbol: string;
  name: string | null;
  sector: string | null;
  is_watch: boolean;
  positions: number;
  shares: number;
  invested: number;
  basis_per_share: number;
  price: number | null;
  current_value: number | null;
  unrealized: number | null;
  day_change: number | null;
  lilo_pct: number | null;
  avg_52wk: number | null;    // mean of daily closes over the past year ("where it spends most of its time")
  median_52wk: number | null; // median daily close over the past year (spike-robust "typical" price)
  pct_of_high: number | null;
  portfolio_pct: number | null;
  year_high: number | null;
  year_low: number | null;
  next_buy_price: number;
  buy_mark: boolean;
  sell_mark: boolean;
  last_pos_cost: number | null;
  last_pos_profit: number | null;
  log_profit: number;
  trades: number;
  year_profit: number;
  year_trades: number;
  avg_monthly: number;
  first_buy_date: string | null;
  dividends: number;      // income received for this name (held rows)
  total_return: number;   // realized + unrealized + dividends
  has_note?: boolean;     // a saved journal note exists for this symbol
  last_held?: number | null; // watch rows previously held: last held price
};

export type Dashboard = {
  mode: string;
  total_invested: number;
  harvestable?: number | null; // profit lockable now = sum of positive Last Pos P/L (= what "Sell profitable" realizes)
  rows: DashboardRow[];
};

export type MarginSummary = {
  blocked: boolean;
  error?: string;
  is_margin?: boolean;
  account_value?: number | null;
  equity?: number | null;
  long_market_value?: number | null;
  cash?: number | null;
  debt?: number | null;               // borrowed against positions ("Debt on Owned")
  buying_power?: number | null;
  margin_buying_power?: number | null;
  maintenance_requirement?: number | null;
  maint_cushion?: number | null;      // equity above the maintenance floor
  maint_cushion_pct?: number | null;
  deployed_pct?: number | null;       // % of capacity in the market
  leverage?: number | null;           // long exposure ÷ equity
};

// --- ledger: historic (fact) + predictive (projection) ---
export type CashFlowRow = {
  id: number; day: string; amount: number; kind: string; source: string; memo: string | null;
};
export type LedgerNow = {
  source: "live" | "snapshot" | "unavailable";
  account_value: number | null; cash: number | null; buying_power: number | null;
  margin_buying_power: number | null; long_market_value: number | null;
  invested_cost: number; invested_market: number; unrealized_pl: number; open_lots: number;
  as_of_snapshot?: string | null; note?: string | null;
};
export type LedgerHistoric = {
  as_of: string;
  scope: { from: string | null; to: string | null };
  now: LedgerNow;
  realized: { cap_gains: number; gross_proceeds: number; cost_basis: number; trade_count: number; day_trade_count: number };
  contributions: { deposits: number; withdrawals: number; net: number; count: number; schwab_window_days: number; rows: CashFlowRow[] };
  net_contributed_all_time: number;
  deposited_all_time: number;    // gross deposits (the ROI base — withdrawals never reduce it)
  withdrawn_all_time: number;    // gross withdrawals (negative), shown for info only
  capital_by_year: { year: number; deposits: number; withdrawals: number; net: number }[];
  contributions_recorded: number;
  gain_vs_contributed: number | null;
  roi_pct: number | null;        // gain_vs_contributed / deposited_all_time (simple, timing-blind)
  xirr_pct: number | null;       // money-weighted annual return (accounts for WHEN money went in)
  series: { day: string; balance: number; capital_gains: number }[];
};
export type Trade = {
  id: number; symbol: string; shares: number; buy_price: number; sell_price: number;
  cost: number; profit: number; opened_at: string | null; completed_at: string | null;
  hold_days: number | null; is_day_trade: boolean;
};
export type TradeLog = {
  trades: Trade[];
  summary: {
    count: number; wins: number; losses: number; win_rate: number | null;
    total_profit: number; avg_win: number | null; avg_loss: number | null;
    profit_factor: number | null; avg_hold_days: number | null; day_trade_count: number;
    best: { symbol: string; profit: number } | null;
    worst: { symbol: string; profit: number } | null;
  };
  by_symbol: { symbol: string; count: number; total_profit: number; win_rate: number | null }[];
};

export type LedgerTax = {
  projected_annual_gain: number; other_annual_income: number; filing: string;
  federal_tax: number; state_tax: number; state_rate: number;
  total_tax: number; effective_rate: number; after_tax_gain: number; method: string;
};
export type LedgerProjection = {
  as_of: string; year: number; realized_ytd: number;
  days_elapsed: number; trading_days_elapsed: number; trading_days_left: number;
  projected_annual_gain: number; gain_per_trading_day: number;
  goal: {
    target: number | null; remaining: number | null; required_per_trading_day: number | null;
    progress: number | null; on_track: boolean | null; trading_days_left: number;
  };
  tax: LedgerTax; other_annual_income: number; filing: string;
};

// --- bulk actions (harvest profitable last positions / buy triggered dips) ---
export type SellCandidate = {
  symbol: string;
  lot_id: number;
  rung: number;
  shares: number;
  buy_price: number;
  price: number;
  order_type: string;
  limit_price: number;
  est_proceeds: number;
  est_profit: number;
  gain_pct: number;
  qualifies: boolean;      // meets the auto-select threshold (pre-checked)
  note?: string | null;
};
export type BuyCandidate = {
  symbol: string;
  rung: number | null;
  is_new: boolean;         // no existing position — a fresh entry
  shares: number;
  price: number;
  order_type: string;
  limit_price: number;
  est_cost: number;
  qualifies: boolean;      // dipped enough to auto-select (held only)
  note?: string | null;
};
export type BulkPrefs = { sell_min_gain_pct: number; buy_dip_pct: number };
export type BulkPlan<T> = { ok: boolean; mode: string; count: number; candidates: T[] };
export type BulkResult = {
  ok: boolean;
  placed: number;
  count: number;
  results: { symbol?: string; lot_id?: number; shares?: number; limit_price?: number; ok?: boolean; error?: string; order_id?: string }[];
};

export type Suggestion = {
  symbol: string;
  side: "BUY" | "SELL";
  order_type: string;
  quantity: number;
  limit_price: number;
  rung?: number;
  lot_id?: number;
  est_cost?: number;
  est_proceeds?: number;
  est_profit?: number;
  rationale?: string;
  note?: string;
  error?: string;
  buying_power?: number | null; // advisory: available buying power (BUY only)
  affordable?: boolean | null;
};

export type Alert = {
  id: number;
  symbol: string;
  direction: "above" | "below";
  threshold: number;
  note: string | null;
  repeat: boolean;
  active: boolean;
  last_fired_at: string | null;
  created_at: string | null;
};

export type Notification = {
  id: number;
  alert_id: number | null;
  symbol: string | null;
  message: string;
  price: number | null;
  read: boolean;
  created_at: string | null;
  kind?: "alert" | "trigger" | "fill"; // live-push only (not stored) — for desktop gating
};

export type AuditEvent = {
  id: number;
  kind: string;
  symbol: string | null;
  side: string | null;
  shares: number | null;
  price: number | null;
  order_type: string | null;
  message: string;
  at: string | null;
  created_at: string | null;
};

export type AlertPrefill = { symbol: string; price: number | null };

export type AuthStatus = {
  authorized: boolean;
  expired: boolean;
  severity: "ok" | "warn" | "expired";
  issued_at: string | null;
  expires_at: string | null;
  days_left: number | null;
  reauth_cmd: string | null;  // null now — reauth is via the in-app flow, not a CLI command
  message: string;
  // liveness — the result of the LAST real authenticated round-trip (probe or stream),
  // not just the token-file timestamp. null until the first check.
  verified_live?: boolean | null;
  last_checked_at?: string | null;
  last_checked_ago_s?: number | null;
  latency_ms?: number | null;
  check_source?: "probe" | "stream" | null;
};

export type MarketHours = {
  session: "pre" | "regular" | "post" | "closed" | "unknown";
  is_open: boolean;
  extended_open: boolean;
  date: string | null;
  next_change: string | null;
  error?: string;
};

export type Mover = {
  symbol: string;
  name: string | null;
  last: number | null;
  change: number | null;
  pct_change: number | null;
  volume: number | null;
};

export type Candidate = {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  market_cap: number | null;
  beta: number | null;
  is_etf: boolean;
  last: number | null;
  pct_change: number | null;
  in_movers: boolean;
  passes: boolean;
  reasons: GuardrailCheck[];
};
export type CandidateScreen = {
  ok: boolean;
  error?: string;
  count?: number;
  passing?: number;
  pool_note?: string;
  filters?: {
    market_cap_min?: number | null;
    market_cap_max?: number | null;
    country?: string;
    exclude?: string[];
    no_etfs?: boolean;
  };
  candidates?: Candidate[];
};

export type GuardrailCheck = {
  label: string;
  status: "pass" | "fail" | "manual";
  detail: string;
};

export type VetResult = {
  ok: boolean;
  symbol: string;
  name?: string | null;
  sector?: string | null;
  industry?: string | null;
  country?: string | null;
  last?: number | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  eps?: number | null;
  div_yield?: number | null;
  shares_outstanding?: number | null;
  avg_volume?: number | null;
  year_high?: number | null;
  year_low?: number | null;
  pct_of_high?: number | null;
  // deeper Schwab fundamentals (any may be null/absent)
  peg_ratio?: number | null;
  pb_ratio?: number | null;
  beta?: number | null;
  roe?: number | null;
  roa?: number | null;
  net_margin?: number | null;
  gross_margin?: number | null;
  operating_margin?: number | null;
  debt_to_equity?: number | null;
  current_ratio?: number | null;
  quick_ratio?: number | null;
  rev_growth?: number | null;
  eps_growth?: number | null;
  book_value_ps?: number | null;
  short_pct_float?: number | null;
  checks?: GuardrailCheck[];
  ev_note?: string;
  error?: string;
};

export type Order = {
  order_id: string;
  symbol: string;
  side: string;
  quantity: number;
  filled: number;
  type: string;
  price: number | null;        // fill price once executed, else the working/limit price
  limit_price?: number | null;
  fill_price?: number | null;
  status: string;
  entered: string;
};

export type Lot = {
  id: number;
  rung: number;
  source?: string;   // "fill" | "position" (backfilled from Schwab's aggregate)
  buy_date: string | null;
  age_days: number | null;
  shares: number;
  buy_price: number;
  amount: number;
  pct_down_from_prev: number | null;
  sell_target: number;
  sell_mode: string;
  proj_profit: number;
  pl_now: number | null;
  next_buy_sug: number;
};

export type ProjectedRung = {
  rung: number;
  trigger_price: number;
  suggested_dollars: number;
  suggested_shares: number | null;
};

export type PositionDetailData = {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  positions: number;
  shares: number;
  invested: number;
  basis_per_share: number;
  lilo_pct: number | null;
  avg_52wk: number | null;
  median_52wk: number | null;
  unrealized: number | null;
  realized: number;
  dividends: number;
  total_return: number;
  is_watch?: boolean;         // no open position — watch-mode detail
  last_held?: number | null;  // last price held (for a sold-out watch ticker)
  lots: Lot[];
  projected_ladder: ProjectedRung[];
};
