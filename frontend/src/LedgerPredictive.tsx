import { useCallback, useEffect, useState } from "react";
import { usd, pct } from "./App";
import { SkeletonCards, SkeletonPanel } from "./Skeleton";
import { useToast } from "./Toast";
import { Card, Panel, Row, S, moneyColor } from "./LedgerUI";
import type { LedgerProjection as Projection } from "./types";

import { API } from "./api";
import { IconEdit } from "./Icon";

export function LedgerPredictive() {
  const [p, setP] = useState<Projection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(() => {
    fetch(`${API}/ledger/projection`)
      .then((r) => r.json())
      .then((j) => (j && !j.error && j.tax ? (setP(j), setErr(null)) : setErr(j?.error || "Couldn't load projections.")))
      .catch(() => setErr("Couldn't load projections — network error."));
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveConfig = (patch: Record<string, number | null>) =>
    fetch(`${API}/config`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
      .then((r) => r.json())
      .then(() => { toast("Saved.", "success"); load(); })
      .catch(() => toast("Couldn't save.", "error"));

  if (err) return <p style={S.note}>{err}</p>;
  if (!p) return <div><SkeletonCards n={4} /><SkeletonPanel /></div>;

  const g = p.goal;
  const t = p.tax;

  return (
    <div>
      <p style={SP.projBanner}>
        Everything here is a <b>projection</b> — it assumes {p.year}'s realized pace so far
        (<b>{usd(p.gain_per_trading_day)}</b>/trading-day over {p.trading_days_elapsed} days) continues unchanged.
      </p>

      <div style={S.cards}>
        <Card label={`Projected ${p.year} gains`} value={usd(p.projected_annual_gain)} big accent={moneyColor(p.projected_annual_gain)}
          hint={`Realized YTD (${usd(p.realized_ytd)}) annualized over ${p.days_elapsed} days elapsed × 365.`} />
        <Card label="Realized so far (YTD)" value={usd(p.realized_ytd)} accent={moneyColor(p.realized_ytd)}
          hint="Actual closed-trade gains this calendar year — the fact this projection is built from." />
        <Card label="Est. taxes (full year)" value={usd(t.total_tax)}
          sub={`≈ ${pct(t.effective_rate)} effective`}
          hint="Progressive federal (short-term = ordinary income, stacked on your other income) + flat state, on the projected annual gain." />
        <Card label="Projected after-tax" value={usd(t.after_tax_gain)} accent={moneyColor(t.after_tax_gain)}
          hint="Projected annual gain minus the estimated tax on it." />
      </div>

      {/* ---- Year-end goal ---- */}
      <Panel title="Year-end goal">
        <Row
          k="Goal (realized gains this year)"
          v={g.target != null ? usd(g.target) : "—"}
          accent="var(--text)"
        />
        <EditRow label="Set goal" value={g.target} placeholder="e.g. 5000"
          onSave={(n) => saveConfig({ year_end_goal: n })} />
        {g.target != null ? (
          <>
            <div style={SP.progWrap}>
              <div style={SP.progTrack}>
                <div style={{ ...SP.progFill, width: `${Math.min(100, Math.max(0, (g.progress ?? 0) * 100))}%` }} />
              </div>
              <span style={SP.progPct}>{pct(g.progress)}</span>
            </div>
            <Row k="Remaining to goal" v={usd(g.remaining)} />
            <Row k="Needed per trading day" v={usd(g.required_per_trading_day)} hi
              accent={g.on_track == null ? "var(--text)" : g.on_track ? "var(--pos)" : "var(--warn)"}
              sub={`${g.trading_days_left} trading days left`} />
            <Row k="Your current pace / day" v={usd(p.gain_per_trading_day)} accent={moneyColor(p.gain_per_trading_day)} />
            <div style={{ marginTop: 8 }}>
              {g.on_track == null
                ? ((g.remaining ?? 0) <= 0
                    ? <span className="chip chip-buy"><span aria-hidden="true">▲</span> Goal met</span>
                    : <span style={SP.closedChip}>Year closed — goal not reached</span>)
                : g.on_track
                  ? <span className="chip chip-buy"><span aria-hidden="true">▲</span> On pace to beat the goal</span>
                  : <span className="chip chip-sell"><span aria-hidden="true">▼</span> Behind — pace must rise to hit the goal</span>}
            </div>
          </>
        ) : (
          <p style={S.fine}>Set a year-end realized-gains goal to see the daily pace you'd need for the rest of {p.year}.</p>
        )}
        <p style={S.fine}>
          "Needed per trading day" = remaining ÷ trading days left (weekdays; ~9 holidays/yr ignored). Compares against your
          actual gains/day so far.
        </p>
      </Panel>

      {/* ---- Tax estimate ---- */}
      <Panel title="Estimated taxes (progressive)">
        <Row k="Taxable basis — projected annual gain" v={usd(t.projected_annual_gain)} />
        <Row k="Federal (stacked on other income)" v={usd(t.federal_tax)} sub={t.filing} />
        <Row k="State" v={usd(t.state_tax)} sub={`${pct(t.state_rate)} flat`} />
        <Row k="Total estimated tax" v={usd(t.total_tax)} hi accent="var(--neg)" sub={`${pct(t.effective_rate)} effective`} />
        <EditRow label="Your other annual income (e.g. salary)" value={p.other_annual_income || null} placeholder="0"
          onSave={(n) => saveConfig({ other_annual_income: n })} allowZero />
        <p style={S.fine}>
          Day-trading profits are <b>short-term</b> gains, taxed as ordinary income. They stack on top of your other income,
          so the federal figure is the extra tax the gains add at your real marginal rate — <b>tax(income + gains) − tax(income)</b>.
          Filing status &amp; state rate come from Settings. This estimates full-year tax on the projected gain; it's not tax advice.
        </p>
      </Panel>
    </div>
  );
}

// Inline pencil-edit for a single money value. Blank clears (→ null) unless allowZero.
function EditRow({ label, value, placeholder, onSave, allowZero }: {
  label: string; value: number | null; placeholder?: string; onSave: (n: number | null) => void; allowZero?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [txt, setTxt] = useState("");
  const begin = () => { setTxt(value != null ? String(value) : ""); setEditing(true); };
  const commit = () => {
    const trimmed = txt.trim();
    if (trimmed === "") { onSave(null); setEditing(false); return; }  // clear
    const n = parseFloat(trimmed);
    if (!Number.isFinite(n) || (!allowZero && n <= 0)) { setEditing(false); return; }
    onSave(n); setEditing(false);
  };
  if (!editing) {
    return (
      <div style={SP.editRow}>
        <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>{label}</span>
        <button className="btn btn-ghost btn-sm" onClick={begin} aria-label={`Edit ${label}`}>
          {value != null ? <><IconEdit /> Edit</> : <><IconEdit /> Set</>}
        </button>
      </div>
    );
  }
  return (
    <div style={S.editRow}>
      <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>{label}</span>
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input type="number" className="field" autoFocus value={txt} placeholder={placeholder}
          onChange={(e) => setTxt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          style={{ height: 30, width: 130 }} aria-label={label} />
        <button className="btn btn-primary btn-sm" onClick={commit}>Save</button>
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </span>
    </div>
  );
}

const SP: Record<string, React.CSSProperties> = {
  projBanner: { fontSize: "var(--fs-sm)", color: "var(--text-muted)", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: "9px 12px", margin: "8px 0 4px", lineHeight: 1.5 },
  editRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border-hairline)" },
  progWrap: { display: "flex", alignItems: "center", gap: 10, margin: "10px 0 4px" },
  progTrack: { flex: 1, height: 10, background: "var(--border-hairline)", borderRadius: "var(--r-pill)", overflow: "hidden" },
  progFill: { height: "100%", background: "var(--pos-strong)" },
  progPct: { fontSize: "var(--fs-sm)", color: "var(--text-muted)", width: 52, textAlign: "right", fontVariantNumeric: "tabular-nums" },
  closedChip: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--fs-2xs)", fontWeight: 700, color: "var(--text-muted)", background: "var(--panel-2)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: "var(--r-sm)" },
};
