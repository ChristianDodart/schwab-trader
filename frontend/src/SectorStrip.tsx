import { useEffect, useState } from "react";
import type { DashboardRow } from "./types";
import { usd } from "./format";
import { IconWarning } from "./Icon";

// Concentration alert threshold (% of invested in a single sector). Persisted locally;
// advisory only — it never blocks anything, just flags an over-weighted sector.
const LS_THRESH = "sector.alertPct.v1";
const LS_ALERTS_ON = "sector.alertsOn.v1"; // opt-in — mostly useful for larger accounts
const readThresh = () => {
  try { const n = Number(localStorage.getItem(LS_THRESH)); return n >= 5 && n <= 100 ? n : 40; }
  catch { return 40; }
};
const readAlertsOn = () => { try { return localStorage.getItem(LS_ALERTS_ON) === "1"; } catch { return false; } };

// A compact stacked bar of portfolio exposure by sector, from the held positions'
// current market value. Read-only glance — "where is my money concentrated?" — that
// leans on the sector tags you maintain (Schwab doesn't supply them). Hidden when
// there's nothing to show.
const PALETTE = ["#4a90e2", "#5dcaa5", "#c9a227", "#b57edc", "#e08a5b", "#5bb0c9", "#d1655b", "#8a92a6"];
const MAX_SEGMENTS = 7; // beyond this, the tail collapses into "Other"

export function SectorStrip({ rows, activeSector, onSectorClick }: {
  rows: DashboardRow[];
  activeSector?: string | null;
  onSectorClick?: (name: string) => void;
}) {
  const [thresh, setThresh] = useState(readThresh);
  const [alertsOn, setAlertsOn] = useState(readAlertsOn);
  useEffect(() => { try { localStorage.setItem(LS_THRESH, String(thresh)); } catch { /* private mode */ } }, [thresh]);
  useEffect(() => { try { localStorage.setItem(LS_ALERTS_ON, alertsOn ? "1" : "0"); } catch { /* private mode */ } }, [alertsOn]);
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

  // Concentration flag only when the user opts into alerts (mainly useful for large accounts).
  const topReal = sorted.find(([n]) => n !== "Untagged");
  const topPct = topReal ? (topReal[1] / total) * 100 : 0;
  const over = alertsOn && topReal && topPct >= thresh ? { name: topReal[0], pct: topPct } : null;

  return (
    <div style={S.wrap}>
      <div style={S.head}>
        <span style={S.title}>Sector exposure</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={alertsOn}
            title="Flag a sector that grows past a threshold (handy for larger accounts)"
            onClick={() => setAlertsOn((v) => !v)}
            style={{ fontSize: "var(--fs-2xs)", padding: "1px 8px", color: alertsOn ? "var(--accent)" : "var(--text-dim)" }}>
            {alertsOn ? "Alerts on" : "Alerts off"}
          </button>
          {alertsOn && (
            <label style={S.threshCtl} title="Flag a sector above this share of invested value">
              alert &gt;
              <input type="number" min={5} max={100} step={5} value={thresh} aria-label="Concentration alert threshold %"
                onChange={(e) => setThresh(Math.max(5, Math.min(100, Number(e.target.value) || 40)))}
                style={S.threshInput} />%
            </label>
          )}
          <span style={S.total}>{usd(total)} invested</span>
        </span>
      </div>
      <div style={S.bar} role="img" aria-label="Sector allocation bar">
        {segments.map(([name, val], i) => (
          <div key={name} title={`${name}: ${usd(val)} (${((val / total) * 100).toFixed(0)}%)`}
            style={{ width: `${(val / total) * 100}%`, background: color(i), height: "100%",
              outline: over && name === over.name ? "2px solid var(--warn)" : undefined, outlineOffset: -2 }} />
        ))}
      </div>
      <div style={S.legend}>
        {segments.map(([name, val], i) => {
          const clickable = !!onSectorClick && name !== "Other";
          const active = activeSector === name;
          return (
            <button key={name} type="button" disabled={!clickable}
              onClick={() => clickable && onSectorClick!(name)}
              title={clickable ? `Filter the table to ${name}` : undefined}
              style={{ ...S.chip, ...(clickable ? S.chipClickable : null), ...(active ? S.chipActive : null),
                ...(over && name === over.name ? { color: "var(--warn)", fontWeight: 600 } : null) }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: color(i), flexShrink: 0 }} />
              {name} <span style={{ color: "var(--text-faint)" }}>{((val / total) * 100).toFixed(0)}%</span>
            </button>
          );
        })}
      </div>
      {over && (
        <p style={S.warn}>
          <IconWarning /> Concentrated: {over.name} is {over.pct.toFixed(0)}% of invested value (alert set at {thresh}%). Advisory only.
        </p>
      )}
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
  chip: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--fs-xs)", color: "var(--text-muted)", background: "transparent", border: "1px solid transparent", borderRadius: "var(--r-pill)", padding: "1px 6px" },
  chipClickable: { cursor: "pointer" },
  chipActive: { borderColor: "var(--accent)", color: "var(--text)" },
  threshCtl: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--fs-xs)", color: "var(--text-dim)" },
  threshInput: { width: 44, height: 22, textAlign: "right", padding: "1px 4px", fontSize: "var(--fs-xs)" },
  warn: { fontSize: "var(--fs-xs)", color: "var(--warn)", margin: "8px 0 0", lineHeight: 1.4 },
};
