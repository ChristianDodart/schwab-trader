import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { usd } from "./format";
import { SkeletonCards, SkeletonPanel } from "./Skeleton";
import { AccountStamp, ALL_TIME, Card, Panel, PeriodSelector, S, moneyColor, type Period } from "./LedgerUI";
import type { TradeLog } from "./types";

import { API } from "./api";
import { IconDownload, IconChevronDown, IconChevronRight } from "./Icon";

const qs = (p: Period, sym: string) => {
  const q = new URLSearchParams();
  if (p.from) q.set("start", p.from);
  if (p.to) q.set("end", p.to);
  if (sym.trim()) q.set("symbol", sym.trim().toUpperCase());
  const s = q.toString();
  return s ? `?${s}` : "";
};

const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(0)}%`);

// Trigger a file download from an API URL — the endpoint's Content-Disposition header
// makes the browser save it rather than navigate the SPA away.
const downloadCsv = (url: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  a.click();
};

export function LedgerTrades({ initialScope }: { initialScope?: Period } = {}) {
  const year = new Date().getFullYear();
  const [scope, setScope] = useState<Period>(initialScope ?? ALL_TIME);
  const [taxYear, setTaxYear] = useState(year);
  const [sym, setSym] = useState("");
  const [d, setD] = useState<TradeLog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openSym, setOpenSym] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(() => {
    const my = ++seqRef.current;
    // Do NOT blank `d` here — that would swap the whole view for a skeleton on every
    // keystroke, unmounting the symbol filter and stealing focus. Keep the current
    // data visible while the refetch is in flight (the seq guard drops stale replies).
    fetch(`${API}/ledger/trades${qs(scope, sym)}`)
      .then((r) => r.json())
      .then((j) => { if (seqRef.current === my) (j && !j.error ? (setD(j), setErr(null)) : setErr(j?.error || "Couldn't load trades.")); })
      .catch(() => { if (seqRef.current === my) setErr("Couldn't load trades — network error."); });
  }, [scope, sym]);
  // Debounce so a burst of typing in the symbol filter fires one request, not one per key.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  if (err) return <p style={S.note}>{err}</p>;
  if (!d) return <div><SkeletonCards n={4} /><SkeletonPanel /></div>;

  const s = d.summary;
  const winStr = s.count ? `${pct(s.win_rate)} · ${s.wins}W/${s.losses}L` : "—";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => window.print()}
          title="Print the closed-trades journal or save it as a PDF">Print / Save PDF</button>
      </div>

      {/* Printable closed-trades journal (hidden on screen; see .print-only in ui.css). */}
      <div className="print-only">
        <h2 style={{ margin: "0 0 2px" }}>Schwab Trader — Trade Journal</h2>
        <AccountStamp />
        <p style={{ margin: "0 0 4px", fontSize: 12 }}>{scope.label}{sym ? ` · ${sym.toUpperCase()}` : ""}</p>
        <p style={{ margin: "0 0 12px", fontSize: 12 }}>
          {s.count} trades · win rate {winStr} · total P/L {usd(s.total_profit)}
        </p>
        <table>
          <thead><tr><th>Closed</th><th>Symbol</th><th>Shares</th><th>Buy</th><th>Sell</th><th>P/L</th><th>Held</th></tr></thead>
          <tbody>
            {d.trades.map((t) => (
              <tr key={t.id}>
                <td>{t.completed_at ?? "—"}</td><td>{t.symbol}</td>
                <td className="num">{t.shares.toLocaleString()}</td>
                <td className="num">{usd(t.buy_price)}</td><td className="num">{usd(t.sell_price)}</td>
                <td className="num">{t.profit > 0 ? "+" : ""}{usd(t.profit)}</td>
                <td>{t.is_day_trade ? "same day" : t.hold_days == null ? "—" : `${t.hold_days}d`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={S.cards}>
        <Card label="Win rate" value={winStr} big
          hint="Share of closed trades that were profitable, with the win/loss split." />
        <Card label="Total realized P/L" value={usd(s.total_profit)} accent={moneyColor(s.total_profit)}
          sub={s.count ? `${s.count} trade${s.count === 1 ? "" : "s"}` : undefined} />
        <Card label="Avg hold" value={s.avg_hold_days == null ? "—" : `${s.avg_hold_days}d`}
          sub={s.day_trade_count ? `${s.day_trade_count} same-day` : undefined}
          hint="Average days a position was held before closing (across trades with a known open date)." />
      </div>

      {s.count > 0 && (s.avg_win != null || s.avg_loss != null) && (
        <div style={S2.subStats}>
          {s.avg_win != null && <span>Avg win <b style={{ color: "var(--pos)" }}>{usd(s.avg_win)}</b></span>}
          {s.avg_loss != null && <span>Avg loss <b style={{ color: "var(--neg)" }}>{usd(s.avg_loss)}</b></span>}
          {s.best && <span>Best <b style={{ color: "var(--pos)" }}>{s.best.symbol} {usd(s.best.profit)}</b></span>}
          {s.worst && s.worst.profit < 0 && <span>Worst <b style={{ color: "var(--neg)" }}>{s.worst.symbol} {usd(s.worst.profit)}</b></span>}
          <CumulativeSpark trades={d.trades} />
        </div>
      )}

      {s.count > 0 && <StreakStats d={d} />}

      <Panel
        title="Closed trades"
        right={
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="field" placeholder="Filter symbol" value={sym}
              onChange={(e) => setSym(e.target.value.toUpperCase())} aria-label="Filter by symbol"
              style={{ height: 30, width: 120 }} />
            <PeriodSelector value={scope} onChange={setScope} year={year} />
            {d.trades.length > 0 && (
              <button className="btn btn-secondary btn-sm" title="Download these trades as CSV"
                onClick={() => downloadCsv(`${API}/ledger/trades.csv${qs(scope, sym)}`)}><IconDownload /> CSV</button>
            )}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              title="Closed round-trips for the year, formatted for tax filing (proceeds, cost basis, short/long-term)">
              <select className="field" style={{ height: 30, width: 78 }} value={taxYear}
                onChange={(e) => setTaxYear(Number(e.target.value))} aria-label="Tax year">
                {Array.from({ length: 6 }, (_, i) => year - i).map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" title="Download the tax-lot report for this year"
                onClick={() => downloadCsv(`${API}/ledger/tax-lots.csv?year=${taxYear}`)}><IconDownload /> Tax</button>
            </span>
          </span>
        }
      >
        {d.trades.length === 0 ? (
          <p style={S.fine}>No closed trades in this period{sym ? ` for ${sym.toUpperCase()}` : ""}.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="left">Closed</th><th className="left">Symbol</th>
                  <th>Shares</th><th>Buy</th><th>Sell</th><th>P/L</th><th className="left">Held</th>
                </tr>
              </thead>
              <tbody>
                {d.trades.map((t) => (
                  <tr key={t.id}>
                    <td className="left">{t.completed_at ?? "—"}</td>
                    <td className="left"><b>{t.symbol}</b></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{t.shares.toLocaleString()}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{usd(t.buy_price)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{usd(t.sell_price)}</td>
                    <td style={{ textAlign: "right", color: moneyColor(t.profit), fontVariantNumeric: "tabular-nums" }}>
                      {t.profit > 0 ? "+" : ""}{usd(t.profit)}
                    </td>
                    <td className="left">
                      {t.is_day_trade
                        ? <span className="tag" style={S2.dayTag}>same day</span>
                        : t.hold_days == null ? "—" : `${t.hold_days}d`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {d.by_symbol.length > 1 && (
        <Panel title="By symbol">
          <p style={S.fine}>Click a symbol for its full history in this period — every close, win rate, and cumulative P/L.</p>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr><th className="left">Symbol</th><th>Trades</th><th>Win rate</th><th>Total P/L</th></tr>
              </thead>
              <tbody>
                {d.by_symbol.map((r) => (
                  <Fragment key={r.symbol}>
                    <tr className="rowlink" tabIndex={0} role="button" aria-expanded={openSym === r.symbol}
                      aria-label={`${r.symbol} — ${openSym === r.symbol ? "hide" : "show"} its trade history`}
                      onClick={() => setOpenSym(openSym === r.symbol ? null : r.symbol)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenSym(openSym === r.symbol ? null : r.symbol); } }}>
                      <td className="left"><b>{r.symbol}</b> <span style={{ color: "var(--text-faint)" }} aria-hidden="true">{openSym === r.symbol ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}</span></td>
                      <td style={{ textAlign: "right" }}>{r.count}</td>
                      <td style={{ textAlign: "right" }}>{pct(r.win_rate)}</td>
                      <td style={{ textAlign: "right", color: moneyColor(r.total_profit), fontVariantNumeric: "tabular-nums" }}>
                        {r.total_profit > 0 ? "+" : ""}{usd(r.total_profit)}
                      </td>
                    </tr>
                    {openSym === r.symbol && (
                      <tr>
                        <td colSpan={4} style={{ padding: 0 }}>
                          <SymbolReport symbol={r.symbol} scope={scope} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

// Compact streak / best-worst-period / drawdown strip (W26-2). All values come
// precomputed from the backend; this only formats them.
function StreakStats({ d }: { d: TradeLog }) {
  const st = d.streaks;
  const p = d.periods;
  const dd = d.drawdown;
  const day = (ps: { period: string; profit: number } | null, label: string, neg = false) =>
    ps && (neg ? ps.profit < 0 : ps.profit > 0) ? (
      <span>{label} <b style={{ color: neg ? "var(--neg)" : "var(--pos)" }}>
        {ps.profit > 0 ? "+" : ""}{usd(ps.profit)}</b> <span style={ST.dim}>({ps.period})</span></span>
    ) : null;
  return (
    <div style={ST.wrap}>
      {st.longest_win > 0 && (
        <span title="Most consecutive winning trades in this period (in close order)">
          Longest win streak <b style={{ color: "var(--pos)" }}>{st.longest_win}</b>
          {st.current > 1 && <span style={ST.dim}> · {st.current} running</span>}
        </span>
      )}
      {st.longest_loss > 0 && (
        <span title="Most consecutive losing trades in this period">
          Longest loss streak <b style={{ color: "var(--neg)" }}>{st.longest_loss}</b>
        </span>
      )}
      {day(p.best_day, "Best day")}
      {day(p.worst_day, "Worst day", true)}
      {day(p.best_week, "Best week")}
      {day(p.worst_week, "Worst week", true)}
      {dd && dd.max_dd > 0 && (
        <span title={`Deepest fall from a balance peak in this span — hit ${dd.max_dd_date}. Current: how far today sits below the latest peak (${dd.peak_date}).`}>
          Max drawdown <b style={{ color: "var(--neg)" }}>-{usd(dd.max_dd)} ({(dd.max_dd_pct * 100).toFixed(1)}%)</b>
          {dd.current_dd > 0
            ? <span style={ST.dim}> · now -{usd(dd.current_dd)} below peak</span>
            : <span style={ST.dim}> · now at the peak</span>}
        </span>
      )}
    </div>
  );
}

// Inline per-symbol mini-report (W26-3): fetches the same journal filtered to one
// symbol and shows its numbers + cumulative sparkline + most recent closes.
function SymbolReport({ symbol, scope }: { symbol: string; scope: Period }) {
  const [d, setD] = useState<TradeLog | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setD(null);
    fetch(`${API}/ledger/trades${qs(scope, symbol)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) (j && !j.error ? setD(j) : setErr(j?.error || "Couldn't load.")); })
      .catch(() => { if (alive) setErr("Couldn't load — network error."); });
    return () => { alive = false; };
  }, [symbol, scope]);

  if (err) return <p style={{ ...S.fine, padding: "10px 14px" }}>{err}</p>;
  if (!d) return <p style={{ ...S.fine, padding: "10px 14px" }}>Loading {symbol}…</p>;
  const s = d.summary;
  const recent = d.trades.slice(0, 8);

  return (
    <div style={ST.report}>
      <div style={ST.reportStats}>
        <span>{s.count} closes</span>
        <span>Win rate <b>{pct(s.win_rate)}</b> <span style={ST.dim}>({s.wins}W/{s.losses}L)</span></span>
        <span>Total <b style={{ color: moneyColor(s.total_profit) }}>{s.total_profit > 0 ? "+" : ""}{usd(s.total_profit)}</b></span>
        {s.avg_hold_days != null && <span>Avg hold <b>{s.avg_hold_days}d</b></span>}
        {d.streaks.longest_win > 1 && <span>Best streak <b style={{ color: "var(--pos)" }}>{d.streaks.longest_win}</b></span>}
        <CumulativeSpark trades={d.trades} />
      </div>
      {recent.length > 0 && (
        <table className="tbl" style={{ marginTop: 8 }}>
          <thead>
            <tr><th className="left">Closed</th><th>Shares</th><th>Buy</th><th>Sell</th><th>P/L</th><th className="left">Held</th></tr>
          </thead>
          <tbody>
            {recent.map((t) => (
              <tr key={t.id}>
                <td className="left">{t.completed_at ?? "—"}</td>
                <td style={ST.num}>{t.shares.toLocaleString()}</td>
                <td style={ST.num}>{usd(t.buy_price)}</td>
                <td style={ST.num}>{usd(t.sell_price)}</td>
                <td style={{ ...ST.num, color: moneyColor(t.profit) }}>{t.profit > 0 ? "+" : ""}{usd(t.profit)}</td>
                <td className="left">{t.is_day_trade ? "same day" : t.hold_days == null ? "—" : `${t.hold_days}d`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.trades.length > recent.length && (
        <p style={{ ...S.fine, margin: "8px 0 0" }}>
          Showing the {recent.length} most recent of {d.trades.length} — use the symbol filter above for the full list.
        </p>
      )}
    </div>
  );
}

const ST: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", gap: 20, flexWrap: "wrap", fontSize: "var(--fs-sm)", margin: "10px 2px 0", color: "var(--text-muted)", alignItems: "center" },
  dim: { color: "var(--text-faint)", fontSize: "var(--fs-xs)" },
  report: { background: "var(--panel-2)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "12px 14px" },
  reportStats: { display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", fontSize: "var(--fs-sm)", color: "var(--text-muted)" },
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
};

// Tiny inline-SVG sparkline of cumulative realized P/L across the scoped closed
// trades (oldest → newest). Inline SVG (unlike canvas) resolves CSS vars, so it
// matches the theme. Line tinted by the ending sign; a dotted zero baseline anchors it.
function CumulativeSpark({ trades }: { trades: TradeLog["trades"] }) {
  const ordered = [...trades]
    .filter((t) => t.completed_at)
    .sort((a, b) => (a.completed_at! < b.completed_at! ? -1 : 1));
  if (ordered.length < 2) return null;
  let run = 0;
  const cum = ordered.map((t) => (run += t.profit));
  const W = 132, H = 30, pad = 2;
  const lo = Math.min(0, ...cum), hi = Math.max(0, ...cum);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (cum.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (H - 2 * pad);
  const pts = cum.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const end = cum[cum.length - 1];
  const stroke = end >= 0 ? "var(--pos)" : "var(--neg)";
  const zeroY = y(0).toFixed(1);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
      title={`Cumulative realized P/L across ${cum.length} closed trades (oldest → newest)`}>
      <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-faint)" }}>Cumulative</span>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ display: "block" }}>
        <line x1={pad} y1={zeroY} x2={W - pad} y2={zeroY} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 2" />
        <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}

const S2: Record<string, React.CSSProperties> = {
  subStats: { display: "flex", gap: 20, flexWrap: "wrap", fontSize: "var(--fs-md)", margin: "12px 2px 0", color: "var(--text-muted)", alignItems: "center" },
  dayTag: { color: "var(--accent-quiet)", border: "1px solid var(--border-strong)" },
};
