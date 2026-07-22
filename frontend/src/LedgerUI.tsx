// Shared presentational bits for the two ledger sub-tabs (Historic / Predictive).
// Kept dependency-light (only App's formatters) so both tabs — and the shell —
// can import from here without a cycle.
import { useEffect, useRef, useState } from "react";
import { usd } from "./format";
import { API } from "./api";
import { Tip } from "./Tip";
import { Term } from "./GlossaryUI";

// The selected account + active profile, resolved for print headers so a saved/
// printed page identifies WHOSE account it is. Fetched once; degrades to a plain
// label when Schwab isn't connected. Renders as a line inside a `.print-only` block.
export function AccountStamp() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`${API}/accounts`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/profiles`).then((r) => r.json()).catch(() => null),
    ]).then(([acc, prof]) => {
      if (!alive) return;
      const sel = acc?.accounts?.find((a: { hash: string }) => a.hash === acc.selected_hash);
      const active = Array.isArray(prof?.profiles) ? prof.profiles.find((p: { active: boolean }) => p.active) : null;
      const parts = [
        sel ? `Account ${sel.mask}${sel.type ? ` · ${sel.type}` : ""}` : null,
        active?.name ? `Profile: ${active.name}` : null,
      ].filter(Boolean);
      setLabel(parts.length ? parts.join("  ·  ") : null);
    });
    return () => { alive = false; };
  }, []);
  if (!label) return null;
  return <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 600 }}>{label}</p>;
}

// ---- sub-tab segmented control (Historic | Predictive) ----
export type SubTab = { id: string; label: string; hint?: string };

export function SubTabs({ value, onChange, tabs }: {
  value: string; onChange: (id: string) => void; tabs: SubTab[];
}) {
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].id);
    btns.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Ledger view" style={S.segWrap}>
      {tabs.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { btns.current[i] = el; }}
            id={`${t.id}-tab`}
            role="tab"
            aria-selected={active}
            aria-controls={`${t.id}-panel`}
            tabIndex={active ? 0 : -1}
            title={t.hint}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            style={{ ...S.seg, ...(active ? S.segActive : null) }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- period selector (drives the Historic tab's time scope) ----
export type Period = { from: string | null; to: string | null; label: string };
export const ALL_TIME: Period = { from: null, to: null, label: "All time" };

const pad = (n: number) => String(n).padStart(2, "0");
const lastDayOfMonth = (y: number, m1: number) => new Date(y, m1, 0).getDate(); // m1 = 1-based month

export function PeriodSelector({ value, onChange, year }: {
  value: Period; onChange: (p: Period) => void; year: number;
}) {
  // Local UI mode; the actual scope is lifted to the parent via onChange.
  const [mode, setMode] = useState<"all" | "ytd" | "month" | "year">("all");
  const years: number[] = [];
  for (let y = year; y >= year - 3; y--) years.push(y);

  const setYtd = () => onChange({ from: `${year}-01-01`, to: `${year}-12-31`, label: `${year}` });
  const setYear = (y: number) => onChange({ from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}` });
  const setMonth = (ym: string) => {
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    const [y, m] = ym.split("-").map(Number);
    onChange({ from: `${ym}-01`, to: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`, label: ym });
  };

  return (
    <div style={S.periodWrap}>
      <label style={S.periodLabel}>Period</label>
      <select
        className="field"
        value={mode}
        onChange={(e) => {
          const m = e.target.value as typeof mode;
          setMode(m);
          if (m === "all") onChange(ALL_TIME);
          else if (m === "ytd") setYtd();
          else if (m === "year") setYear(year);
          // "month" waits for the month input
        }}
        style={{ height: 30 }}
      >
        <option value="all">All time</option>
        <option value="ytd">This year ({year})</option>
        <option value="year">Pick a year…</option>
        <option value="month">Pick a month…</option>
      </select>
      {mode === "year" && (
        <select className="field" style={{ height: 30 }} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      )}
      {mode === "month" && (
        <input
          type="month"
          className="field"
          style={{ height: 30 }}
          max={`${year}-${pad(new Date().getMonth() + 1)}`}
          onChange={(e) => setMonth(e.target.value)}
        />
      )}
      <span style={S.periodShow}>{value.label}</span>
    </div>
  );
}

// ---- cards / rows / panels ----
export function Card({ label, value, sub, big, accent, hint, term }: {
  label: string; value: string; sub?: string; big?: boolean; accent?: string; hint?: string;
  term?: string;   // glossary id — the label becomes a hover-to-define Term (preferred over `hint`)
}) {
  // A glossary term defines the figure (and its provenance) on hover; falls back to a
  // plain sort/info Tip when there's no term, or bare text when there's neither.
  const inner = term ? <Term id={term}>{label}</Term> : label;
  return (
    <div className="panel" style={S.card}>
      <div style={S.cardLabel}>{!term && hint ? <Tip text={hint}>{inner}</Tip> : inner}</div>
      <div style={{ ...S.cardValue, fontSize: big ? "var(--fs-2xl)" : "var(--fs-xl)", color: accent ?? "var(--text)" }}>{value}</div>
      {sub && <div style={S.cardSub}>{sub}</div>}
    </div>
  );
}

export function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="panel" style={S.panel}>
      <div style={S.panelHead}>
        <h3 className="section-title" style={{ margin: 0 }}>{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Row({ k, v, hi, dim, accent, sub, term }: {
  k: string; v: string; hi?: boolean; dim?: boolean; accent?: string; sub?: string;
  term?: string;   // glossary id — the key becomes a hover-to-define Term
}) {
  return (
    <div style={S.row}>
      <span style={{ color: dim ? "var(--text-faint)" : "var(--text-muted)" }}>
        {term ? <Term id={term}>{k}</Term> : k}{sub && <span style={S.rowSub}> · {sub}</span>}
      </span>
      <span style={{ fontWeight: hi ? 700 : 500, color: accent ?? (hi ? "var(--pos)" : dim ? "var(--text-dim)" : "var(--text)"), fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
}

// A muted signed money value with an explicit +/- (gain/loss reads without color).
export function money(n: number | null | undefined): string {
  return usd(n);
}

export const moneyColor = (n: number | null | undefined) =>
  n == null ? "var(--text)" : n > 0 ? "var(--pos)" : n < 0 ? "var(--neg)" : "var(--text)";

export const S: Record<string, React.CSSProperties> = {
  segWrap: { display: "inline-flex", gap: 2, padding: 3, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", margin: "10px 0 4px" },
  seg: { border: "none", background: "transparent", color: "var(--text-muted)", padding: "6px 16px", borderRadius: "var(--r-sm)", cursor: "pointer", fontSize: "var(--fs-sm)", fontWeight: 600 },
  segActive: { background: "var(--pop)", color: "var(--text)", boxShadow: "var(--elev-1)" },
  periodWrap: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  periodLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)" },
  periodShow: { fontSize: "var(--fs-sm)", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 14 },
  card: { padding: "14px 16px" },
  cardLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)" },
  cardValue: { fontWeight: 700, marginTop: 4, fontVariantNumeric: "tabular-nums" },
  cardSub: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", marginTop: 4 },
  q: { color: "var(--text-faint)", cursor: "help", fontSize: "0.85em" },
  twoCol: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginTop: 14 },
  panel: { padding: 18, marginTop: 14 },
  panelHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" },
  row: { display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontSize: "var(--fs-md)", borderBottom: "1px solid var(--border-hairline)" },
  rowSub: { fontSize: "var(--fs-xs)", color: "var(--text-faint)" },
  fine: { fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginTop: 10, lineHeight: 1.5 },
  note: { color: "var(--text-faint)", fontSize: "var(--fs-xs)", marginTop: 16, lineHeight: 1.5 },
  warn: { fontSize: "var(--fs-xs)", color: "var(--warn)", marginTop: 10, lineHeight: 1.5, border: "1px solid var(--warn-border)", borderRadius: "var(--r-sm)", padding: "7px 10px", background: "color-mix(in srgb, var(--warn) 8%, transparent)" },
};
