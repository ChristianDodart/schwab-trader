import { useCallback, useEffect, useState } from "react";
import { usd, pct } from "./format";
import { useToast } from "./Toast";
import type { MarketHours, Mover } from "./types";
import { API } from "./api";

// ============================================================================
// Watchlist tab (repurposed from the old market Screener — we can't scan the whole
// market on the free data tier, so this evaluates the names YOU care about instead).
// Each watched name is vetted against your strategy universe and scored for how well
// its price behaviour fits the ladder. Read-only + advisory: no orders here.
// ============================================================================

const SORTS = [
  { key: "PERCENT_CHANGE_UP", label: "Gainers" },
  { key: "PERCENT_CHANGE_DOWN", label: "Losers" },
  { key: "VOLUME", label: "Most active" },
];
const INDEXES = [
  { key: "EQUITY_ALL", label: "All equities" },
  { key: "$SPX", label: "S&P 500" },
  { key: "$COMPX", label: "Nasdaq Comp" },
  { key: "$DJI", label: "Dow" },
  { key: "NYSE", label: "NYSE" },
  { key: "NASDAQ", label: "Nasdaq" },
];

type UniVerdict = { passes: boolean; reasons: string[] };
type Fitness = { ok: boolean; volatility?: number; avg_dollar_vol?: number; pct_off_high?: number; label?: string };
type BoardRow = { symbol: string; name: string | null; sector: string | null; market_cap: number | null; is_etf: boolean; universe: UniVerdict; fitness: Fitness };
type Board = { ok: boolean; rows: BoardRow[]; universe: { market_cap_min: number | null; market_cap_max: number | null; country: string | null; exclude: string[] } };

// Ladder-fit label → color + what it means. good = tradeable sweet spot; the others warn.
const FIT: Record<string, { color: string; hint: string }> = {
  good: { color: "var(--pos)", hint: "Liquid, with enough swing to cycle the ladder." },
  hot: { color: "var(--warn)", hint: "Cycles a lot — but the volatility means deep drawdowns / decay." },
  quiet: { color: "var(--text-dim)", hint: "Too calm — the ladder would rarely trigger." },
  thin: { color: "var(--neg)", hint: "Illiquid — hard to trade without slippage." },
};

export function Screener({ onSelect, onBacktest }: { onSelect?: (s: string) => void; onBacktest?: (s: string) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [addSym, setAddSym] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${API}/watchlist/board`).then((r) => r.json())
      .then((d) => setBoard(d as Board))
      .catch(() => toast("Couldn't load your watchlist."))
      .finally(() => setLoading(false));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const add = (sym?: string) => {
    const s = (sym ?? addSym).trim().toUpperCase();
    if (!s) return;
    setBusy(true);
    fetch(`${API}/tickers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: s }) })
      .then((r) => r.json())
      .then((res) => { if (res.ok) { setAddSym(""); load(); } else toast(res.error || `Couldn't add ${s}`); })
      .catch(() => toast(`Couldn't add ${s} — network error`))
      .finally(() => setBusy(false));
  };
  const remove = (sym: string) => {
    fetch(`${API}/tickers/${sym}`, { method: "DELETE" }).then(() => load()).catch(() => toast(`Couldn't remove ${sym}`));
  };

  const uni = board?.universe;
  const band = uni && uni.market_cap_min && uni.market_cap_max
    ? `$${uni.market_cap_min / 1e9}–${uni.market_cap_max / 1e9}B` : "";
  const rows = board?.rows ?? [];

  return (
    <div style={S.page}>
      <div style={S.head}>
        <div>
          <h2 className="page-title" style={{ margin: 0 }}>Watchlist</h2>
          <p style={S.dim}>
            Names you're weighing — each vetted against your universe{uni ? ` (${uni.country || "US"}${band ? ` · ${band}` : ""}${(uni.exclude || []).length ? ` · no ${uni.exclude.join("/")}` : ""} · no ETFs)` : ""} and
            scored for how well it fits the ladder. Advisory — nothing here places an order.
          </p>
        </div>
        <div style={S.addRow}>
          <input className="field" style={{ width: 120, textTransform: "uppercase" }} placeholder="Add symbol" value={addSym}
            onChange={(e) => setAddSym(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} aria-label="Add a symbol to your watchlist" />
          <button className="btn btn-primary" disabled={busy || !addSym.trim()} onClick={() => add()}>Add</button>
        </div>
      </div>

      {loading ? (
        <p style={S.dim}>Evaluating your watchlist…</p>
      ) : rows.length === 0 ? (
        <p style={S.dim}>No names yet — add a symbol above, or pull one from today's movers below.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={S.table}>
            <thead><tr>
              <th style={S.thL}>Symbol</th><th style={S.thL}>Name</th><th style={S.thL}>Universe</th>
              <th style={S.th} title="Annualized volatility — how much it swings (does it move enough to cycle rungs?)">Volatility</th>
              <th style={S.th} title="Average daily dollar volume — liquid enough to trade?">Avg $ vol</th>
              <th style={S.th} title="How far below its 1-year high it trades now">Off high</th>
              <th style={S.thL}>Ladder fit</th><th style={S.th}></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const fit = FIT[r.fitness.label ?? ""] ?? { color: "var(--text-dim)", hint: "" };
                return (
                  <tr key={r.symbol}>
                    <td style={S.tdL}><button style={S.symBtn} onClick={() => onSelect?.(r.symbol)} title="Open details">{r.symbol}</button></td>
                    <td style={{ ...S.tdL, color: "var(--text-dim)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name ?? "—"}</td>
                    <td style={S.tdL}>{r.universe.passes
                      ? <span style={{ color: "var(--pos)" }}>fits</span>
                      : <span style={{ color: "var(--warn)", cursor: "help" }} title={r.universe.reasons.join("; ")}>{r.universe.reasons.length} flag{r.universe.reasons.length === 1 ? "" : "s"}</span>}</td>
                    <td style={S.td}>{r.fitness.ok ? pct(r.fitness.volatility!) : "—"}</td>
                    <td style={S.td}>{r.fitness.ok ? fmtCap(r.fitness.avg_dollar_vol) : "—"}</td>
                    <td style={S.td}>{r.fitness.ok ? pct(r.fitness.pct_off_high!) : "—"}</td>
                    <td style={S.tdL}>{r.fitness.ok && r.fitness.label
                      ? <span style={{ color: fit.color, fontWeight: 700, cursor: "help" }} title={fit.hint}>{r.fitness.label}</span>
                      : <span style={S.dim}>too new</span>}</td>
                    <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => onBacktest?.(r.symbol)} title="Backtest this name on the Method tab">Backtest</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => remove(r.symbol)} title="Remove from watchlist" aria-label={`remove ${r.symbol}`}>&times;</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <MoversHelper onAdd={(s) => add(s)} />
    </div>
  );
}

// Secondary discovery aid: today's Schwab movers, one click to add to the watchlist.
function MoversHelper({ onAdd }: { onAdd: (s: string) => void }) {
  const [index, setIndex] = useState("EQUITY_ALL");
  const [sort, setSort] = useState("PERCENT_CHANGE_UP");
  const [movers, setMovers] = useState<Mover[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    fetch(`${API}/movers?index=${encodeURIComponent(index)}&sort=${sort}`).then((r) => r.json())
      .then((d) => { if (alive) { setMovers(d.movers ?? []); setErr(d.error ?? null); } })
      .catch(() => { if (alive) setErr("Couldn't load movers."); });
    return () => { alive = false; };
  }, [open, index, sort]);

  return (
    <details style={{ marginTop: 20 }} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary style={{ cursor: "pointer", color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>Add from today's movers</summary>
      <div style={{ display: "flex", gap: 8, margin: "10px 0" }}>
        <select className="field" value={index} onChange={(e) => setIndex(e.target.value)} aria-label="Index">
          {INDEXES.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
        </select>
        <select className="field" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      {err ? <p style={S.dim}>{err}</p> : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {movers.slice(0, 24).map((m) => (
            <button key={m.symbol} className="btn btn-ghost btn-sm" onClick={() => onAdd(m.symbol)} title={`Add ${m.symbol} to your watchlist`}>
              {m.symbol}{m.pct_change != null && <span style={{ marginLeft: 4, color: m.pct_change >= 0 ? "var(--pos)" : "var(--neg)" }}>{m.pct_change >= 0 ? "+" : ""}{m.pct_change.toFixed(1)}%</span>}
            </button>
          ))}
          {movers.length === 0 && <span style={S.dim}>No movers right now.</span>}
        </div>
      )}
    </details>
  );
}

export function MarketHoursBadge() {
  const [mh, setMh] = useState<MarketHours | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(`${API}/market-hours`)
        .then((r) => r.json())
        .then(setMh)
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!mh) return null;
  const info = SESSION[mh.session] ?? SESSION.unknown;
  return (
    <span style={{ ...S.mh, color: info.color, borderColor: info.color + "55" }} title={hint(mh)}>
      <span style={{ ...S.mhDot, background: info.color }} />
      {info.label}
    </span>
  );
}

const SESSION: Record<string, { label: string; color: string }> = {
  pre: { label: "Pre-market", color: "var(--warn)" },
  regular: { label: "Market open", color: "var(--pos)" },
  post: { label: "After-hours", color: "var(--warn)" },
  closed: { label: "Market closed", color: "var(--text-dim)" },
  unknown: { label: "Hours n/a", color: "var(--text-dim)" },
};
function hint(mh: MarketHours): string {
  if (!mh.next_change) return mh.session;
  const t = new Date(mh.next_change).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const verb = mh.session === "regular" || mh.session === "pre" || mh.session === "post" ? "next change" : "opens";
  return `${verb} ${t}`;
}

// Compact number formatters — still exported (a vitest suite covers them, and other
// views format Schwab volumes / market caps with these).
export function fmtVol(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}
export function fmtCap(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return usd(n);
}

const S: Record<string, React.CSSProperties> = {
  page: { marginTop: 18, maxWidth: 940 },
  head: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 14 },
  addRow: { display: "flex", gap: 6, alignItems: "center" },
  dim: { color: "var(--text-dim)", fontSize: "var(--fs-sm)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)" },
  th: { textAlign: "right", padding: "6px 8px", color: "var(--text-dim)", fontWeight: 600, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" },
  thL: { textAlign: "left", padding: "6px 8px", color: "var(--text-dim)", fontWeight: 600, borderBottom: "1px solid var(--border)" },
  td: { textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--border-faint)", fontVariantNumeric: "tabular-nums" },
  tdL: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border-faint)" },
  symBtn: { background: "transparent", color: "var(--accent-quiet)", border: "none", fontWeight: 700, fontSize: "var(--fs-md)", cursor: "pointer", padding: 0 },
  mh: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", fontWeight: 600, border: "1px solid", borderRadius: "var(--r-pill)", padding: "3px 10px", whiteSpace: "nowrap" },
  mhDot: { width: 7, height: 7, borderRadius: "50%" },
};
