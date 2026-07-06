import { useEffect, useRef, useState } from "react";
import { usd, pct } from "./App";
import type { DashboardRow, Lot } from "./types";
import { matchesRule, type SignalRule } from "./signals";

import { API } from "./api";

// ============================================================================
// Customizable columns. Each view (dashboard, ticker drill-down) has its own
// registry of available columns and its own saved layout (order + which are
// shown). The "available" list is sourced straight from these registries — i.e.
// the values we actually have. Layouts persist in localStorage.
// ============================================================================

export type ColAlign = "left" | "right";

export type DashCol = {
  id: string;
  label: string;
  align: ColAlign;
  watchNA?: boolean;                       // render "—" on watch rows (no position)
  render: (r: DashboardRow) => React.ReactNode;
};
export type DetailCol = {
  id: string;
  label: string;
  align: ColAlign;
  render: (l: Lot) => React.ReactNode;
};

const sign = (n: number | null | undefined) =>
  n == null ? undefined : n >= 0 ? "var(--pos)" : "var(--neg)";
// Colored money/percent with a redundant +/- sign so gain vs loss reads without
// relying on color alone (colorblind-safe). `v` is the pre-formatted string
// (usd/pct already render "-" for negatives); we prepend "+" for positives.
const Colored = ({ v, n }: { v: string; n: number | null | undefined }) => {
  if (n == null) return <Dash />;
  return <span style={{ color: sign(n) }}>{n > 0 ? "+" : ""}{v}</span>;
};
const num = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");
const Dash = () => <span style={{ color: "var(--text-faint)" }}>—</span>;

// RULE 10 from the sheet: keep every stock under 5% of the portfolio. Flag any
// held position at/over this so over-concentration is visible at a glance.
export const CONCENTRATION_CAP = 0.05;
const PortfolioPct = ({ r }: { r: DashboardRow }) => {
  if (r.portfolio_pct == null) return <Dash />;
  const over = r.portfolio_pct >= CONCENTRATION_CAP;
  return (
    <span style={over ? { color: "var(--warn)", fontWeight: 600 } : undefined}
      title={over ? `Over the ${(CONCENTRATION_CAP * 100).toFixed(0)}% single-stock cap` : undefined}>
      {pct(r.portfolio_pct)}{over ? " ⚠" : ""}
    </span>
  );
};
// BUY/SELL signal chip — the ▲/▼ glyph keeps it separable in grayscale.
const Chip = ({ children, kind }: { children: React.ReactNode; kind: "buy" | "sell" }) => (
  <span className={`chip chip-${kind}`} style={{ marginLeft: 4 }}>
    <span aria-hidden="true">{kind === "buy" ? "▲" : "▼"}</span>{children}
  </span>
);

// A custom-rule chip in the rule's own color (▲ buy / ▼ sell for grayscale separability).
const CustomChip = ({ rule }: { rule: SignalRule }) => (
  <span className="chip" style={{ marginLeft: 4, background: rule.color, color: "#0b0e13", fontWeight: 700 }}
    title={`Your ${rule.side} rule matched`}>
    <span aria-hidden="true">{rule.side === "buy" ? "▲" : "▼"}</span>{rule.label || rule.side.toUpperCase()}
  </span>
);

// The BUY/SELL chips for a row: the built-in strategy marks (default rule, red/green) PLUS
// any user signal rules that match (each in its own color). Rendered at the ticker cell.
export function rowSignalChips(r: DashboardRow, rules: SignalRule[] = []): React.ReactNode {
  if (r.is_watch) return null;
  const matched = rules.filter((rule) => matchesRule(rule, r));
  if (!r.buy_mark && !r.sell_mark && matched.length === 0) return null;
  return (
    <>
      {r.buy_mark && <Chip kind="buy">BUY</Chip>}
      {r.sell_mark && <Chip kind="sell">SELL</Chip>}
      {matched.map((rule) => <CustomChip key={rule.id} rule={rule} />)}
    </>
  );
}

// ---- dashboard columns (operate on a summary row) ----
// Order here = the order columns are offered in the "add" dropdown.
export const DASH_COLUMN_LIST: DashCol[] = [
  // Mean of the daily closes over the past year — "where the stock spends most of
  // its time." Compare against the pinned Price: below = historical discount
  // (lean buy), above = rich (lean sell). Dim vs. the price so it reads as a
  // reference line, not a live number.
  { id: "avg_52wk", label: "52wk Avg", align: "right", render: (r) => <span style={{ color: "var(--text-muted)" }}>{usd(r.avg_52wk)}</span> },
  // Median daily close over the past year — the middle price, unmoved by outlier
  // spikes (often the truer "typical" level for a choppy name). Same dim reference
  // treatment as the average.
  { id: "median_52wk", label: "52wk Med", align: "right", render: (r) => <span style={{ color: "var(--text-muted)" }}>{usd(r.median_52wk)}</span> },
  { id: "pct_of_high", label: "% of 52wk High", align: "right", render: (r) => pct(r.pct_of_high) },
  { id: "lilo_pct", label: "LILO %", align: "right", watchNA: true, render: (r) => <Colored v={pct(r.lilo_pct)} n={r.lilo_pct} /> },
  { id: "last_pos_cost", label: "Last Pos Cost", align: "right", watchNA: true, render: (r) => usd(r.last_pos_cost) },
  { id: "invested", label: "Invested", align: "right", watchNA: true, render: (r) => usd(r.invested) },
  { id: "year_profit", label: "Profit (YTD)", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.year_profit)} n={r.year_profit} /> },
  { id: "avg_monthly", label: "Avg Monthly", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.avg_monthly)} n={r.avg_monthly} /> },
  { id: "year_trades", label: "Trades (YTD)", align: "right", watchNA: true, render: (r) => num(r.year_trades) },
  { id: "portfolio_pct", label: "Portfolio %", align: "right", watchNA: true, render: (r) => <PortfolioPct r={r} /> },
  { id: "sector", label: "Sector", align: "left", render: (r) => r.sector ? <span style={{ color: "var(--text-muted)" }}>{r.sector}</span> : <Dash /> },
  // additional available columns (not in the default layout)
  { id: "positions", label: "Positions", align: "right", watchNA: true, render: (r) => num(r.positions) },
  { id: "shares", label: "Shares", align: "right", watchNA: true, render: (r) => num(r.shares) },
  { id: "current_value", label: "Market Value", align: "right", watchNA: true, render: (r) => usd(r.current_value) },
  { id: "unrealized", label: "Unrealized P/L", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.unrealized)} n={r.unrealized} /> },
  { id: "day_change", label: "Day P/L", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.day_change)} n={r.day_change} /> },
  { id: "basis_per_share", label: "Basis / Share", align: "right", watchNA: true, render: (r) => usd(r.basis_per_share) },
  { id: "log_profit", label: "Profit (all-time)", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.log_profit)} n={r.log_profit} /> },
  { id: "dividends", label: "Dividends", align: "right", watchNA: true, render: (r) => (r.dividends ? <span style={{ color: "var(--pos)" }}>{usd(r.dividends)}</span> : <Dash />) },
  { id: "total_return", label: "Total Return", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.total_return)} n={r.total_return} /> },
  { id: "trades", label: "Trades (all-time)", align: "right", watchNA: true, render: (r) => num(r.trades) },
  { id: "next_buy_price", label: "Next Buy Trigger", align: "right", watchNA: true, render: (r) => usd(r.next_buy_price) },
  { id: "year_high", label: "52wk High", align: "right", render: (r) => usd(r.year_high) },
  { id: "year_low", label: "52wk Low", align: "right", render: (r) => usd(r.year_low) },
];
export const DASH_COLUMNS: Record<string, DashCol> = Object.fromEntries(
  DASH_COLUMN_LIST.map((c) => [c.id, c]),
);
// Mandatory columns pinned right after the ticker — the two most ACTIONABLE
// numbers (current price + profit on the last position). Not user-removable and
// not in the customizable registry, so they can't be hidden or duplicated.
export const PINNED_DASH: DashCol[] = [
  { id: "price", label: "Price", align: "left", render: (r) => <b>{usd(r.price)}</b> },
  { id: "last_pos_profit", label: "Last Pos P/L", align: "left", watchNA: true, render: (r) => <b><Colored v={usd(r.last_pos_profit)} n={r.last_pos_profit} /></b> },
];
// Default customizable layout (ticker + PINNED_DASH render before these).
export const DEFAULT_DASH_COLS = [
  "avg_52wk", "median_52wk", "pct_of_high", "lilo_pct", "last_pos_cost",
  "invested", "year_profit", "avg_monthly", "year_trades", "portfolio_pct",
];

// ---- ticker drill-down columns (operate on a lot) ----
export const DETAIL_COLUMN_LIST: DetailCol[] = [
  { id: "buy_date", label: "Buy Date", align: "left", render: (l) => l.buy_date ?? "—" },
  { id: "age_days", label: "Age", align: "right", render: (l) => (l.age_days == null ? "—" : `${l.age_days}d`) },
  { id: "shares", label: "Shares", align: "right", render: (l) => num(l.shares) },
  { id: "buy_price", label: "Buy", align: "right", render: (l) => usd(l.buy_price) },
  { id: "amount", label: "Amount", align: "right", render: (l) => usd(l.amount) },
  { id: "pct_down_from_prev", label: "% Down", align: "right", render: (l) => pct(l.pct_down_from_prev) },
  { id: "sell_target", label: "Sell Target", align: "right", render: (l) => usd(l.sell_target) },
  { id: "sell_mode", label: "Sell Mode", align: "left", render: (l) => l.sell_mode },
  { id: "proj_profit", label: "Proj. Profit", align: "right", render: (l) => <Colored v={usd(l.proj_profit)} n={l.proj_profit} /> },
  { id: "pl_now", label: "P/L Now", align: "right", render: (l) => <Colored v={usd(l.pl_now)} n={l.pl_now} /> },
  { id: "next_buy_sug", label: "Next Buy Sug", align: "right", render: (l) => <span style={{ color: "var(--accent-quiet)" }}>{usd(l.next_buy_sug)}</span> },
];
export const DETAIL_COLUMNS: Record<string, DetailCol> = Object.fromEntries(
  DETAIL_COLUMN_LIST.map((c) => [c.id, c]),
);
// Default drill-down layout (rung is pinned first, the Sell action is pinned last).
export const DEFAULT_DETAIL_COLS = [
  "buy_date", "age_days", "shares", "buy_price", "amount", "pct_down_from_prev",
  "sell_target", "proj_profit", "pl_now", "next_buy_sug",
];

// Keep only known column ids, de-duped (order preserved). An explicitly-empty array is
// honored (user removed all columns); null = no/corrupt save → caller falls back to defaults.
export function sanitizeColumnIds(arr: unknown, valid: Set<string> | string[]): string[] | null {
  const validSet = valid instanceof Set ? valid : new Set(valid);
  if (!Array.isArray(arr)) return null;
  const seen = new Set<string>();
  const kept = arr.filter(
    (id): id is string => typeof id === "string" && validSet.has(id) && !seen.has(id) && (seen.add(id), true),
  );
  return kept.length || arr.length === 0 ? kept : null;
}

// ---- the persisted-layout hook ----
export type ColumnPrefs = {
  ids: string[];
  add: (id: string) => void;
  remove: (id: string) => void;
  move: (id: string, dir: -1 | 1) => void;
  reorder: (id: string, toIndex: number) => void;
  reset: () => void;
  available: { id: string; label: string }[];
};

export function useColumnPrefs(
  storageKey: string,
  defaultIds: string[],
  registryList: { id: string; label: string }[],
): ColumnPrefs {
  const valid = new Set(registryList.map((c) => c.id));
  const sanitize = (arr: unknown): string[] | null => sanitizeColumnIds(arr, valid);

  const [ids, setIds] = useState<string[]>(() => {
    try {
      const local = sanitize(JSON.parse(localStorage.getItem(storageKey) || "null"));
      if (local) return local;
    } catch {
      /* ignore corrupt prefs */
    }
    return defaultIds;
  });
  const idsRef = useRef(ids);
  idsRef.current = ids;          // always-current snapshot for the mutators
  const dirty = useRef(false);   // has the user edited this session?

  const persist = (next: string[]) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* storage full / disabled */
    }
    fetch(`${API}/prefs/${storageKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: next }),
    }).catch(() => {});
  };

  // Every user edit persists immediately (no save-effect race) and flips `dirty`.
  const update = (fn: (prev: string[]) => string[]) => {
    const next = fn(idsRef.current);
    dirty.current = true;
    idsRef.current = next;
    setIds(next);
    persist(next);
  };

  // The DB is the source of truth across sessions/browsers (localStorage gave the
  // instant first paint). Adopt the DB layout ONLY if the user hasn't already
  // edited this session — otherwise an in-flight load would clobber a fresh edit.
  useEffect(() => {
    let alive = true;
    fetch(`${API}/prefs/${storageKey}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive || dirty.current) return;
        const remote = sanitize(d?.value);
        if (remote) {
          idsRef.current = remote;
          setIds(remote);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [storageKey]);

  const add = (id: string) => update((p) => (p.includes(id) || !valid.has(id) ? p : [...p, id]));
  const remove = (id: string) => update((p) => p.filter((x) => x !== id));
  const move = (id: string, dir: -1 | 1) =>
    update((p) => {
      const i = p.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const reorder = (id: string, toIndex: number) =>
    update((p) => {
      const from = p.indexOf(id);
      if (from < 0) return p;
      const next = [...p];
      next.splice(from, 1);
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, id);
      return next;
    });
  const reset = () => update(() => defaultIds);
  const order = new Map(registryList.map((c, i) => [c.id, i]));
  const available = registryList
    .filter((c) => !ids.includes(c.id))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return { ids, add, remove, move, reorder, reset, available };
}
