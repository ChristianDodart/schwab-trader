import { usd, pct } from "./format";
import { moneyColor } from "./LedgerUI";
import type { Dashboard } from "./types";
import type { KpiCash } from "./kpis";

// Bottom "at a glance" strip beneath the dashboard table: three summary cards
// (Today, Capital deployment, Needs attention). Every color is a theme token so
// each theme recolors it. No fabricated intraday series — there's none available.

export function DashboardStrip({ data, cash }: { data: Dashboard; cash: KpiCash }) {
  const cashNum = cash?.cash ?? null;
  const accountValue = (data.total_value ?? 0) + (cashNum ?? 0);

  // Today's P/L.
  const dc = data.total_day_change ?? null;
  const daySign = dc == null ? "" : dc > 0 ? "+" : dc < 0 ? "−" : "";
  const dayText = dc == null ? "—" : `${daySign}${usd(Math.abs(dc))}`;
  const dayPct = dc != null && accountValue ? dc / accountValue : null;

  // Capital deployment.
  const inv = data.total_invested ?? 0;
  const csh = cashNum ?? 0;
  const denom = inv + csh;
  const deployed = denom > 0 ? inv / denom : 0;
  const deployedPct = Math.min(100, Math.max(0, deployed * 100));

  // Needs attention: held rows carrying a buy or sell mark.
  const flagged = (data.rows ?? []).filter((r) => !r.is_watch && (r.buy_mark || r.sell_mark));
  const chips = flagged.slice(0, 4);

  return (
    <div style={S.grid}>
      {/* Today */}
      <div style={S.card}>
        <div style={S.label}>Today</div>
        <div style={{ ...S.big, color: moneyColor(dc) }}>{dayText}</div>
        <div style={S.sub}>
          {dayPct != null ? `${pct(dayPct)} of account value` : "Waiting on live prices"}
        </div>
      </div>

      {/* Capital deployment */}
      <div style={S.card}>
        <div style={S.label}>Capital deployment</div>
        <div style={S.big}>{pct(deployed)} <span style={S.bigTail}>in the market</span></div>
        <div style={S.sub}>{usd(data.total_invested)} invested · {usd(cashNum)} cash</div>
        <div style={S.track}>
          <div style={{ ...S.fill, width: `${deployedPct}%` }} />
        </div>
      </div>

      {/* Needs attention */}
      <div style={S.card}>
        <div style={S.label}>Needs attention</div>
        {flagged.length > 0 ? (
          <>
            <div style={S.big}>{flagged.length} <span style={S.bigTail}>flagged</span></div>
            <div style={S.chipRow}>
              {chips.map((r) => {
                const buy = r.buy_mark;
                // Reuse the app's canonical BUY/SELL chip classes so color + sheen match
                // the table chips exactly (green --pos-strong buy / red --neg-strong sell).
                return (
                  <span key={r.symbol} className={`chip chip-${buy ? "buy" : "sell"}`}>
                    <span aria-hidden="true">{buy ? "▲" : "▼"}</span>
                    {buy ? "BUY" : "SELL"} {r.symbol}
                  </span>
                );
              })}
              {flagged.length > chips.length && (
                <span style={S.moreChip}>+{flagged.length - chips.length} more</span>
              )}
            </div>
          </>
        ) : (
          <div style={S.calm}>Nothing flagged</div>
        )}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 },
  card: {
    display: "flex", flexDirection: "column", gap: 6,
    background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)",
    padding: "14px 16px",
  },
  label: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)" },
  big: { fontSize: "var(--fs-xl)", fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums", lineHeight: 1.15 },
  bigTail: { fontSize: "var(--fs-sm)", fontWeight: 600, color: "var(--text-dim)" },
  sub: { fontSize: "var(--fs-sm)", color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" },
  track: { height: 8, borderRadius: "var(--r-sm)", background: "var(--panel-2)", overflow: "hidden", width: "100%", marginTop: 2 },
  fill: { height: "100%", borderRadius: "var(--r-sm)", background: "var(--accent)" },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 },
  moreChip: {
    display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: "var(--r-sm)",
    fontSize: "var(--fs-2xs)", fontWeight: 600, color: "var(--text-dim)", background: "var(--panel-2)",
  },
  calm: { fontSize: "var(--fs-md)", color: "var(--text-dim)" },
};
