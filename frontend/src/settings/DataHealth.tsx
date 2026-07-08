import { useEffect, useState } from "react";
import { useToast } from "../Toast";
import { API } from "../api";
import { Hint } from "../Hint";
import { SS } from "./ui";

type HealthReport = {
  ok: boolean;
  fill_ledger: { total: number; by_source: Record<string, number>; earliest: string | null; latest: string | null };
  projection: { open_lots: number; synthetic_lots: { symbol: string; shares: number }[]; completed_trades: number; earliest_completed: string | null };
  position_diffs: { symbol: string; reconstructed: number; actual: number; diff: number }[];
  short_positions?: { symbol: string; shares: number }[];
  shorts?: { sell_short_fills: number; cover_fills: number; net_cash: number } | null;
  basis_diffs?: { symbol: string; our_cost: number; schwab_basis: number; diff: number; count_matches?: boolean }[];
  cash_check?: {
    expected_cash: number; actual_cash: number; residual: number; residual_pct_of_flow: number;
    components: { net_deposits: number; trading_net: number; short_net?: number; income: number; other_cash?: number; margin_debt?: number };
    caveats: string;
  } | null;
  positions_checked: boolean;
  recommendations: string[];
};

// Data-integrity panel: fill-ledger coverage + gaps, and the ONE-FILE intake — a
// Schwab Transactions CSV routes trades/deposits/dividends in a single upload.
export function DataHealth() {
  const toast = useToast();
  const [h, setH] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const load = () => {
    fetch(`${API}/data/health`).then((r) => r.json())
      .then((j) => setH(j?.ok ? j : null)).catch(() => setH(null));
  };
  useEffect(load, []);

  const onFile = (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setSummary(null);
    file.text()
      .then((csv) => fetch(`${API}/data/import-csv`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }),
      }))
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) { toast(j?.error || "Couldn't import the file.", "error"); return; }
        const t = j.trades || {};
        const parts = [
          `${t.added ?? 0} trades added${t.skipped_known ? ` (${t.skipped_known} already known)` : ""}`,
          `${j.cashflows?.added ?? 0} deposits/withdrawals`,
          `${j.dividends?.added ?? 0} dividends`,
        ];
        if (t.removed_stale) parts.push(`${t.removed_stale} outdated stored row${t.removed_stale === 1 ? "" : "s"} cleaned up`);
        if (t.splits) parts.push(`${t.splits} reverse split${t.splits === 1 ? "" : "s"} applied`);
        if (t.unmatched_splits) parts.push(`${t.unmatched_splits} split row(s) UNMATCHED — tell support`);
        if (t.shorts_excluded) parts.push(`${t.shorts_excluded} short-sale rows excluded (long-only; covering buys netted out)`);
        const others = Object.entries(j.other_actions || {});
        if (others.length) parts.push(`skipped: ${others.map(([k, v]) => `${k} ×${v}`).join(", ")}`);
        setSummary(parts.join(" · "));
        toast(t.added ? "History imported — ladder and realized trades re-projected." : "Nothing new in this file — already fully imported.", "success");
        load();
      })
      .catch(() => toast("Import failed — network error.", "error"))
      .finally(() => setBusy(false));
  };

  const led = h?.fill_ledger;
  const proj = h?.projection;
  return (
    <div>
      {h ? (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
            <span>Fill history <b style={{ color: "var(--text)" }}>{led!.total.toLocaleString()}</b>
              {led!.total > 0 && <> · {Object.entries(led!.by_source).map(([s, n]) => `${n} ${s}`).join(" + ")}</>}
            </span>
            {led!.earliest && <span>covers <b style={{ color: "var(--text)" }}>{led!.earliest} → {led!.latest}</b></span>}
            <span>Realized trades <b style={{ color: "var(--text)" }}>{proj!.completed_trades.toLocaleString()}</b>
              {proj!.earliest_completed && <> (since {proj!.earliest_completed})</>}</span>
          </div>
          {proj!.synthetic_lots.length > 0 && (
            <p style={{ ...SS.credStatus, color: "var(--warn)" }}>
              {proj!.synthetic_lots.length} holding{proj!.synthetic_lots.length === 1 ? "" : "s"} ({proj!.synthetic_lots.map((l) => l.symbol).join(", ")}) partly
              predate the stored history — shown as "prior holdings" lots until older trades are imported.
            </p>
          )}
          {h.position_diffs.length > 0 && (
            <p style={{ ...SS.credStatus, color: "var(--warn)" }}>
              Share-count differences vs Schwab: {h.position_diffs.map((d) => `${d.symbol} ${d.diff > 0 ? "+" : ""}${d.diff}`).join(", ")} — a resync or CSV import usually resolves this.
            </p>
          )}
          {(h.short_positions?.length ?? 0) > 0 && (
            <p style={SS.credStatus}
              title="This app tracks the long-only ladder; short selling isn't modeled. The short is shown here so it doesn't read as missing data — its P/L is also excluded from the cash cross-check.">
              Open short position{h.short_positions!.length === 1 ? "" : "s"} at Schwab: {h.short_positions!.map((s) => `${s.symbol} ${s.shares.toLocaleString()} sh`).join(", ")} — outside the long-only ladder (informational).
            </p>
          )}
          {h.shorts && (h.shorts.sell_short_fills > 0 || h.shorts.cover_fills > 0) && (
            <p style={SS.credStatus}
              title="Short-sale and covering fills are tracked for the cash cross-check but kept out of the long-only Trades and Activity totals, so they can't distort those figures.">
              Short activity: {h.shorts.sell_short_fills} sell-short + {h.shorts.cover_fills} cover fill{h.shorts.cover_fills === 1 ? "" : "s"}, net cash {h.shorts.net_cash >= 0 ? "+" : ""}{h.shorts.net_cash.toLocaleString("en-US", { style: "currency", currency: "USD" })} — counted in the cash check, excluded from Trades/Activity totals.
            </p>
          )}
          {(h.basis_diffs?.some((b) => !b.count_matches) ?? false) && (
            <p style={{ ...SS.credStatus, color: "var(--warn)" }}>
              Cost basis differs from Schwab: {h.basis_diffs!.filter((b) => !b.count_matches).map((b) => `${b.symbol} ${b.diff > 0 ? "+" : "-"}$${Math.abs(b.diff).toFixed(0)}`).join(", ")} — usually an estimated backfill; a CSV covering those buys fixes it exactly.
            </p>
          )}
          {(h.basis_diffs?.some((b) => b.count_matches) ?? false) && (
            <p style={SS.credStatus}
              title="Same trades, different surviving lots: this app assigns sells to the newest lots (LIFO — the ladder strategy), while Schwab's remaining-cost figure follows your account's tax-lot election (often FIFO). With share counts matching, nothing is missing.">
              Lot-accounting note on {h.basis_diffs!.filter((b) => b.count_matches).map((b) => `${b.symbol} (${b.diff > 0 ? "+" : "-"}$${Math.abs(b.diff).toFixed(0)})`).join(", ")}: share counts match Schwab exactly; the cost difference is LIFO (this app) vs your Schwab tax-lot method. Informational — hover for the why.
            </p>
          )}
          {h.cash_check && (() => {
            const c = h.cash_check.components;
            const $ = (n: number | undefined) => (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
            const breakdown = `Expected = deposits ${$(c.net_deposits)} + trading net ${$(c.trading_net)} (incl. shorts ${$(c.short_net)}) + income ${$(c.income)} + other cash rows ${$(c.other_cash)}. Actual = cash minus margin debt (${$(c.margin_debt)}). Advisory — ${h.cash_check.caveats}.`;
            return (
              <p style={SS.credStatus}>
                Cash cross-check vs Schwab:{" "}
                <b style={{ color: Math.abs(h.cash_check.residual) > 500 ? "var(--warn)" : "var(--text)" }}>
                  {h.cash_check.residual >= 0 ? "+" : ""}{h.cash_check.residual.toLocaleString("en-US", { style: "currency", currency: "USD" })}
                </b>{" "}
                unexplained ({h.cash_check.residual_pct_of_flow}% of traded volume). Shorts, margin debt, interest, adjustments and per-trade fees are all accounted for — what remains is activity newer than your last import and settlement timing.{" "}
                <Hint label={breakdown} width={320}>
                  <span style={{ color: "var(--accent-quiet)", textDecoration: "underline dotted" }}>See the math</span>
                </Hint>
              </p>
            );
          })()}
          {h.recommendations.map((r, i) => <p key={i} style={SS.credStatus}>{r}</p>)}
        </>
      ) : (
        <p style={SS.credStatus}>Loading health report…</p>
      )}
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <label className={`btn btn-secondary btn-sm${busy ? " disabled" : ""}`} style={{ cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Importing…" : "Import Schwab transactions CSV"}
          <input type="file" accept=".csv,text/csv" disabled={busy} style={{ display: "none" }}
            onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} />
        </label>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-dim)" }}>
          Schwab.com → Accounts → History → Export. One file imports trades, deposits, and dividends together.
        </span>
      </div>
      <div aria-live="polite">
        {summary && <p style={{ ...SS.credStatus, marginTop: 8 }}>{summary}</p>}
      </div>
    </div>
  );
}
