import type { DashboardRow } from "./types";

// User-defined EXTRA signal rules, OR'd with the built-in strategy buy/sell marks.
// Evaluated client-side against a dashboard row so colors update live as prices move.
export type SignalRule = {
  id: string;
  side: "buy" | "sell";
  metric: string;
  op: ">=" | "<=";
  value: number;
  color: string;
  label: string;
  enabled: boolean;
};

type Metric = { key: string; label: string; unit: string; get: (r: DashboardRow) => number | null };

// Metrics available per side + how to read each off a row (all fields the dashboard already sends).
export const SIGNAL_METRICS: Record<"buy" | "sell", Metric[]> = {
  sell: [
    { key: "last_pos_profit", label: "Last-position profit", unit: "$", get: (r) => r.last_pos_profit },
    {
      key: "last_pos_gain_pct", label: "Last-position gain", unit: "%",
      get: (r) => (r.last_pos_profit != null && r.last_pos_cost && r.last_pos_cost > 0
        ? (r.last_pos_profit / r.last_pos_cost) * 100 : null),
    },
  ],
  buy: [
    { key: "lilo_pct", label: "LILO (below last buy)", unit: "%", get: (r) => r.lilo_pct },
  ],
};

const getter = (side: string, metric: string) =>
  (SIGNAL_METRICS[side as "buy" | "sell"] || []).find((m) => m.key === metric)?.get;

export const metricLabel = (side: string, metric: string) =>
  (SIGNAL_METRICS[side as "buy" | "sell"] || []).find((m) => m.key === metric)?.label ?? metric;

export const metricUnit = (side: string, metric: string) =>
  (SIGNAL_METRICS[side as "buy" | "sell"] || []).find((m) => m.key === metric)?.unit ?? "";

export function matchesRule(rule: SignalRule, r: DashboardRow): boolean {
  if (!rule.enabled || r.is_watch) return false;
  const get = getter(rule.side, rule.metric);
  if (!get) return false;
  const v = get(r);
  if (v == null) return false;
  return rule.op === "<=" ? v <= rule.value : v >= rule.value;
}

// A fresh rule with sensible defaults (the $50 sell example is the common case).
export const newRule = (side: "buy" | "sell"): SignalRule => ({
  id: `r${Math.random().toString(36).slice(2, 9)}`,
  side,
  metric: side === "sell" ? "last_pos_profit" : "lilo_pct",
  op: side === "sell" ? ">=" : "<=",
  value: side === "sell" ? 50 : -5,
  color: side === "sell" ? "#c9a227" : "#4a90e2",
  label: side === "sell" ? "Take profit" : "Deep dip",
  enabled: true,
});
