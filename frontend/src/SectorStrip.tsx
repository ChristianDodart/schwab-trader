import type { DashboardRow } from "./types";
import { usd } from "./App";

// A compact stacked bar of portfolio exposure by sector, from the held positions'
// current market value. Read-only glance — "where is my money concentrated?" — that
// leans on the sector tags you maintain (Schwab doesn't supply them). Hidden when
// there's nothing to show.
const PALETTE = ["#4a90e2", "#5dcaa5", "#c9a227", "#b57edc", "#e08a5b", "#5bb0c9", "#d1655b", "#8a92a6"];
const MAX_SEGMENTS = 7; // beyond this, the tail collapses into "Other"

export function SectorStrip({ rows }: { rows: DashboardRow[] }) {
  const held = (rows || []).filter((r) => !r.is_watch && (r.current_value ?? 0) > 0);
  if (held.length < 2) return null; // nothing meaningful to break down

  const bySector = new Map<string, number>();
  for (const r of held) {
    const key = r.sector?.trim() || "Untagged";
    bySector.set(key, (bySector.get(key) ?? 0) + (r.current_value ?? 0));
  }
  const total = [...bySector.values()].reduce((a, b) => a + b, 0);
  if (total <= 0 || bySector.size < 2) return null;

  const sorted = [...bySector.entries()].sort((a, b) => b[1] - a[1]);
  const head = sorted.slice(0, MAX_SEGMENTS);
  const tail = sorted.slice(MAX_SEGMENTS);
  const segments = [...head];
  if (tail.length) segments.push(["Other", tail.reduce((a, [, v]) => a + v, 0)]);

  const color = (i: number) => (segments[i][0] === "Untagged" || segments[i][0] === "Other"
    ? "var(--text-faint)" : PALETTE[i % PALETTE.length]);

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <span style={S.title}>Sector exposure</span>
        <span style={S.total}>{usd(total)} invested</span>
      </div>
      <div style={S.bar} role="img" aria-label="Sector allocation bar">
        {segments.map(([name, val], i) => (
          <div key={name} title={`${name}: ${usd(val)} (${((val / total) * 100).toFixed(0)}%)`}
            style={{ width: `${(val / total) * 100}%`, background: color(i), height: "100%" }} />
        ))}
      </div>
      <div style={S.legend}>
        {segments.map(([name, val], i) => (
          <span key={name} style={S.chip}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: color(i), flexShrink: 0 }} />
            {name} <span style={{ color: "var(--text-faint)" }}>{((val / total) * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { margin: "0 0 14px", padding: "10px 14px", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)" },
  head: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  title: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)" },
  total: { fontSize: "var(--fs-xs)", color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" },
  bar: { display: "flex", height: 10, borderRadius: "var(--r-sm)", overflow: "hidden", gap: 1, background: "var(--border-hairline)" },
  legend: { display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8 },
  chip: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--fs-xs)", color: "var(--text-muted)" },
};
