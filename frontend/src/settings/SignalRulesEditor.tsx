import { useEffect, useState } from "react";
import { useToast } from "../Toast";
import { API } from "../api";
import { SIGNAL_METRICS, newRule, metricUnit, type SignalRule } from "../signals";
import { SS } from "./ui";
import { IconClose } from "../Icon";

type StrategyInfo = { sell?: { default_mode?: string; dollar_gain?: number; pct_above?: number }; ladder_drops?: { drop_pct?: number }[] };

export function SignalRulesEditor() {
  const toast = useToast();
  const [rules, setRules] = useState<SignalRule[] | null>(null);
  const [strat, setStrat] = useState<StrategyInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`${API}/signal-rules`).then((r) => r.json())
      .then((j) => setRules(Array.isArray(j?.rules) ? j.rules : [])).catch(() => setRules([]));
    fetch(`${API}/strategy`).then((r) => r.json()).then((j) => setStrat(j)).catch(() => {});
  }, []);
  // Describe the built-in default rule with the ACTUAL strategy numbers it fires at.
  const sellDefault = (() => {
    const s = strat?.sell;
    if (!s) return "the strategy sell target";
    if (s.default_mode === "pct_above" && s.pct_above != null) return `+${(s.pct_above * 100).toFixed(0)}% above a lot's cost`;
    if (s.dollar_gain != null) return `+$${s.dollar_gain.toFixed(0)} profit on a lot`;
    return "the strategy sell target";
  })();
  const buyDefault = (() => {
    const d0 = strat?.ladder_drops?.[0]?.drop_pct;
    return d0 != null ? `the next ladder rung (first dip −${(d0 * 100).toFixed(0)}%)` : "the next ladder rung";
  })();
  if (!rules) return <p style={SS.credStatus}>Loading…</p>;
  const patch = (i: number, p: Partial<SignalRule>) => setRules((rs) => rs!.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = () => {
    setBusy(true);
    fetch(`${API}/signal-rules`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }) })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) { setRules(j.rules); toast("Signal rules saved — the dashboard will use them.", "success"); } else toast("Couldn't save rules.", "error"); })
      .catch(() => toast("Couldn't save rules.", "error"))
      .finally(() => setBusy(false));
  };
  return (
    <div>
      <div style={{ ...SS.credStatus, display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="chip chip-buy">▲BUY</span>
        <span>at {buyDefault}</span>
        <span style={{ color: "var(--text-faint)" }}>·</span>
        <span className="chip chip-sell">▼SELL</span>
        <span>at {sellDefault}</span>
        <span style={{ color: "var(--text-faint)" }}>— built in (change under Rules).</span>
      </div>
      {rules.map((r, i) => (
        <div key={r.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "6px 0", padding: 8, background: "var(--panel-2)", borderRadius: "var(--r-md)" }}>
          <select value={r.side} className="field" style={{ height: 28, minWidth: 76, paddingRight: 24 }}
            onChange={(e) => { const side = e.target.value as "buy" | "sell"; patch(i, { side, metric: SIGNAL_METRICS[side][0].key }); }}>
            <option value="sell">Sell</option><option value="buy">Buy</option>
          </select>
          <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>when</span>
          <select value={r.metric} className="field" style={{ height: 28, minWidth: 200, paddingRight: 24 }} onChange={(e) => patch(i, { metric: e.target.value })}>
            {SIGNAL_METRICS[r.side].map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <select value={r.op} className="field" style={{ height: 28, width: 54 }} onChange={(e) => patch(i, { op: e.target.value as ">=" | "<=" })}>
            <option value=">=">≥</option><option value="<=">≤</option>
          </select>
          <input type="number" value={r.value} className="field" style={{ height: 28, width: 80, textAlign: "right" }}
            onChange={(e) => patch(i, { value: Number(e.target.value) })} aria-label="Threshold" />
          <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>{metricUnit(r.side, r.metric)}</span>
          <input type="color" value={r.color} title="Chip color" aria-label="Chip color"
            onChange={(e) => patch(i, { color: e.target.value })} style={{ width: 30, height: 28, padding: 0, border: "none", background: "none", cursor: "pointer" }} />
          <input value={r.label} placeholder="label" className="field" style={{ height: 28, width: 96 }}
            onChange={(e) => patch(i, { label: e.target.value })} aria-label="Chip label" />
          <label style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={r.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />on
          </label>
          <button className="btn btn-ghost btn-sm" aria-label="Delete rule" onClick={() => setRules((rs) => rs!.filter((_, j) => j !== i))}><IconClose /></button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setRules((rs) => [...rs!, newRule("sell")])}>+ Sell rule</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setRules((rs) => [...rs!, newRule("buy")])}>+ Buy rule</button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save} style={{ marginLeft: "auto" }}>Save rules</button>
      </div>
    </div>
  );
}
