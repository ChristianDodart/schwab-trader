import { useEffect, useRef, useState } from "react";
import { usd } from "./App";
import type { Dashboard } from "./types";

// Customizable header KPIs (W28-5). The top-right cluster is a set of selectable
// metric boxes drawn from the dashboard payload + the cash summary. Which ones show
// is a per-browser preference (localStorage); the default mirrors the old fixed
// cluster plus a dollar day-change like Schwab's.

export type KpiCash =
  | { cash: number | null; buying_power: number | null; margin_buying_power: number | null }
  | null;

type Tone = "plain" | "signed" | "positive";
type KpiDef = {
  id: string;
  label: string;
  hint: string;
  tone: Tone;
  // Raw value, or null/undefined when unavailable → the box is hidden even if selected
  // (e.g. day change before every holding is priced, or cash before the summary loads).
  num: (d: Dashboard, cash: KpiCash) => number | null | undefined;
};

// Canonical display order — selection is a membership set, boxes always render in this order.
export const KPI_CATALOG: KpiDef[] = [
  { id: "invested", label: "Invested", tone: "plain",
    hint: "Cost basis of every open position (what you paid, excludes cash).",
    num: (d) => d.total_invested },
  { id: "day_change", label: "Day change", tone: "signed",
    hint: "Today's profit or loss on the shares you hold — the sum of each position's day change. Blank until every holding has a live quote.",
    num: (d) => d.total_day_change },
  { id: "harvestable", label: "Harvestable", tone: "positive",
    hint: "Profit you could lock in right now by selling every profitable last position — equals what the 'Sell profitable' bulk action would realize.",
    num: (d) => d.harvestable },
  { id: "market_value", label: "Market value", tone: "plain",
    hint: "Current market value of every open position.",
    num: (d) => d.total_value },
  { id: "unrealized", label: "Unrealized P/L", tone: "signed",
    hint: "Open positions' market value minus cost basis — the paper gain or loss across everything you hold.",
    num: (d) => d.total_unrealized },
  { id: "cash", label: "Cash", tone: "plain",
    hint: "Settled cash in the account.",
    num: (_d, cash) => cash?.cash },
  { id: "buying_power", label: "Buying power", tone: "plain",
    hint: "Cash plus available margin — what you can deploy right now. Fluctuates intraday.",
    num: (_d, cash) => cash?.buying_power },
];

export const DEFAULT_KPIS = ["invested", "day_change", "harvestable", "cash"];
const KEY = "dash_kpis_v1";

export type VisibleKpi = { id: string; label: string; hint: string; value: string; n?: number; color?: string };

export function useKpiPrefs() {
  const [ids, setIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) return p.filter((x) => KPI_CATALOG.some((k) => k.id === x));
      }
    } catch { /* ignore private-mode / bad JSON */ }
    return DEFAULT_KPIS;
  });
  const persist = (next: string[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setIds(next);
  };
  const toggle = (id: string) =>
    persist(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const reset = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } setIds(DEFAULT_KPIS); };
  return { ids, toggle, reset };
}

// Resolve the selected ids into renderable boxes (canonical order), dropping any whose
// value isn't available yet.
export function visibleKpis(ids: string[], d: Dashboard, cash: KpiCash): VisibleKpi[] {
  const out: VisibleKpi[] = [];
  for (const k of KPI_CATALOG) {
    if (!ids.includes(k.id)) continue;
    const n = k.num(d, cash);
    if (n == null) continue;
    out.push({
      id: k.id, label: k.label, hint: k.hint, value: usd(n),
      n: k.tone === "signed" ? n : undefined,
      color: k.tone === "positive" && n > 0 ? "var(--pos)" : undefined,
    });
  }
  return out;
}

// Gear button + popover of checkboxes to choose which KPI boxes show.
export function KpiPicker({ ids, toggle, reset }: {
  ids: string[]; toggle: (id: string) => void; reset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => { setOpen(false); btnRef.current?.focus(); };

  return (
    <div ref={wrapRef} style={S.wrap}>
      <button ref={btnRef} className="btn btn-ghost btn-sm" style={S.gear}
        aria-label="Choose dashboard metrics" aria-expanded={open}
        title="Choose which metrics show here" onClick={() => setOpen((o) => !o)}>
        ⚙
      </button>
      {open && (
        <div style={S.pop} role="dialog" aria-label="Dashboard metrics"
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
          <div style={S.popHead}>Show metrics</div>
          {KPI_CATALOG.map((k) => (
            <label key={k.id} style={S.row} title={k.hint}>
              <input type="checkbox" checked={ids.includes(k.id)} onChange={() => toggle(k.id)} />
              <span>{k.label}</span>
            </label>
          ))}
          <button className="btn btn-ghost btn-sm" style={S.reset} onClick={reset}>Reset to default</button>
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: "relative", display: "flex", alignItems: "center", paddingLeft: 4, paddingRight: 4 },
  gear: { fontSize: "var(--fs-sm)", padding: "0 4px", color: "var(--text-dim)" },
  pop: { position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, minWidth: 190,
    background: "var(--pop, var(--panel))", border: "1px solid var(--border-strong)", borderRadius: "var(--r-md)",
    padding: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", display: "flex", flexDirection: "column", gap: 2 },
  popHead: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em",
    color: "var(--text-faint)", padding: "2px 6px 4px" },
  row: { display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: "var(--r-sm)",
    fontSize: "var(--fs-sm)", color: "var(--text)", cursor: "pointer" },
  reset: { marginTop: 4, alignSelf: "flex-start", color: "var(--text-dim)" },
};
