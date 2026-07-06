import { useEffect, useState } from "react";
import { usd, pct } from "./App";
import { ColumnManager } from "./ColumnManager";
import { DETAIL_COLUMNS, DETAIL_COLUMN_LIST, DEFAULT_DETAIL_COLS, useColumnPrefs, tickerRiskColor, RISK_LABEL } from "./columns";
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
          <span style={{ ...S.sym, color: tickerRiskColor(d.risk) }} title={d.risk ? RISK_LABEL[d.risk] : undefined}>{d.symbol}</span>
          {d.name && <span style={S.name}>{d.name}</span>}
          <SectorEditor symbol={d.symbol} sector={d.sector} onSaved={(s) => setD((p) => (p ? { ...p, sector: s } : p))} />
          {d.is_leveraged && (
            <EtfLinkEditor symbol={d.symbol} underlying={d.underlying ?? null}
              onSaved={(u) => setD((p) => (p ? { ...p, underlying: u } : p))} />
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ColumnManager prefs={cols} labelOf={(id) => DETAIL_COLUMNS[id]?.label ?? id} align="right" />
          {!d.is_watch && <button className="btn btn-buy" disabled={busy} onClick={openBuy}>Buy next rung</button>}
          <button style={S.close} aria-label="Close position detail" onClick={onClose}>✕</button>
        </div>
      </div>

      {d.is_watch ? (
        <div style={S.stats}>
          <Stat label="Price" value={usd(d.price)} />
          {d.last_held != null && <Stat label="Last held" value={usd(d.last_held)} />}
          {d.realized !== 0 && <Stat label="Realized" value={usd(d.realized)} color={signColor(d.realized)} />}
          {d.dividends > 0 && <Stat label="Dividends" value={usd(d.dividends)} color="var(--pos)" />}
        </div>
      ) : (
        <div style={S.stats}>
          <Stat label="Price" value={usd(d.price)} />
          <Stat label="Positions" value={String(d.positions)} />
          <Stat label="Shares" value={d.shares.toLocaleString()} />
          <Stat label="Invested" value={usd(d.invested)} />
          <Stat label="Basis / Share" value={usd(d.basis_per_share)} />
          <Stat label="LILO %" value={pct(d.lilo_pct)} color={signColor(d.lilo_pct)} />
          <Stat label="Unrealized" value={d.unrealized == null ? "—" : usd(d.unrealized)} color={signColor(d.unrealized)} />
          <Stat label="Realized" value={usd(d.realized)} color={signColor(d.realized)} />
          {d.dividends > 0 && <Stat label="Dividends" value={usd(d.dividends)} color="var(--pos)" />}
          <Stat label="Total return" value={usd(d.total_return)} color={signColor(d.total_return)} />
        </div>
      )}

      {d.is_watch && (
        <p style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)", margin: "8px 0 0" }}>
          On your watchlist — no open position{d.last_held != null ? `, last held at ${usd(d.last_held)}` : ""}.
          Use the ticker's Buy button on the dashboard to open a position.
        </p>
      )}

      <ChartToggle d={d} />

      <AlertTemplates d={d} onSet={(msg, kind) => toast(msg, kind)} />

      <PositionNote symbol={d.symbol} onSaved={(m) => toast(m, "success")} onError={(m) => toast(m, "error")} />

      {!d.is_watch && <>
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
      </>}

      {ticket && <OrderTicket suggestion={ticket} mode={mode} onClose={() => setTicket(null)} />}
    </section>
  );
}

// One-click price alerts from live position data — no threshold typing. Uses the same
// /api/alerts create as the manual form; degrades (button hidden) when data is missing.
function AlertTemplates({ d, onSet }: { d: PositionDetailData; onSet: (msg: string, kind?: "success" | "error") => void }) {
  const lastBuy = d.lots.length ? d.lots[d.lots.length - 1].buy_price : null;
  const make = (direction: "above" | "below", threshold: number, note: string) => {
    fetch(`${API}/alerts`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: d.symbol, direction, threshold: Number(threshold.toFixed(2)), note, repeat: false }),
    })
      .then((r) => r.json())
      .then((j) => onSet(j?.ok ? (j.warning || `Alert set: ${d.symbol} ${direction} ${usd(threshold)}`) : (j?.error || "Couldn't set alert."), j?.ok ? "success" : "error"))
      .catch(() => onSet("Couldn't set alert — network error.", "error"));
  };
  if (!lastBuy && d.avg_52wk == null) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "10px 0 0" }}>
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-dim)" }}>Quick alert:</span>
      {lastBuy != null && lastBuy > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={() => make("below", lastBuy * 0.95, "5% below last buy")}
          title={`Notify if ${d.symbol} falls to ${usd(lastBuy * 0.95)}`}>−5% from last buy</button>
      )}
      {d.avg_52wk != null && (
        <button className="btn btn-ghost btn-sm" onClick={() => make("above", d.avg_52wk!, "back above 52wk avg")}
          title={`Notify if ${d.symbol} rises above its 52wk average (${usd(d.avg_52wk)})`}>Above 52wk avg</button>
      )}
      {d.basis_per_share > 0 && (
        <button className="btn btn-ghost btn-sm" onClick={() => make("above", d.basis_per_share, "back above break-even")}
          title={`Notify if ${d.symbol} recovers to your cost basis (${usd(d.basis_per_share)})`}>Above break-even</button>
      )}
    </div>
  );
}

// Free-text journal note per symbol (thesis / reminders). Loads once, autosaves on blur.
function PositionNote({ symbol, onSaved, onError }: { symbol: string; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`${API}/positions/${symbol}/note`)
      .then((r) => r.json())
      .then((j) => { if (alive) { setNote(j.note || ""); setSaved(j.note || ""); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [symbol]);
  const save = () => {
    if (note === saved) return;
    fetch(`${API}/positions/${symbol}/note`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: note }) })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) { setSaved(j.note ?? note); onSaved("Note saved."); } else onError("Couldn't save note."); })
      .catch(() => onError("Couldn't save note."));
  };
  if (!loaded) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <label style={{ fontSize: "var(--fs-xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)" }}>Notes</label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} onBlur={save}
        placeholder="Your thesis, targets, reminders for this position — saved to this account."
        className="field" style={{ width: "100%", minHeight: 62, marginTop: 4, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
    </div>
  );
}

function ChartToggle({ d }: { d: PositionDetailData }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: "14px 0 4px" }}>
      <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide chart" : "Show chart"}
      </button>
      {open && (
        <PriceChart
          symbol={d.symbol}
          rungs={d.projected_ladder.map((p) => p.trigger_price)}
          avg52={d.avg_52wk}
          median52={d.median_52wk}
        />
      )}
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

// Inline editor for a leveraged ETF's underlying stock (drives dashboard nesting).
// Auto-detected from the fund name; click to override or clear. Enter/blur saves.
function EtfLinkEditor({ symbol, underlying, onSaved }: { symbol: string; underlying: string | null; onSaved: (u: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(underlying ?? "");
  const toast = useToast();
  const save = () => {
    const next = val.trim().toUpperCase();
    setEditing(false);
    if (next === (underlying ?? "")) return;
    fetch(`${API}/etf-link`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ etf: symbol, underlying: next || null }),
    })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) { onSaved(next || null); toast("Grouping saved — the dashboard will nest it.", "success"); } else toast("Couldn't save grouping.", "error"); })
      .catch(() => toast("Couldn't save grouping.", "error"));
  };
  if (editing) {
    return (
      <input className="field" autoFocus value={val} placeholder="Underlying (e.g. QBTS)"
        onChange={(e) => setVal(e.target.value.toUpperCase())}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setVal(underlying ?? ""); setEditing(false); } }}
        style={{ height: 26, width: 150, marginLeft: 10, fontSize: "var(--fs-sm)" }} aria-label="Underlying ticker" />
    );
  }
  return (
    <button className="tag" onClick={() => { setVal(underlying ?? ""); setEditing(true); }}
      title="Leveraged ETF — click to set the underlying stock it tracks (groups it on the dashboard)"
      style={{ marginLeft: 10, cursor: "pointer", color: underlying ? "var(--neg)" : "var(--text-faint)", border: "1px solid var(--border)", background: "transparent" }}>
      {underlying ? `↳ tracks ${underlying}` : "+ underlying"}
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
