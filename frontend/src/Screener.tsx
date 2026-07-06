import { useEffect, useState } from "react";
import { usd } from "./App";
import { SkeletonTable } from "./Skeleton";
import { useToast } from "./Toast";
import type { CandidateScreen, MarketHours, Mover, VetResult } from "./types";
import { tickerRiskColor, RISK_LABEL } from "./columns";

import { API } from "./api";

const SORTS: { key: string; label: string }[] = [
  { key: "PERCENT_CHANGE_UP", label: "Gainers" },
  { key: "PERCENT_CHANGE_DOWN", label: "Losers" },
  { key: "VOLUME", label: "Most active" },
];
const INDEXES: { key: string; label: string }[] = [
  { key: "EQUITY_ALL", label: "All equities" },
  { key: "$SPX", label: "S&P 500" },
  { key: "$COMPX", label: "Nasdaq Comp" },
  { key: "$DJI", label: "Dow" },
  { key: "NYSE", label: "NYSE" },
  { key: "NASDAQ", label: "Nasdaq" },
];

// Remember the last index/sort across sessions so "Screen now" reuses the user's
// usual filter instead of resetting to the defaults every launch.
const LS_INDEX = "screener.index.v1";
const LS_SORT = "screener.sort.v1";
const lsGet = (k: string, fallback: string) => {
  try { return localStorage.getItem(k) || fallback; } catch { return fallback; }
};

export function Screener({ onAdded }: { onAdded?: (symbol: string) => void }) {
  const [index, setIndex] = useState(() => lsGet(LS_INDEX, "EQUITY_ALL"));
  const [sort, setSort] = useState(() => lsGet(LS_SORT, "PERCENT_CHANGE_UP"));
  useEffect(() => { try { localStorage.setItem(LS_INDEX, index); } catch { /* private mode */ } }, [index]);
  useEffect(() => { try { localStorage.setItem(LS_SORT, sort); } catch { /* private mode */ } }, [sort]);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [moversErr, setMoversErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Record<string, boolean>>({});
  const [refreshNonce, setRefreshNonce] = useState(0); // bump to re-run the movers fetch
  const toast = useToast();

  const [vetSym, setVetSym] = useState("");
  const [vet, setVet] = useState<VetResult | null>(null);
  const [vetLoading, setVetLoading] = useState(false);

  const [cands, setCands] = useState<CandidateScreen | null>(null);
  const [candLoading, setCandLoading] = useState(false);
  const [candSort, setCandSort] = useState<{ col: string; dir: number } | null>(() => {
    try { const r = localStorage.getItem("screener.candSort.v1"); return r ? JSON.parse(r) : null; } catch { return null; }
  });
  useEffect(() => {
    try { candSort ? localStorage.setItem("screener.candSort.v1", JSON.stringify(candSort)) : localStorage.removeItem("screener.candSort.v1"); }
    catch { /* private mode */ }
  }, [candSort]);
  const runScreen = () => {
    setCandLoading(true);
    fetch(`${API}/screener/candidates?index=${encodeURIComponent(index)}&sort=${sort}`)
      .then((r) => r.json())
      .then(setCands)
      .catch(() => toast("Couldn't screen candidates — try again."))
      .finally(() => setCandLoading(false));
  };

  // Guarded against out-of-order responses: switching index/sort rapidly could let a
  // slow earlier request resolve last and render under the wrong filter. `alive`
  // (invalidated on the next effect run) drops any stale response.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`${API}/movers?index=${encodeURIComponent(index)}&sort=${sort}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; setMovers(d.movers ?? []); setMoversErr(d.error ?? null); })
      .catch(() => { if (alive) setMoversErr("Couldn't load movers — network error."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [index, sort, refreshNonce]);

  const runVet = (sym?: string) => {
    const s = (sym ?? vetSym).trim().toUpperCase();
    if (!s) return;
    setVetSym(s);
    setVetLoading(true);
    setVet(null);
    fetch(`${API}/screen/${s}`)
      .then((r) => r.json())
      .then((d) => setVet(d))
      .catch(() => setVet({ ok: false, symbol: s, error: "lookup failed" }))
      .finally(() => setVetLoading(false));
  };

  const addAllPassing = () => {
    const fresh = (cands?.candidates ?? []).filter((c) => c.passes && !added[c.symbol]);
    if (!fresh.length) { toast("No new passing names to add.", "info"); return; }
    fresh.forEach((c) => addToWatch(c.symbol));
    toast(`Adding ${fresh.length} name${fresh.length === 1 ? "" : "s"} to your watchlist…`, "info");
  };

  const addToWatch = (sym: string) => {
    setAdded((a) => ({ ...a, [sym]: true })); // optimistic
    fetch(`${API}/tickers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) onAdded?.(sym);
        else { setAdded((a) => ({ ...a, [sym]: false })); toast(res.error || `Couldn't add ${sym}`); }
      })
      .catch(() => { setAdded((a) => ({ ...a, [sym]: false })); toast(`Couldn't add ${sym} — network error`); });
  };

  return (
    <div>
      {/* ---- Candidates matching your rules (movers + watchlist, filtered) ---- */}
      <div className="panel" style={S.candPanel}>
        <div style={S.candHead}>
          <div>
            <h2 className="page-title" style={{ margin: 0 }}>Candidates matching your rules</h2>
            <p style={S.dim}>Screens today's movers ({index === "EQUITY_ALL" ? "all equities" : index}, {sortLabel(sort)}) plus your watchlist against your Financial Rules — market-cap band, country, excluded sectors, no ETFs.</p>
          </div>
          <button className="btn btn-primary" disabled={candLoading} onClick={runScreen}>
            {candLoading ? "Screening…" : "Screen now"}
          </button>
        </div>
        {cands && !cands.ok && <p style={S.err}>{cands.error}</p>}
        {cands && cands.ok && (
          <>
            <p style={S.candSummary}>
              <b style={{ color: "var(--pos)" }}>{cands.passing}</b> of {cands.count} fit your rules
              <span style={{ color: "var(--text-faint)" }}> · pool: {cands.pool_note}</span>
            </p>
            {cands.filters && <FilterChips f={cands.filters} />}
            {(cands.passing ?? 0) > 0 && (cands.candidates ?? []).some((c) => c.passes && !added[c.symbol]) && (
              <button className="btn btn-secondary btn-sm" style={{ margin: "0 0 10px" }} onClick={addAllPassing}>
                + Add all passing to watchlist
              </button>
            )}
            {(cands.candidates ?? []).length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <SortTh label="Symbol" col="symbol" sort={candSort} onSort={setCandSort} align="left" />
                      <th scope="col" className="left">Sector</th>
                      <SortTh label="Market cap" col="market_cap" sort={candSort} onSort={setCandSort} />
                      <SortTh label="% Chg" col="pct_change" sort={candSort} onSort={setCandSort} />
                      <th scope="col" className="left">Fits your rules?</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortCandidates(cands.candidates ?? [], candSort).map((c) => {
                      const fails = c.reasons.filter((r) => r.status === "fail");
                      return (
                        <tr key={c.symbol} style={c.passes ? undefined : { opacity: 0.62 }}>
                          <td className="left">
                            <button style={{ ...S.symBtn, color: tickerRiskColor(c.risk) }} onClick={() => runVet(c.symbol)} title={c.risk ? RISK_LABEL[c.risk] : "Vet against guardrails"}>{c.symbol}</button>
                            {c.name && <div style={S.name}>{c.name}{c.in_movers ? " · mover" : ""}</div>}
                          </td>
                          <td className="left" style={{ color: "var(--text-muted)" }}>{c.sector ?? "—"}{c.country && c.country !== "US" ? ` · ${c.country}` : ""}</td>
                          <td style={{ textAlign: "right" }}>{fmtCap(c.market_cap)}</td>
                          <td style={{ textAlign: "right", color: pctColor(c.pct_change) }}>{c.pct_change != null ? fmtPct(c.pct_change) : "—"}</td>
                          <td className="left">
                            {c.passes
                              ? <span style={badge("pass")}>✓ fits</span>
                              : <span title={fails.map((f) => `${f.label}: ${f.detail}`).join("; ")}>
                                  <span style={badge("fail")}>✗</span>
                                  <span style={S.failReason}> {fails[0] ? fails[0].detail : "doesn't fit"}</span>
                                </span>}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {added[c.symbol] ? <span style={S.added}>✓ watched</span>
                              : <button className="btn btn-secondary btn-sm" onClick={() => addToWatch(c.symbol)}>+ Watch</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {!cands && <p style={S.dim}>Click <b>Screen now</b> to filter the current movers + your watchlist down to names that fit your strategy.</p>}
      </div>

    <div style={S.wrap}>
      <div style={S.col}>
        <div style={S.head}>
          <h2 className="page-title">Movers</h2>
          <div style={S.controls}>
            <select className="field" value={index} onChange={(e) => setIndex(e.target.value)}>
              {INDEXES.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <span role="group" aria-label="Sort movers" style={{ display: "flex", gap: 6 }}>
              {SORTS.map((o) => (
                <button
                  key={o.key}
                  className="btn btn-sm"
                  style={pill(sort === o.key)}
                  aria-pressed={sort === o.key}
                  onClick={() => setSort(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </span>
            <button className="btn btn-secondary btn-sm" onClick={() => setRefreshNonce((n) => n + 1)} title="Refresh movers" aria-label="Refresh movers">↻</button>
          </div>
        </div>
        {moversErr && <p style={S.err}>{moversErr}</p>}
        {loading && movers.length === 0 ? (
          <SkeletonTable rows={6} cols={4} />
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table className="tbl">
              <thead>
                <tr>
                  {["Symbol", "Last", "% Chg", "Volume", ""].map((h, i) => (
                    <th scope="col" key={h || "act"} className={i === 0 ? "left" : ""}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {movers.map((m) => (
                  <tr key={m.symbol}>
                    <td className="left">
                      <button style={S.symBtn} onClick={() => runVet(m.symbol)} title="Vet against guardrails">
                        {m.symbol}
                      </button>
                      {m.name && <div style={S.name}>{m.name}</div>}
                    </td>
                    <td style={{ textAlign: "right" }}>{usd(m.last)}</td>
                    <td style={{ textAlign: "right", color: pctColor(m.pct_change) }}>{fmtPct(m.pct_change)}</td>
                    <td style={{ textAlign: "right" }}>{fmtVol(m.volume)}</td>
                    <td style={{ textAlign: "right" }}>
                      {added[m.symbol] ? (
                        <span style={S.added}>✓ watched</span>
                      ) : (
                        <button className="btn btn-secondary btn-sm" onClick={() => addToWatch(m.symbol)}>+ Watch</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={S.colNarrow}>
        <h2 className="page-title">Vet a symbol</h2>
        <p style={S.dim}>Check fundamentals against your strategy guardrails.</p>
        <div style={S.vetForm}>
          <input
            className="field"
            style={{ flex: 1 }}
            placeholder="Symbol"
            aria-label="Symbol to vet"
            value={vetSym}
            onChange={(e) => setVetSym(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && runVet()}
          />
          <button className="btn btn-primary" onClick={() => runVet()}>Vet</button>
        </div>

        {vetLoading && <p style={S.dim}>Looking up…</p>}
        {vet && !vet.ok && <p style={S.err}>{vet.error}</p>}
        {vet && vet.ok && (
          <div className="panel" style={S.card}>
            <div style={S.cardHead}>
              <div>
                <span style={S.cardSym}>{vet.symbol}</span>
                {vet.name && <span style={S.cardName}>{vet.name}</span>}
                {(vet.sector || vet.industry || vet.country) && (
                  <div style={S.classline}>
                    {[vet.sector, vet.industry, vet.country].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              {added[vet.symbol] ? (
                <span style={S.added}>✓ watched</span>
              ) : (
                <button className="btn btn-secondary btn-sm" onClick={() => addToWatch(vet.symbol)}>+ Watch</button>
              )}
            </div>
            <div style={S.grid}>
              <Stat label="Last" v={usd(vet.last)} />
              <Stat label="Market cap" v={fmtCap(vet.market_cap)} />
              <Stat label="P/E" v={fmtN(vet.pe_ratio)} />
              <Stat label="EPS" v={fmtN(vet.eps)} />
              <Stat label="Div yield" v={vet.div_yield != null ? `${vet.div_yield.toFixed(2)}%` : "—"} />
              <Stat label="% of 52w high" v={vet.pct_of_high != null ? `${(vet.pct_of_high * 100).toFixed(1)}%` : "—"} />
              <Stat label="52w range" v={`${fmtN(vet.year_low)} – ${fmtN(vet.year_high)}`} />
              <Stat label="Avg vol (10d)" v={fmtVol(vet.avg_volume ?? null)} />
            </div>
            <FundamentalsBlock v={vet} />
            <div style={S.checks}>
              {(vet.checks ?? []).map((c, i) => (
                <div key={i} style={S.check}>
                  <span style={badge(c.status)}>{c.status}</span>
                  <span style={S.checkLabel}>{c.label}</span>
                  <span style={S.checkDetail}>{c.detail}</span>
                </div>
              ))}
            </div>
            {vet.ev_note && <p style={S.evNote}>{vet.ev_note}</p>}
          </div>
        )}
      </div>
    </div>
    </div>
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
  pre: { label: "Pre-market", color: "#e0a83e" },
  regular: { label: "Market open", color: "#5dcaa5" },
  post: { label: "After-hours", color: "#e0a83e" },
  closed: { label: "Market closed", color: "#9a9aa0" },
  unknown: { label: "Hours n/a", color: "#9a9aa0" },
};
function hint(mh: MarketHours): string {
  if (!mh.next_change) return mh.session;
  const t = new Date(mh.next_change).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const verb = mh.session === "regular" || mh.session === "pre" || mh.session === "post" ? "next change" : "opens";
  return `${verb} ${t}`;
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div style={S.stat}>
      <div style={S.statLabel}>{label}</div>
      <div style={S.statV}>{v}</div>
    </div>
  );
}

// Deeper Schwab fundamentals, grouped. Only groups with ≥1 present value render, so
// a lean response doesn't paint a wall of dashes.
function FundamentalsBlock({ v }: { v: VetResult }) {
  const p1 = (n: number | null | undefined) => (n == null ? null : `${n.toFixed(1)}%`);   // margins/growth (already %)
  const r2 = (n: number | null | undefined) => (n == null ? null : n.toFixed(2));          // ratios
  const groups: { title: string; items: [string, string | null][] }[] = [
    { title: "Valuation", items: [["PEG", r2(v.peg_ratio)], ["P/B", r2(v.pb_ratio)], ["Beta", r2(v.beta)], ["Book value/sh", v.book_value_ps != null ? usd(v.book_value_ps) : null]] },
    { title: "Profitability", items: [["ROE", p1(v.roe)], ["ROA", p1(v.roa)], ["Net margin", p1(v.net_margin)], ["Gross margin", p1(v.gross_margin)], ["Operating margin", p1(v.operating_margin)]] },
    { title: "Growth (YoY)", items: [["Revenue", p1(v.rev_growth)], ["EPS", p1(v.eps_growth)]] },
    { title: "Balance sheet", items: [["Debt/Equity", r2(v.debt_to_equity)], ["Current ratio", r2(v.current_ratio)], ["Quick ratio", r2(v.quick_ratio)]] },
    { title: "Trading", items: [["Short % float", p1(v.short_pct_float)]] },
  ].map((g) => ({ ...g, items: g.items.filter(([, val]) => val != null) as [string, string][] }))
    .filter((g) => g.items.length > 0);

  if (groups.length === 0) return null;
  return (
    <div style={S.fundWrap}>
      {groups.map((g) => (
        <div key={g.title} style={S.fundGroup}>
          <div style={S.fundTitle}>{g.title}</div>
          {g.items.map(([label, val]) => (
            <div key={label} style={S.fundRow}><span style={S.fundLabel}>{label}</span><span style={S.fundVal}>{val}</span></div>
          ))}
        </div>
      ))}
    </div>
  );
}

const sortLabel = (key: string) => SORTS.find((s) => s.key === key)?.label ?? "movers";
const pctColor = (n: number | null) => (n == null ? "var(--text)" : n >= 0 ? "var(--pos)" : "var(--neg)");
const fmtPct = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const fmtN = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
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

// Client-side candidate sort. No selection → keep the server order (passing first, then
// biggest cap). A chosen column sorts purely by it; nulls sink to the bottom.
type CandSort = { col: string; dir: number } | null;
function sortCandidates<T extends { symbol: string; market_cap: number | null; pct_change: number | null }>(rows: T[], sort: CandSort): T[] {
  if (!sort) return rows;
  const val = (c: T) => sort.col === "symbol" ? c.symbol : (sort.col === "market_cap" ? c.market_cap : c.pct_change);
  return [...rows].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * sort.dir;
    return ((av as number) - (bv as number)) * sort.dir;
  });
}

function SortTh({ label, col, sort, onSort, align }: { label: string; col: string; sort: CandSort; onSort: (s: CandSort) => void; align?: "left" }) {
  const active = sort?.col === col;
  const arrow = active ? (sort!.dir === 1 ? " ▲" : " ▼") : "";
  const toggle = () => onSort(active && sort!.dir === -1 ? null : { col, dir: active ? -1 : 1 });
  return (
    <th scope="col" className={align === "left" ? "left" : ""}>
      <button onClick={toggle} title={`Sort by ${label}`}
        style={{ background: "none", border: "none", color: active ? "var(--text)" : "inherit", cursor: "pointer", font: "inherit", padding: 0 }}>
        {label}{arrow}
      </button>
    </th>
  );
}

// The active universe rules shown as chips, so it's obvious WHY names pass or fail.
// Read-only summary — edit the rules themselves under the Rules tab.
function FilterChips({ f }: { f: NonNullable<CandidateScreen["filters"]> }) {
  const chips: string[] = [];
  const lo = f.market_cap_min, hi = f.market_cap_max;
  if (lo != null && hi != null) chips.push(`Cap ${fmtCap(lo)}–${fmtCap(hi)}`);
  else if (lo != null) chips.push(`Cap ≥ ${fmtCap(lo)}`);
  else if (hi != null) chips.push(`Cap ≤ ${fmtCap(hi)}`);
  if (f.country) chips.push(`Country ${f.country}`);
  if (f.no_etfs) chips.push("Individual stocks only");
  (f.exclude ?? []).forEach((s) => chips.push(`Excludes ${s}`));
  if (!chips.length) return null;
  return (
    <div style={S.chipRow}>
      <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)" }}>Filters:</span>
      {chips.map((c) => <span key={c} style={S.filterChip}>{c}</span>)}
      <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-2xs)" }}>· adjust under Rules</span>
    </div>
  );
}

// Active toggle uses the ACCENT (blue = "a control"), never the profit-green.
const pill = (active: boolean): React.CSSProperties => ({
  background: active ? "var(--accent)" : "var(--panel-2)",
  color: active ? "#fff" : "var(--text-muted)",
  borderColor: active ? "var(--accent)" : "var(--border-strong)",
});
const badge = (status: string): React.CSSProperties => ({
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  padding: "1px 7px",
  borderRadius: "var(--r-sm)",
  color: "white",
  background: status === "pass" ? "var(--pos-strong)" : status === "fail" ? "var(--neg-strong)" : "var(--text-faint)",
});

const S: Record<string, React.CSSProperties> = {
  candPanel: { marginTop: 18, padding: 18 },
  candHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 8 },
  candSummary: { fontSize: "var(--fs-md)", margin: "4px 0 8px" },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "0 0 12px" },
  filterChip: { fontSize: "var(--fs-2xs)", color: "var(--text-muted)", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: "1px 9px" },
  failReason: { fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginLeft: 6 },
  wrap: { display: "flex", gap: 24, marginTop: 18, alignItems: "flex-start", flexWrap: "wrap" },
  col: { flex: "1 1 480px", minWidth: 360 },
  colNarrow: { flex: "1 1 340px", minWidth: 320 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  controls: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  symBtn: { background: "transparent", color: "var(--accent-quiet)", border: "none", fontWeight: 700, fontSize: "var(--fs-md)", cursor: "pointer", padding: 0 },
  name: { fontSize: "var(--fs-2xs)", color: "var(--text-dim)", marginTop: 2, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  added: { color: "var(--pos)", fontSize: "var(--fs-xs)", fontWeight: 600 },
  dim: { color: "var(--text-dim)", fontSize: "var(--fs-sm)" },
  err: { color: "var(--neg)", fontSize: "var(--fs-sm)" },
  vetForm: { display: "flex", gap: 6, margin: "8px 0 12px" },
  card: { padding: 16, marginTop: 4 },
  cardHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  cardSym: { fontSize: "var(--fs-lg)", fontWeight: 700, marginRight: 8 },
  cardName: { fontSize: "var(--fs-sm)", color: "var(--text-dim)" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px", marginBottom: 14 },
  stat: {},
  statLabel: { fontSize: "var(--fs-2xs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" },
  statV: { fontSize: "var(--fs-md)", fontWeight: 600, marginTop: 1, fontVariantNumeric: "tabular-nums" },
  classline: { fontSize: "var(--fs-xs)", color: "var(--accent-quiet)", marginTop: 3 },
  fundWrap: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px", borderTop: "1px solid var(--border)", paddingTop: 12, marginBottom: 14 },
  fundGroup: {},
  fundTitle: { fontSize: "var(--fs-2xs)", color: "var(--accent-quiet)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 },
  fundRow: { display: "flex", justifyContent: "space-between", fontSize: "var(--fs-sm)", padding: "1px 0" },
  fundLabel: { color: "var(--text-muted)" },
  fundVal: { fontVariantNumeric: "tabular-nums" },
  checks: { display: "flex", flexDirection: "column", gap: 7, borderTop: "1px solid var(--border)", paddingTop: 12 },
  check: { display: "flex", alignItems: "center", gap: 8 },
  checkLabel: { fontSize: "var(--fs-sm)", color: "var(--text-muted)", flex: 1 },
  checkDetail: { fontSize: "var(--fs-xs)", color: "var(--text-dim)" },
  evNote: { fontSize: "var(--fs-2xs)", color: "var(--text-faint)", marginTop: 12, marginBottom: 0, lineHeight: 1.4 },
  mh: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", fontWeight: 600, border: "1px solid", borderRadius: "var(--r-pill)", padding: "3px 10px", whiteSpace: "nowrap" },
  mhDot: { width: 7, height: 7, borderRadius: "50%" },
};
