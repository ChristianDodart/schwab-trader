import { useEffect, useState } from "react";
import { usd, pct } from "./App";
import { ColumnManager } from "./ColumnManager";
import { DETAIL_COLUMNS, DETAIL_COLUMN_LIST, DEFAULT_DETAIL_COLS, useColumnPrefs } from "./columns";
import { OrderTicket } from "./OrderTicket";
import { PriceChart } from "./PriceChart";
import { SkeletonPanel } from "./Skeleton";
import { useToast } from "./Toast";
import type { PositionDetailData, Suggestion } from "./types";

import { API } from "./api";

export function PositionDetail({ symbol, mode, onClose, embedded }: { symbol: string; mode?: string; onClose: () => void; embedded?: boolean }) {
  const [d, setD] = useState<PositionDetailData | null>(null);
  const [ticket, setTicket] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const cols = useColumnPrefs("detail.cols.v1", DEFAULT_DETAIL_COLS, DETAIL_COLUMN_LIST);
  const toast = useToast();

  const suggest = (url: string) => {
    if (busy) return;
    setBusy(true);
    fetch(url)
      .then((r) => r.json())
      .then((j) => { if (j.error) toast(j.error); else setTicket(j); })
      .catch(() => toast("Couldn't load the order suggestion — try again"))
      .finally(() => setBusy(false));
  };
  const openBuy = () => suggest(`${API}/suggest/buy/${symbol}`);
  const openSell = (lotId: number) => suggest(`${API}/suggest/sell/${lotId}`);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/positions/${symbol}`)
        .then((r) => r.json())
        .then((j) => alive && !j.error && setD(j))
        .catch(() => {});
    load();
    const t = setInterval(load, 2000); // keep price-derived fields fresh
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol]);

  if (!d) return <SkeletonPanel embedded={embedded} />;
  const defs = cols.ids.map((id) => DETAIL_COLUMNS[id]).filter(Boolean);

  return (
    <section className={embedded ? undefined : "panel"} style={embedded ? S.panelEmbedded : S.panel}>
      <div style={S.head}>
        <div>
          <span style={S.sym}>{d.symbol}</span>
          {d.name && <span style={S.name}>{d.name}</span>}
          <SectorEditor symbol={d.symbol} sector={d.sector} onSaved={(s) => setD((p) => (p ? { ...p, sector: s } : p))} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ColumnManager prefs={cols} labelOf={(id) => DETAIL_COLUMNS[id]?.label ?? id} align="right" />
          <button className="btn btn-buy" disabled={busy} onClick={openBuy}>Buy next rung</button>
          <button style={S.close} aria-label="Close position detail" onClick={onClose}>✕</button>
        </div>
      </div>

      <div style={S.stats}>
        <Stat label="Price" value={usd(d.price)} />
        <Stat label="Positions" value={String(d.positions)} />
        <Stat label="Shares" value={d.shares.toLocaleString()} />
        <Stat label="Invested" value={usd(d.invested)} />
        <Stat label="Basis / Share" value={usd(d.basis_per_share)} />
        <Stat label="LILO %" value={pct(d.lilo_pct)} color={signColor(d.lilo_pct)} />
      </div>

      <ChartToggle symbol={d.symbol} />

      <h3 className="section-title" style={S.h3}>Buy Ladder</h3>
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col" className="left">Rung</th>
              {defs.map((c) => (
                <th scope="col" key={c.id} className={c.align === "left" ? "left" : ""}>{c.label}</th>
              ))}
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {d.lots.map((l) => (
              <tr key={`f${l.rung}`}>
                <td className="left">
                  {l.rung}
                  {l.source === "position" && (
                    <span style={S.prior} title="Held from before our fill history — quantity is from Schwab, cost is the position average (not an exact buy fill)">
                      prior
                    </span>
                  )}
                </td>
                {defs.map((c) => (
                  <td key={c.id} style={{ textAlign: c.align }}>{c.render(l)}</td>
                ))}
                <td style={{ textAlign: "right" }}>
                  <button className="btn btn-sell btn-sm" disabled={busy} onClick={() => openSell(l.id)}>Sell</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {d.projected_ladder.length > 0 && (
        <>
          <h3 className="section-title" style={S.h3}>Projected Ladder</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  {["Rung", "Trigger Price", "Suggested $", "Suggested Shares"].map((h, i) => (
                    <th scope="col" key={h} className={i === 0 ? "left" : ""}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.projected_ladder.map((p) => (
                  <tr key={`p${p.rung}`} style={{ opacity: 0.55 }}>
                    <td className="left">{p.rung}</td>
                    <td style={{ textAlign: "right", color: "var(--accent-quiet)" }}>{usd(p.trigger_price)}</td>
                    <td style={{ textAlign: "right" }}>{usd(p.suggested_dollars)}</td>
                    <td style={{ textAlign: "right" }}>{p.suggested_shares ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {ticket && <OrderTicket suggestion={ticket} mode={mode} onClose={() => setTicket(null)} />}
    </section>
  );
}

function ChartToggle({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: "14px 0 4px" }}>
      <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide chart" : "Show chart"}
      </button>
      {open && <PriceChart symbol={symbol} />}
    </div>
  );
}

// Inline editor for a ticker's sector (user-maintained — Schwab omits it). Click
// the tag to edit; Enter/blur saves, Escape cancels.
function SectorEditor({ symbol, sector, onSaved }: { symbol: string; sector: string | null; onSaved: (s: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(sector ?? "");
  const toast = useToast();
  const save = () => {
    const next = val.trim();
    setEditing(false);
    if (next === (sector ?? "")) return;
    fetch(`${API}/tickers/${symbol}/sector`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sector: next || null }),
    })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) onSaved(j.sector ?? null); else toast("Couldn't save sector.", "error"); })
      .catch(() => toast("Couldn't save sector.", "error"));
  };
  if (editing) {
    return (
      <input className="field" autoFocus value={val} placeholder="Sector (e.g. Defense)"
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setVal(sector ?? ""); setEditing(false); } }}
        style={{ height: 26, width: 150, marginLeft: 10, fontSize: "var(--fs-sm)" }} aria-label="Sector" />
    );
  }
  return (
    <button className="tag" onClick={() => { setVal(sector ?? ""); setEditing(true); }}
      title="Click to edit sector"
      style={{ marginLeft: 10, cursor: "pointer", color: sector ? "var(--accent-quiet)" : "var(--text-faint)", border: "1px solid var(--border)", background: "transparent" }}>
      {sector || "+ sector"}
    </button>
  );
}

const signColor = (n: number | null | undefined) =>
  n == null ? undefined : n >= 0 ? "var(--pos)" : "var(--neg)";

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={S.stat}>
      <div style={S.statLabel}>{label}</div>
      <div style={{ ...S.statValue, color: color ?? "var(--text)" }}>{value}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  panel: { marginTop: 24, padding: 20 },
  panelEmbedded: { padding: 20 }, // inline drawer: the table cell supplies the container (bg + left rail)
  head: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  sym: { fontSize: "var(--fs-xl)", fontWeight: 700, marginRight: 10 },
  name: { color: "var(--text-dim)", fontSize: "var(--fs-md)" },
  close: { background: "none", border: "none", color: "var(--text-dim)", fontSize: 18, cursor: "pointer", padding: "0 4px" },
  stats: { display: "flex", gap: 28, flexWrap: "wrap", margin: "16px 0 8px" },
  stat: {},
  statLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)" },
  statValue: { fontSize: "var(--fs-lg)", fontWeight: 600, marginTop: 2, fontVariantNumeric: "tabular-nums" },
  h3: { margin: "18px 0 8px" },
  prior: { fontSize: 10, color: "var(--warn)", border: "1px solid var(--warn-border)", borderRadius: "var(--r-sm)", padding: "0 5px", marginLeft: 6, textTransform: "uppercase", cursor: "help" },
};
