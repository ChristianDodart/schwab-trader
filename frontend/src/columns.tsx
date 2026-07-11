import { useEffect, useRef, useState } from "react";
import { usd, pct } from "./App";
import type { DashboardRow, Lot } from "./types";
import { matchesRule, type SignalRule } from "./signals";

import { API } from "./api";
import { IconWarning } from "./Icon";

// ============================================================================
// Customizable columns. Each view (dashboard, ticker drill-down) has its own
// registry of available columns and its own saved layout (order + which are
// shown). The "available" list is sourced straight from these registries — i.e.
// the values we actually have. Layouts persist in localStorage.
// ============================================================================

export type ColAlign = "left" | "right";

// Provenance: "schwab" = a raw number straight from Schwab's API (price, day P/L, held
// shares, 52wk hi/lo); "text" = a non-numeric/config field (sector, dates, mode).
// Undefined = APP-CALCULATED — we derived it, even if from Schwab inputs. Computed
// columns get a dotted-underline header + tooltip so it's clear what's ours vs Schwab's.
export type Provenance = "schwab" | "text";
export type DashCol = {
  id: string;
  label: string;
  align: ColAlign;
  prov?: Provenance;
  watchNA?: boolean;                       // render "—" on watch rows (no position)
  render: (r: DashboardRow) => React.ReactNode;
};
export type DetailCol = {
  id: string;
  label: string;
  align: ColAlign;
  prov?: Provenance;
  render: (l: Lot) => React.ReactNode;
};

// The "calculated" mark: a small superscript ƒ placed after the LABEL/HEADER of an
// app-computed figure (never on the value itself, so it can't clash with gain/loss
// color). Schwab-provided figures carry no mark. One primitive shared by every table
// header and stat card so provenance reads the same everywhere.
export function CalcMark() {
  // Just the glyph. What ƒ means is explained once by <ProvenanceLegend>, never on
  // hover — a hover shows only the specific figure's meaning, not the provenance.
  return (
    <sup style={{ color: "var(--accent-quiet)", fontSize: "0.66em", fontWeight: 700, marginLeft: 2 }}>ƒ</sup>
  );
}
// Renders a label followed by the ƒ mark when `computed`. Convenience for stat cards.
export function Labeled({ label, computed }: { label: string; computed?: boolean }) {
  return <>{label}{computed && <CalcMark />}</>;
}

// One-line legend for the provenance mark — the single place ƒ is explained.
export function ProvenanceLegend() {
  return (
    <p style={{ fontSize: "var(--fs-2xs)", color: "var(--text-dim)", margin: "6px 0 0" }}>
      <span style={{ color: "var(--accent-quiet)", fontWeight: 700 }}>ƒ</span> (a formula) marks a figure the
      app calculates from your fills and/or Schwab data; everything else comes straight from Schwab.
    </p>
  );
}

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
  n == null ? "" : n.toLocaleString("en-US");
// Empty values render empty (no "—" placeholder).
const Dash = () => null;
// Null-safe money/percent for dashboard cells: empty instead of the global "—".
const usd0 = (n: number | null | undefined) => (n == null ? null : usd(n));
const pct0 = (n: number | null | undefined) => (n == null ? null : pct(n));

// RULE 10 from the sheet: keep every stock under 5% of the portfolio. Flag any
// held position at/over this so over-concentration is visible at a glance.
export const CONCENTRATION_CAP = 0.05;
const PortfolioPct = ({ r }: { r: DashboardRow }) => {
  if (r.portfolio_pct == null) return <Dash />;
  const over = r.portfolio_pct >= CONCENTRATION_CAP;
  return (
    <span style={over ? { color: "var(--warn)", fontWeight: 600 } : undefined}
      title={over ? `Over the ${(CONCENTRATION_CAP * 100).toFixed(0)}% single-stock cap` : undefined}>
      {pct(r.portfolio_pct)}{over ? <> <IconWarning size={12} /></> : ""}
    </span>
  );
};
// BUY/SELL signal chip — the ▲/▼ glyph keeps it separable in grayscale.
const Chip = ({ children, kind }: { children: React.ReactNode; kind: "buy" | "sell" }) => (
  <span className={`chip chip-${kind}`} style={{ marginLeft: 4 }}>
    <span aria-hidden="true">{kind === "buy" ? "▲" : "▼"}</span>{children}
  </span>
);

// Ticker color by risk band (blue = safer → red = riskier). Neutral (undefined) for
// medium/unknown so the symbol reads normally. Shared by the dashboard, detail, screener.
export function tickerRiskColor(risk: string | null | undefined): string | undefined {
  switch (risk) {
    case "low": return "var(--accent-quiet)"; // muted blue — safer (broad ETF / large cap)
    case "elevated": return "var(--warn)";     // amber — small cap
    case "high": return "var(--neg)";          // red — leveraged/inverse or micro cap
    default: return undefined;                  // medium/unknown → normal text
  }
}
export const RISK_LABEL: Record<string, string> = {
  low: "Lower risk (broad fund / large cap)", medium: "Mid cap / unclassified",
  elevated: "Small cap — higher risk", high: "Leveraged/inverse or micro cap — highest risk",
};

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
  // The two most ACTIONABLE numbers — current price + profit on the last position.
  // Now ordinary registry columns (movable/foldable); only Ticker is mandatory. They
  // lead the default layout, so the resting table looks exactly as before.
  { id: "price", label: "Price", align: "left", prov: "schwab", render: (r) => (
      r.is_watch && r.last_held != null
        ? <span style={{ whiteSpace: "nowrap" }}><b>{usd0(r.price)}</b>
            <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-2xs)", marginLeft: 6 }}
              title="The price you last sold this at — watching for a re-entry below it">sold {usd(r.last_held)}</span>
          </span>
        : <b>{usd0(r.price)}</b>
    ) },
  { id: "last_pos_profit", label: "Last Pos P/L", align: "left", watchNA: true, render: (r) => <b><Colored v={usd(r.last_pos_profit)} n={r.last_pos_profit} /></b> },
  // Mean of the daily closes over the past year — "where the stock spends most of
  // its time." Compare against the pinned Price: below = historical discount
  // (lean buy), above = rich (lean sell). Dim vs. the price so it reads as a
  // reference line, not a live number.
  { id: "avg_52wk", label: "52wk Avg", align: "right", render: (r) => <span style={{ color: "var(--text-muted)" }}>{usd0(r.avg_52wk)}</span> },
  // Median daily close over the past year — the middle price, unmoved by outlier
  // spikes (often the truer "typical" level for a choppy name). Same dim reference
  // treatment as the average.
  { id: "median_52wk", label: "52wk Med", align: "right", render: (r) => <span style={{ color: "var(--text-muted)" }}>{usd0(r.median_52wk)}</span> },
  { id: "pct_of_high", label: "% of 52wk High", align: "right", render: (r) => pct0(r.pct_of_high) },
  { id: "lilo_pct", label: "LILO %", align: "right", watchNA: true, render: (r) => <Colored v={pct(r.lilo_pct)} n={r.lilo_pct} /> },
  { id: "last_pos_cost", label: "Last Pos Cost", align: "right", watchNA: true, render: (r) => usd(r.last_pos_cost) },
  { id: "invested", label: "Invested", align: "right", watchNA: true, render: (r) => usd(r.invested) },
  { id: "year_profit", label: "Profit (YTD)", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.year_profit)} n={r.year_profit} /> },
  { id: "avg_monthly", label: "Avg Monthly", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.avg_monthly)} n={r.avg_monthly} /> },
  { id: "year_trades", label: "Trades (YTD)", align: "right", watchNA: true, render: (r) => num(r.year_trades) },
  { id: "portfolio_pct", label: "Portfolio %", align: "right", watchNA: true, render: (r) => <PortfolioPct r={r} /> },
  { id: "sector", label: "Sector", align: "left", prov: "text", render: (r) => r.sector ? <span style={{ color: "var(--text-muted)" }}>{r.sector}</span> : <Dash /> },
  // additional available columns (not in the default layout)
  { id: "positions", label: "Positions", align: "right", watchNA: true, render: (r) => num(r.positions) },
  { id: "shares", label: "Shares", align: "right", prov: "schwab", watchNA: true, render: (r) => num(r.shares) },
  { id: "current_value", label: "Market Value", align: "right", watchNA: true, render: (r) => usd(r.current_value) },
  { id: "unrealized", label: "Unrealized P/L", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.unrealized)} n={r.unrealized} /> },
  { id: "day_change", label: "Day P/L", align: "right", prov: "schwab", watchNA: true, render: (r) => <Colored v={usd(r.day_change)} n={r.day_change} /> },
  { id: "basis_per_share", label: "Basis / Share", align: "right", watchNA: true, render: (r) => usd(r.basis_per_share) },
  { id: "log_profit", label: "Profit (all-time)", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.log_profit)} n={r.log_profit} /> },
  { id: "dividends", label: "Dividends", align: "right", watchNA: true, render: (r) => (r.dividends ? <span style={{ color: "var(--pos)" }}>{usd(r.dividends)}</span> : <Dash />) },
  { id: "total_return", label: "Total Return", align: "right", watchNA: true, render: (r) => <Colored v={usd(r.total_return)} n={r.total_return} /> },
  { id: "trades", label: "Trades (all-time)", align: "right", watchNA: true, render: (r) => num(r.trades) },
  { id: "next_buy_price", label: "Next Buy Trigger", align: "right", watchNA: true, render: (r) => usd(r.next_buy_price) },
  { id: "year_high", label: "52wk High", align: "right", prov: "schwab", render: (r) => usd0(r.year_high) },
  { id: "year_low", label: "52wk Low", align: "right", prov: "schwab", render: (r) => usd0(r.year_low) },
];
export const DASH_COLUMNS: Record<string, DashCol> = Object.fromEntries(
  DASH_COLUMN_LIST.map((c) => [c.id, c]),
);
// The only mandatory column is Ticker (rendered by the table itself, not in this
// registry). Every column below — including Price and Last Pos P/L — is movable,
// removable, and foldable.
//
// Default layout (order + which columns show). Ticker renders first; these follow.
export const DEFAULT_DASH_COLS = [
  "price", "last_pos_profit", "lilo_pct", "pct_of_high",        // shown by default
  "current_value", "unrealized", "day_change", "invested",     // folded by default (below)
  "basis_per_share", "portfolio_pct", "avg_52wk", "median_52wk",
  "last_pos_cost", "year_profit", "avg_monthly", "year_trades",
];
// Which of the default columns start FOLDED (behind the chevron). Everything after the
// first four essentials. The user can change this per-column in the Columns manager.
export const DEFAULT_DASH_FOLDED = [
  "current_value", "unrealized", "day_change", "invested",
  "basis_per_share", "portfolio_pct", "avg_52wk", "median_52wk",
  "last_pos_cost", "year_profit", "avg_monthly", "year_trades",
];
// Simple view: holdings-only, a compact fixed set (no folding, no ƒ marks).
export const SIMPLE_DASH_COLS = ["price", "unrealized", "current_value"];

// ---- ticker drill-down columns (operate on a lot) ----
export const DETAIL_COLUMN_LIST: DetailCol[] = [
  { id: "buy_date", label: "Buy Date", align: "left", prov: "text", render: (l) => l.buy_date ?? "—" },
  { id: "age_days", label: "Age", align: "right", render: (l) => (l.age_days == null ? "—" : `${l.age_days}d`) },
  { id: "shares", label: "Shares", align: "right", render: (l) => num(l.shares) },
  { id: "buy_price", label: "Buy", align: "right", render: (l) => usd(l.buy_price) },
  { id: "amount", label: "Amount", align: "right", render: (l) => usd(l.amount) },
  { id: "pct_down_from_prev", label: "% Down", align: "right", render: (l) => {
      // "% Down" is the dip depth vs the previous rung. A rung bought at/above the prior
      // isn't a dip (e.g. averaging up, or an old cheap "prior" backfill lot below a
      // recent buy) — showing a huge negative "down" reads as broken, so show "—".
      const v = l.pct_down_from_prev;
      if (v == null || v <= 0)
        return <span title={v != null ? "Added at or above the previous position — not a dip down" : undefined}
          style={{ color: "var(--text-faint)" }}>—</span>;
      return pct(v);
    } },
  { id: "sell_target", label: "Sell Target", align: "right", render: (l) => usd(l.sell_target) },
  { id: "sell_mode", label: "Sell Mode", align: "left", prov: "text", render: (l) => l.sell_mode },
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
  migrate?: (ids: string[]) => string[], // one-time fixups to a loaded layout (e.g. adopt new registry columns)
): ColumnPrefs {
  const valid = new Set(registryList.map((c) => c.id));
  const load = (arr: unknown): string[] | null => {
    const s = sanitizeColumnIds(arr, valid);
    return s && migrate ? migrate(s) : s;
  };
  const sanitize = load;

  const [ids, setIds] = useState<string[]>(() => {
    try {
      const local = load(JSON.parse(localStorage.getItem(storageKey) || "null"));
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

// ---- fold membership: which columns hide behind the table's chevron ----
// A separate persisted set (localStorage + DB, same pattern as useColumnPrefs), so the
// column ORDER and its FOLD state are independent. Stale ids (a removed column) are
// harmless — the table only folds columns that are actually shown.
export type FoldPrefs = {
  folded: Set<string>;
  isFolded: (id: string) => boolean;
  toggle: (id: string) => void;
  reset: () => void;
};

export function useFoldPrefs(storageKey: string, defaultFolded: string[]): FoldPrefs {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
    } catch { /* ignore corrupt prefs */ }
    return defaultFolded;
  });
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const dirty = useRef(false);

  const persist = (next: string[]) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage disabled */ }
    fetch(`${API}/prefs/${storageKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: next }),
    }).catch(() => {});
  };
  const update = (fn: (prev: string[]) => string[]) => {
    const next = fn(idsRef.current);
    dirty.current = true; idsRef.current = next; setIds(next); persist(next);
  };

  useEffect(() => {
    let alive = true;
    fetch(`${API}/prefs/${storageKey}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive || dirty.current) return;
        if (Array.isArray(d?.value)) {
          const v = d.value.filter((x: unknown): x is string => typeof x === "string");
          idsRef.current = v; setIds(v);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [storageKey]);

  const folded = new Set(ids);
  return {
    folded,
    isFolded: (id) => folded.has(id),
    toggle: (id) => update((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
    reset: () => update(() => defaultFolded),
  };
}
