import { usd, pct } from "./format";
import { moneyColor } from "./LedgerUI";
import { dayPct as computeDayPct } from "./rowDerived";
import type { VisibleKpi } from "./kpis";

// Full-width account band that sits directly beneath the top bar on the dashboard.
// Left→right: a hero (account value + today's change), a divider, the customizable
// KPI widgets (with the picker gear at the end), and a right-pushed capital-deployment
// meter. All colors come from theme tokens so every theme recolors it correctly.

type Props = {
  accountValue: number | null;
  dayChange: number | null;
  deployedPct: number | null;   // THE canonical margin_summary figure (LMV/equity, a percent)
  kpis: VisibleKpi[];
  picker: React.ReactNode;
};

export function AccountBand({ accountValue, dayChange, deployedPct, kpis, picker }: Props) {
  // Today's % move, from the SAME two numbers shown in the hero so the value and percent
  // can never disagree — today's $ change over the start-of-day value (shared selector).
  const dayPct = computeDayPct(dayChange, accountValue);

  // Deployment % is the ONE canonical figure from margin_summary (LMV/equity): ~100% fully
  // invested, OVER 100% on margin. The bar caps at 100%, but the label shows the true % and
  // flags margin when it runs past 100. Null (balances unavailable) reads as "—".
  const hasDep = deployedPct != null;
  const barWidth = hasDep ? Math.min(100, Math.max(0, deployedPct)) : 0;
  const overExtended = hasDep && deployedPct > 100.5;   // using margin
  const pctText = hasDep ? pct(deployedPct / 100) : "—";

  return (
    <div style={S.band}>
      {/* Hero: the account value big, with today's change beside it. */}
      <div style={S.hero}>
        <div style={S.heroLabel}>Account</div>
        <div style={S.heroRow}>
          <span style={S.heroVal}>{usd(accountValue)}</span>
          {dayChange != null && (
            <span style={{ ...S.heroDay, color: moneyColor(dayChange) }}>
              <span aria-hidden="true">{dayChange >= 0 ? "▲" : "▼"}</span> {usd(Math.abs(dayChange))}
              {dayPct != null ? ` · ${pct(dayPct)} today` : ""}
            </span>
          )}
        </div>
      </div>

      <div style={S.divider} aria-hidden="true" />

      {/* Customizable KPI widgets + the picker gear at the end of the row. */}
      <div className="gear-host" style={S.kpiRow}>
        {kpis.map((k) => (
          <div key={k.id} style={S.stat} title={k.hint}>
            <div style={S.statLabel}>{k.label}</div>
            <div style={{ ...S.statVal, color: k.color ?? (k.n != null ? moneyColor(k.n) : "var(--text)") }}>
              {k.value}
            </div>
          </div>
        ))}
        {picker}
      </div>

      {/* Right-pushed capital-deployment meter — the canonical LMV/equity from margin_summary. */}
      <div style={S.deploy}>
        <div style={S.deployLabel}>Deployment · {pctText} in market{overExtended ? " · on margin" : ""}</div>
        <div style={S.track}>
          <div style={{ ...S.fill, width: `${barWidth}%`, ...(overExtended ? { background: "var(--warn)" } : null) }} />
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  band: {
    display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap",
    background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)",
    padding: "14px 18px", boxShadow: "inset 0 1px 0 var(--surface-hi)",
  },
  hero: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
  heroLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-faint)" },
  heroRow: { display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" },
  heroVal: { fontSize: "var(--fs-2xl)", fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums", lineHeight: 1.1 },
  heroDay: { fontSize: "var(--fs-md)", fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  divider: { width: 1, alignSelf: "stretch", background: "var(--border)", flex: "0 0 auto" },
  kpiRow: { display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap", minWidth: 0 },
  stat: { display: "flex", flexDirection: "column", gap: 2 },
  statLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)", whiteSpace: "nowrap" },
  statVal: { fontSize: "var(--fs-lg)", fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  deploy: { marginLeft: "auto", display: "flex", flexDirection: "column", gap: 6, minWidth: 160 },
  deployLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-faint)", whiteSpace: "nowrap" },
  track: { height: 8, borderRadius: "var(--r-sm)", background: "var(--panel-2)", overflow: "hidden", width: "100%" },
  fill: { height: "100%", borderRadius: "var(--r-sm)", background: "var(--accent)" },
};
