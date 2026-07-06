import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "./App";
import { EquityCurve } from "./EquityCurve";
import { SkeletonCards, SkeletonPanel } from "./Skeleton";
import { useToast } from "./Toast";
import {
  ALL_TIME, Card, Panel, PeriodSelector, Row, S, moneyColor, type Period,
} from "./LedgerUI";
import type { CashFlowRow, LedgerHistoric as Historic, MarginSummary } from "./types";

import { API } from "./api";
type CapGains = { rows: { period: string; cap_gains: number; trade_count: number }[]; total_cap_gains: number };
type Benchmark = {
  available: boolean; reason?: string; symbol?: string;
  your_value?: number; benchmark_value?: number;
  your_xirr_pct?: number | null; benchmark_xirr_pct?: number | null;
  series?: { day: string; value: number }[];
};
type DivRow = { day: string; amount: number; symbol: string | null; type?: string; schwab_txn_id?: string | null };
type Dividends = { rows: DivRow[]; summary: { total: number; ytd: number | null; year: number | null; count: number } };

const pillBtn = (active: boolean): React.CSSProperties => ({
  background: active ? "var(--accent)" : "transparent",
  color: active ? "#fff" : "var(--text-muted)",
  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
});

const qs = (p: Period) => {
  const q = new URLSearchParams();
  if (p.from) q.set("start", p.from);
  if (p.to) q.set("end", p.to);
  const s = q.toString();
  return s ? `?${s}` : "";
};

export function LedgerHistoric() {
  const year = new Date().getFullYear();
  const [scope, setScope] = useState<Period>(ALL_TIME);
  const [h, setH] = useState<Historic | null>(null);
  const [cg, setCg] = useState<CapGains | null>(null);
  const [bench, setBench] = useState<Benchmark | null>(null);
  const [div, setDiv] = useState<Dividends | null>(null);
  const [margin, setMargin] = useState<MarginSummary | null>(null);
  const [cgGrain, setCgGrain] = useState<"month" | "week">("month");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const seqRef = useRef(0);
  const load = useCallback(() => {
    const q = qs(scope);
    const my = ++seqRef.current; // ignore responses from a superseded scope/refresh
    fetch(`${API}/ledger/historic${q}`)
      .then((r) => r.json())
      .then((j) => { if (seqRef.current === my) (j && !j.error && j.now ? (setH(j), setErr(null)) : setErr(j?.error || "Couldn't load the ledger.")); })
      .catch(() => { if (seqRef.current === my) setErr("Couldn't load the ledger — network error."); });
    fetch(`${API}/ledger/cap-gains?grain=${cgGrain}${q ? "&" + q.slice(1) : ""}`)
      .then((r) => r.json())
      .then((j) => { if (seqRef.current === my && j && !j.error && Array.isArray(j.rows)) setCg(j); })
      .catch(() => {});
    // Capital & margin is account-level "right now" (not period-scoped), but reload it
    // with the ledger so a refresh/account switch keeps it in sync.
    fetch(`${API}/account/margin`)
      .then((r) => r.json())
      .then((j) => { if (seqRef.current === my && j) setMargin(j); })
      .catch(() => {});
    // Benchmark is all-time + account-level (not scope-dependent), but reload it alongside
    // so an account switch refreshes it. Fails soft: available:false just hides the card.
    fetch(`${API}/ledger/benchmark`)
      .then((r) => r.json())
      .then((j) => { if (seqRef.current === my && j) setBench(j); })
      .catch(() => {});
    // Dividends are account-level all-time (not scope-dependent); reload with the ledger.
    fetch(`${API}/ledger/dividends`)
      .then((r) => r.json())
      .then((j) => { if (seqRef.current === my && j) setDiv(j); })
      .catch(() => {});
  }, [scope, cgGrain]);

  const importDividendsCsv = (file: File) => {
    setBusy(true);
    file.text()
      .then((csv) => fetch(`${API}/ledger/dividends/import`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }),
      }).then((r) => r.json()))
      .then((j) => {
        if (!j?.ok) { toast(j?.error || "Couldn't import that file.", "error"); return; }
        toast(j.added ? `Imported ${j.added} dividend${j.added === 1 ? "" : "s"}.` : (j.note || "No dividend rows found in that file."), j.added ? "success" : "info");
        if (j.added) load();
      })
      .catch(() => toast("Couldn't read that file.", "error"))
      .finally(() => setBusy(false));
  };

  const refreshDividends = () => {
    setBusy(true);
    fetch(`${API}/ledger/dividends/refresh`, { method: "POST" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) toast(j.added ? `Pulled ${j.added} dividend${j.added === 1 ? "" : "s"} from Schwab.` : "No new dividends in the last 60 days.", "info");
        else toast(j?.error || "Couldn't reach Schwab for dividends.", "error");
        load();
      })
      .catch(() => toast("Couldn't reach Schwab for dividends.", "error"))
      .finally(() => setBusy(false));
  };

  useEffect(() => { load(); }, [load]);

  const refreshDeposits = () => {
    setBusy(true);
    fetch(`${API}/ledger/cashflows/refresh`, { method: "POST" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) toast(j.added ? `Pulled ${j.added} transfer${j.added === 1 ? "" : "s"} from Schwab.` : "No new transfers in the last 60 days.", "info");
        else toast(j?.error || "Couldn't reach Schwab for transfers.", "error");
        load();
      })
      .catch(() => toast("Couldn't reach Schwab for transfers.", "error"))
      .finally(() => setBusy(false));
  };

  const importCsv = (file: File) => {
    setBusy(true);
    file.text()
      .then((csv) =>
        fetch(`${API}/ledger/cashflows/import`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        }).then((r) => r.json()))
      .then((j) => {
        if (!j?.ok) { toast(j?.error || "Couldn't import that file.", "error"); return; }
        const parts = [`Imported ${j.added} transfer${j.added === 1 ? "" : "s"}`];
        if (j.skipped_existing) parts.push(`${j.skipped_existing} already logged`);
        toast(j.added || j.skipped_existing ? parts.join(" · ") : (j.note || "No transfer rows found in that file."),
          j.added ? "success" : "info");
        if (j.added) load();
      })
      .catch(() => toast("Couldn't read that file.", "error"))
      .finally(() => setBusy(false));
  };

  const addManual = (day: string, amount: number, memo: string) => {
    setBusy(true);
    fetch(`${API}/ledger/cashflows`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day, amount, memo: memo || null }),
    })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) { toast("Entry added.", "success"); load(); } else toast(j?.error || "Couldn't add entry.", "error"); })
      .catch(() => toast("Couldn't add entry.", "error"))
      .finally(() => setBusy(false));
  };

  const delRow = (id: number) => {
    fetch(`${API}/ledger/cashflows/${id}`, { method: "DELETE" })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) load(); else toast("Couldn't delete entry.", "error"); })
      .catch(() => toast("Couldn't delete entry.", "error"));
  };

  if (err) return <p style={S.note}>{err}</p>;
  if (!h) return <div><SkeletonCards n={4} /><SkeletonPanel /></div>;

  const now = h.now;
  const r = h.realized;
  const scoped = !!(scope.from || scope.to);

  return (
    <div>
      {/* ---- Right now (live, point-in-time) ---- */}
      <div style={S.panelHead}>
        <h3 className="section-title" style={{ margin: "6px 0 0" }}>Right now</h3>
        <span style={S.periodShow}>
          {now.source === "live" ? "live from Schwab"
            : now.source === "snapshot" ? `last snapshot ${now.as_of_snapshot ?? ""}`
            : "unavailable"}
        </span>
      </div>
      <div style={S.cards}>
        <Card label="Account value" value={usd(now.account_value)} big
          hint="Schwab liquidationValue — what the account is worth if fully liquidated right now (point-in-time, mark-to-market)." />
        <Card label="Invested" value={usd(now.invested_market)}
          sub={`cost ${usd(now.invested_cost)} · unreal ${usd(now.unrealized_pl)}`}
          hint="Market value of open lots (cost basis + unrealized P/L). Cost basis for shares older than the fill window is Schwab's average, not the exact entry." />
        <Card label="Cash" value={usd(now.cash)}
          hint="Schwab cashBalance — settled cash. This is the conservative 'free to invest' figure (no margin)." />
        <Card label="Buying power" value={usd(now.buying_power)}
          sub={now.buying_power == null ? undefined : now.margin_buying_power != null ? `margin ${usd(now.margin_buying_power)}` : "incl. available margin"}
          hint="Schwab buyingPower — cash plus available margin. Fluctuates intraday with prices and Reg-T; a live snapshot, not a fixed limit." />
      </div>
      {now.source !== "live" && (
        <p style={S.warn}>Live balances unavailable{now.note ? ` (${now.note})` : ""} — showing the last saved snapshot. Reconnect under Settings → Schwab connection.</p>
      )}

      {/* ---- Since inception (all-time performance headline) ---- */}
      {h.contributions_recorded > 0 && h.gain_vs_contributed != null && (
        <>
          <div style={S.panelHead}>
            <h3 className="section-title" style={{ margin: "14px 0 0" }}>Since inception</h3>
          </div>
          <div style={S.cards}>
            <Card label="Deposited" value={usd(h.deposited_all_time)}
              hint="Gross capital you've put in (all time). Withdrawals never reduce this — it's the base for return %." />
            <Card label="Current value" value={usd(now.account_value)}
              sub={h.withdrawn_all_time < 0 ? `+ ${usd(-h.withdrawn_all_time)} already withdrawn` : undefined}
              hint="What the account is worth right now (live liquidation value)." />
            <Card label="Total gain" value={usd(h.gain_vs_contributed)} accent={moneyColor(h.gain_vs_contributed)}
              sub={h.roi_pct != null ? `${h.roi_pct > 0 ? "+" : ""}${h.roi_pct}% simple ROI` : undefined}
              hint="Value now + everything withdrawn − everything deposited. Simple ROI divides that by gross deposits (ignores timing)." />
            <Card label="Annualized (XIRR)"
              value={h.xirr_pct != null ? `${h.xirr_pct > 0 ? "+" : ""}${h.xirr_pct}%` : "—"}
              accent={h.xirr_pct != null ? moneyColor(h.xirr_pct) : undefined}
              sub={h.xirr_pct != null ? "per year, money-weighted" : "needs ~1 month of history"}
              hint="Money-weighted annual return: the single rate that values every dated deposit/withdrawal plus today's balance to zero. Unlike simple ROI, it accounts for WHEN money went in — the fair way to compare against a benchmark." />
            {bench?.available && bench.benchmark_value != null && <BenchmarkCard b={bench} />}
          </div>
          {bench?.available && bench.benchmark_value != null && (
            <p style={S.fine}>
              "If it were all {bench.symbol}" invests your exact deposits (same dates, same amounts) into{" "}
              {bench.symbol} buy-and-hold instead — an honest yardstick for whether the active strategy is
              earning its keep.
            </p>
          )}
        </>
      )}

      {/* ---- Capital & margin (deployment / leverage, live) ---- */}
      {margin && !margin.blocked && <MarginPanel m={margin} />}

      {/* ---- Realized + contributions, scoped ---- */}
      <Panel title="Realized & capital" right={<PeriodSelector value={scope} onChange={setScope} year={year} />}>
        <Row k={`Realized capital gains${scoped ? "" : " (all time)"}`} v={usd(r.cap_gains)} hi
          accent={moneyColor(r.cap_gains)} sub={scope.label} />
        <Row k="Trades" v={String(r.trade_count)} sub={`${r.day_trade_count} day-trades`} />
        <Row k="Gross proceeds" v={usd(r.gross_proceeds)} />
        <Row k="Cost basis" v={usd(r.cost_basis)} />
        <Row k="Deposited (all time)" v={usd(h.deposited_all_time)}
          sub={`${h.contributions_recorded} entr${h.contributions_recorded === 1 ? "y" : "ies"} · the ROI base`} />
        {h.withdrawn_all_time < 0 && (
          <Row k="Withdrawn (all time)" v={usd(h.withdrawn_all_time)}
            sub="returned capital — shown for reference, doesn't reduce the deposited base" />
        )}
        {h.gain_vs_contributed != null && (
          <Row k="Total gain vs. deposited" v={usd(h.gain_vs_contributed)} hi accent={moneyColor(h.gain_vs_contributed)}
            sub={[
              h.roi_pct != null ? `${h.roi_pct > 0 ? "+" : ""}${h.roi_pct}% on deposits` : null,
              h.withdrawn_all_time < 0 ? `incl. ${usd(-h.withdrawn_all_time)} withdrawn added back` : null,
              now.source !== "live" ? `based on last snapshot${now.as_of_snapshot ? " " + now.as_of_snapshot : ""}` : null,
            ].filter(Boolean).join(" · ") || undefined} />
        )}
      </Panel>

      {/* ---- Deposit log ---- */}
      <Panel
        title="Outside money (deposits & withdrawals)"
        right={
          <span style={{ display: "flex", gap: 6 }}>
            <label className="btn btn-secondary btn-sm" style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
              title="Import a Schwab transactions CSV export (full history)">
              ⬆ Import CSV
              <input type="file" accept=".csv,text/csv" disabled={busy} style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
            </label>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={refreshDeposits}>↻ Pull from Schwab (60d)</button>
            {h.contributions.rows.length > 0 && (
              <button className="btn btn-secondary btn-sm" title="Download these deposits as CSV"
                onClick={() => { const a = document.createElement("a"); a.href = `${API}/ledger/cashflows.csv${qs(scope)}`; a.rel = "noopener"; a.click(); }}>⬇ CSV</button>
            )}
          </span>
        }
      >
        <div style={S2.cfSummary}>
          <span>Deposits <b style={{ color: "var(--pos)" }}>{usd(h.contributions.deposits)}</b></span>
          <span>Withdrawals <b style={{ color: h.contributions.withdrawals < 0 ? "var(--neg)" : "var(--text)" }}>{usd(h.contributions.withdrawals)}</b></span>
          <span>Net <b>{usd(h.contributions.net)}</b></span>
          <span style={{ color: "var(--text-faint)" }}>{scope.label}</span>
        </div>
        {h.capital_by_year.length > 0 && (
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table className="tbl">
              <thead>
                <tr><th className="left">Year</th><th>Deposits</th><th>Withdrawals</th><th>Net</th></tr>
              </thead>
              <tbody>
                {h.capital_by_year.map((y) => (
                  <tr key={y.year}>
                    <td className="left">{y.year}</td>
                    <td style={{ textAlign: "right", color: "var(--pos)", fontVariantNumeric: "tabular-nums" }}>{usd(y.deposits)}</td>
                    <td style={{ textAlign: "right", color: y.withdrawals < 0 ? "var(--neg)" : "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>{usd(y.withdrawals)}</td>
                    <td style={{ textAlign: "right", color: moneyColor(y.net), fontVariantNumeric: "tabular-nums" }}>{usd(y.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {h.contributions.rows.length === 0 ? (
          <p style={S.fine}>No transfers recorded in this period. Use "Pull from Schwab" for the last 60 days, or add older ones manually below.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr><th className="left">Date</th><th className="left">Type</th><th>Amount</th><th className="left">Source</th><th></th></tr>
              </thead>
              <tbody>
                {h.contributions.rows.map((cf: CashFlowRow) => (
                  <tr key={cf.id}>
                    <td className="left">{cf.day}</td>
                    <td className="left" style={{ textTransform: "capitalize" }}>{cf.kind}{cf.memo ? ` · ${cf.memo}` : ""}</td>
                    <td style={{ textAlign: "right", color: moneyColor(cf.amount), fontVariantNumeric: "tabular-nums" }}>
                      {cf.amount > 0 ? "+" : ""}{usd(cf.amount)}
                    </td>
                    <td className="left">
                      <span className="tag" style={cf.source === "schwab" ? S2.tagSchwab : S2.tagManual}>
                        {cf.source === "schwab" ? "Schwab" : cf.source === "csv" ? "CSV" : "you"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {cf.source !== "schwab" && (
                        <button className="btn btn-ghost btn-sm" title="Delete entry" aria-label={`Delete ${cf.day} entry`} onClick={() => delRow(cf.id)}>✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ManualEntry busy={busy} onAdd={addManual} />
        <p style={S.fine}>
          Schwab's live pull only exposes the trailing <b>{h.contributions.schwab_window_days} days</b> of transfers. For the
          full history, export your account's <b>Transactions</b> CSV from Schwab and use <b>Import CSV</b> — only transfer/wire
          rows are taken, and imports are deduped by date + amount, so re-importing (or overlapping the 60-day pull) is safe.
          You can also add older transfers by hand below.
        </p>
      </Panel>

      {/* ---- Dividends / income ---- */}
      <Panel
        title="Dividends & income"
        right={
          <span style={{ display: "flex", gap: 6 }}>
            <label className="btn btn-secondary btn-sm" style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
              title="Import a Schwab Transactions CSV export (full dividend history)">
              ⬆ Import CSV
              <input type="file" accept=".csv,text/csv" disabled={busy} style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importDividendsCsv(f); e.target.value = ""; }} />
            </label>
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={refreshDividends}>↻ Pull from Schwab (60d)</button>
          </span>
        }
      >
        <div style={S2.cfSummary}>
          <span>All-time <b style={{ color: "var(--pos)" }}>{usd(div?.summary.total ?? 0)}</b></span>
          <span>This year <b style={{ color: "var(--pos)" }}>{usd(div?.summary.ytd ?? 0)}</b></span>
          <span style={{ color: "var(--text-faint)" }}>{div?.summary.count ?? 0} payment{(div?.summary.count ?? 0) === 1 ? "" : "s"}</span>
        </div>
        {div && div.rows.length > 0 && <TopPayers rows={div.rows} />}
        {div && div.rows.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead><tr><th className="left">Date</th><th className="left">Symbol</th><th>Amount</th></tr></thead>
              <tbody>
                {div.rows.slice(0, 30).map((d, i) => (
                  <tr key={`${d.schwab_txn_id ?? i}-${d.day}`}>
                    <td className="left">{d.day}</td>
                    <td className="left"><b>{d.symbol ?? "—"}</b></td>
                    <td style={{ textAlign: "right", color: "var(--pos)", fontVariantNumeric: "tabular-nums" }}>+{usd(d.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={S.fine}>No dividends recorded yet. Use "Pull from Schwab" for the last 60 days; repeat over time to accumulate history.</p>
        )}
        <p style={S.fine}>
          Dividends are paid as cash into the account, so they're <b>already included</b> in your account value
          and returns above — this view breaks out how much of that came from income. Schwab exposes only the
          trailing 60 days per pull, so pull periodically to build the record.
        </p>
      </Panel>

      {/* ---- Account value over time (nightly snapshots, scoped) ---- */}
      <Panel title="Account value over time">
        <EquityCurve series={h.series}
          benchmark={bench?.available ? bench.series : undefined}
          benchmarkLabel={bench?.symbol} />
      </Panel>

      {/* ---- Capital gains by period (scoped) ---- */}
      {cg && cg.rows.length > 0 && (
        <Panel title={`Capital gains by ${cgGrain}`}
          right={
            <span role="group" aria-label="Bucket size" style={{ display: "flex", gap: 6 }}>
              {(["month", "week"] as const).map((g) => (
                <button key={g} className="btn btn-sm" style={pillBtn(cgGrain === g)}
                  aria-pressed={cgGrain === g} onClick={() => setCgGrain(g)}>
                  {g === "month" ? "Monthly" : "Weekly"}
                </button>
              ))}
            </span>
          }>
          <MonthlyBars rows={cg.rows} />
        </Panel>
      )}
    </div>
  );
}

// "If it were all SPY": what the same dated deposits would be worth in the benchmark,
// with the value tinted by whether the active strategy is ahead of (green) or behind
// (red) simply holding the index.
function BenchmarkCard({ b }: { b: Benchmark }) {
  const yours = b.your_value ?? 0;
  const idx = b.benchmark_value ?? 0;
  const diff = yours - idx;
  const ahead = diff >= 0;
  const xirr = b.benchmark_xirr_pct;
  const sub = [
    xirr != null ? `${xirr > 0 ? "+" : ""}${xirr}%/yr` : null,
    `you're ${ahead ? "ahead" : "behind"} by ${usd(Math.abs(diff))}`,
  ].filter(Boolean).join(" · ");
  return (
    <Card label={`If it were all ${b.symbol}`} value={usd(idx)}
      accent={ahead ? "var(--pos)" : "var(--neg)"} sub={sub}
      hint={`What your exact deposits (same dates, same amounts) would be worth today in ${b.symbol} buy-and-hold. Colored by whether your active strategy is ahead of (green) or behind (red) just holding the index.`} />
  );
}

// Top dividend payers by total received — a quick "who's paying me" glance.
function TopPayers({ rows }: { rows: DivRow[] }) {
  const bySym = new Map<string, number>();
  for (const d of rows) bySym.set(d.symbol || "—", (bySym.get(d.symbol || "—") ?? 0) + d.amount);
  const top = [...bySym.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length < 2) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", margin: "0 0 10px", fontSize: "var(--fs-xs)", color: "var(--text-dim)" }}>
      <span style={{ color: "var(--text-faint)" }}>Top payers:</span>
      {top.map(([s, v]) => <span key={s}><b style={{ color: "var(--text-muted)" }}>{s}</b> {usd(v)}</span>)}
    </div>
  );
}

function MarginPanel({ m }: { m: MarginSummary }) {
  const pct = (x?: number | null) => (x == null ? "—" : `${x.toFixed(1)}%`);
  const dep = m.deployed_pct ?? null;
  // Deployment bar tint: green when there's dry powder, amber as it fills, red near the cap.
  const depColor = dep == null ? "var(--text-faint)" : dep >= 90 ? "var(--neg-strong)" : dep >= 70 ? "var(--warn)" : "var(--pos-strong)";
  const cushionLow = m.maint_cushion_pct != null && m.maint_cushion_pct < 25;
  return (
    <Panel title={m.is_margin ? "Capital & margin" : "Capital deployment"}>
      {dep != null && (
        <div style={{ margin: "2px 0 12px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-sm)", marginBottom: 5 }}>
            <span style={{ color: "var(--text-muted)" }}>Deployed — market value vs. total capacity</span>
            <b style={{ color: depColor, fontVariantNumeric: "tabular-nums" }}>{pct(dep)}</b>
          </div>
          <div style={{ background: "var(--border-hairline)", borderRadius: "var(--r-sm)", height: 10, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(dep, 100)}%`, background: depColor }} />
          </div>
        </div>
      )}
      <Row k="Long market value" v={usd(m.long_market_value)} sub="what's in the market right now" />
      <Row k="Buying power" v={usd(m.buying_power)}
        sub={m.margin_buying_power != null ? `margin ${usd(m.margin_buying_power)}` : "room left to deploy"} />
      {m.is_margin && (
        <>
          <Row k="Equity (your money)" v={usd(m.equity)} />
          <Row k="Debt (borrowed)" v={usd(m.debt)} accent={m.debt ? "var(--neg)" : undefined}
            sub={m.debt ? "margin loan carried against positions" : "no margin loan"} />
          <Row k="Leverage" v={m.leverage == null ? "—" : `${m.leverage.toFixed(2)}×`}
            accent={m.leverage != null && m.leverage > 1.5 ? "var(--warn)" : undefined}
            sub="long exposure ÷ equity (1.0× = unlevered)" />
          <Row k="Maintenance cushion" v={usd(m.maint_cushion)} accent={cushionLow ? "var(--neg)" : undefined}
            sub={m.maint_cushion_pct != null ? `${pct(m.maint_cushion_pct)} above the maintenance floor` : "equity above Schwab's maintenance requirement"} />
          {cushionLow && <p style={S.warn}>Maintenance cushion is thin — a further drop could trigger a margin call. Consider trimming leverage.</p>}
        </>
      )}
      <p style={S.fine}>Live from Schwab, point-in-time and mark-to-market. Buying power and margin figures drift intraday with prices and Reg-T.</p>
    </Panel>
  );
}

function ManualEntry({ busy, onAdd }: { busy: boolean; onAdd: (day: string, amount: number, memo: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(today);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const submit = () => {
    const amt = parseFloat(amount);
    if (!day || !Number.isFinite(amt) || amt === 0) return;
    onAdd(day, amt, memo);
    setAmount(""); setMemo(""); setOpen(false);
  };
  if (!open) return <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>+ Add a deposit / withdrawal</button>;
  return (
    <div style={S2.form}>
      <input type="date" className="field" value={day} max={today} onChange={(e) => setDay(e.target.value)} style={{ height: 32 }} aria-label="Date" />
      <input type="number" className="field" placeholder="Amount (+dep / −wd)" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ height: 32, width: 150 }} aria-label="Amount" />
      <input type="text" className="field" placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} style={{ height: 32, flex: 1, minWidth: 120 }} aria-label="Memo" />
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={submit}>Add</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  );
}

function MonthlyBars({ rows }: { rows: { period: string; cap_gains: number; trade_count: number }[] }) {
  const max = Math.max(...rows.map((x) => Math.abs(x.cap_gains)), 1);
  return (
    <div>
      {rows.map((m) => (
        <div key={m.period} style={S2.barRow}>
          <span style={S2.barLabel}>{m.period}</span>
          <div style={S2.barTrack}>
            <div style={{ ...S2.barFill, width: `${(Math.abs(m.cap_gains) / max) * 100}%`, background: m.cap_gains >= 0 ? "var(--pos-strong)" : "var(--neg-strong)" }} />
          </div>
          <span style={{ ...S2.barVal, color: moneyColor(m.cap_gains) }}>{usd(m.cap_gains)}</span>
          <span style={S2.barTrades}>{m.trade_count} trades</span>
        </div>
      ))}
    </div>
  );
}

const S2: Record<string, React.CSSProperties> = {
  form: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12, padding: 12, background: "var(--panel-2)", borderRadius: "var(--r-md)" },
  barRow: { display: "flex", alignItems: "center", gap: 12, padding: "5px 0" },
  barLabel: { width: 64, fontSize: "var(--fs-sm)", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" },
  barTrack: { flex: 1, background: "var(--border-hairline)", borderRadius: "var(--r-sm)", height: 18, overflow: "hidden" },
  barFill: { height: "100%" },
  barVal: { width: 96, textAlign: "right", fontSize: "var(--fs-sm)", fontVariantNumeric: "tabular-nums" },
  barTrades: { width: 70, textAlign: "right", fontSize: "var(--fs-xs)", color: "var(--text-faint)" },
  cfSummary: { display: "flex", gap: 20, flexWrap: "wrap", fontSize: "var(--fs-md)", marginBottom: 10 },
  tagSchwab: { color: "var(--accent-quiet)", border: "1px solid #3a4a5a" },
  tagManual: { color: "var(--text-dim)", border: "1px solid var(--border)" },
};
