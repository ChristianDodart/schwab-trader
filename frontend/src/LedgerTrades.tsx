import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "./App";
import { SkeletonCards, SkeletonPanel } from "./Skeleton";
import { ALL_TIME, Card, Panel, PeriodSelector, S, moneyColor, type Period } from "./LedgerUI";
import type { TradeLog } from "./types";

import { API } from "./api";

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

export function LedgerTrades() {
  const year = new Date().getFullYear();
  const [scope, setScope] = useState<Period>(ALL_TIME);
  const [sym, setSym] = useState("");
  const [d, setD] = useState<TradeLog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(() => {
    const my = ++seqRef.current;
    setD(null);
    fetch(`${API}/ledger/trades${qs(scope, sym)}`)
      .then((r) => r.json())
      .then((j) => { if (seqRef.current === my) (j && !j.error ? (setD(j), setErr(null)) : setErr(j?.error || "Couldn't load trades.")); })
      .catch(() => { if (seqRef.current === my) setErr("Couldn't load trades — network error."); });
  }, [scope, sym]);
  useEffect(() => { load(); }, [load]);

  if (err) return <p style={S.note}>{err}</p>;
  if (!d) return <div><SkeletonCards n={4} /><SkeletonPanel /></div>;

  const s = d.summary;
  const winStr = s.count ? `${pct(s.win_rate)} · ${s.wins}W/${s.losses}L` : "—";

  return (
    <div>
      <div style={S.cards}>
        <Card label="Win rate" value={winStr} big
          hint="Share of closed trades that were profitable, with the win/loss split." />
        <Card label="Total realized P/L" value={usd(s.total_profit)} accent={moneyColor(s.total_profit)}
          sub={s.count ? `${s.count} trade${s.count === 1 ? "" : "s"}` : undefined} />
        <Card label="Profit factor" value={s.profit_factor == null ? "—" : `${s.profit_factor.toFixed(2)}×`}
          hint="Gross wins ÷ gross losses. Above 1.0 = profitable overall; higher is better. '—' means no losing trades yet." />
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
        </div>
      )}

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
                onClick={() => downloadCsv(`${API}/ledger/trades.csv${qs(scope, sym)}`)}>⬇ CSV</button>
            )}
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
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr><th className="left">Symbol</th><th>Trades</th><th>Win rate</th><th>Total P/L</th></tr>
              </thead>
              <tbody>
                {d.by_symbol.map((r) => (
                  <tr key={r.symbol}>
                    <td className="left"><b>{r.symbol}</b></td>
                    <td style={{ textAlign: "right" }}>{r.count}</td>
                    <td style={{ textAlign: "right" }}>{pct(r.win_rate)}</td>
                    <td style={{ textAlign: "right", color: moneyColor(r.total_profit), fontVariantNumeric: "tabular-nums" }}>
                      {r.total_profit > 0 ? "+" : ""}{usd(r.total_profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

const S2: Record<string, React.CSSProperties> = {
  subStats: { display: "flex", gap: 20, flexWrap: "wrap", fontSize: "var(--fs-md)", margin: "12px 2px 0", color: "var(--text-muted)" },
  dayTag: { color: "var(--accent-quiet)", border: "1px solid #3a4a5a" },
};
