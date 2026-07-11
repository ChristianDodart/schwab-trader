import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "./App";
import { SkeletonCards, SkeletonPanel } from "./Skeleton";
import { ALL_TIME, Card, Panel, PeriodSelector, S, moneyColor, type Period } from "./LedgerUI";
import type { LedgerActivity as Activity } from "./types";
import { PLCalendar } from "./PLCalendar";
import { API } from "./api";

type Grain = "day" | "week" | "month" | "year";
const GRAINS: { id: Grain; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

const qs = (grain: Grain, p: Period) => {
  const q = new URLSearchParams({ grain });
  if (p.from) q.set("start", p.from);
  if (p.to) q.set("end", p.to);
  return `?${q.toString()}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Turn the backend's period key into a friendly label. Keys: "2026" (year),
// "2026-07" (month), "2026-06-29" ISO Monday (week), "2026-07-06" (day).
function label(period: string, grain: Grain): string {
  const p = period.split("-").map(Number);
  if (grain === "year") return period;
  if (grain === "month" && p.length >= 2) return `${MONTHS[p[1] - 1]} ${p[0]}`;
  if (p.length >= 3) {
    const d = new Date(p[0], p[1] - 1, p[2]);
    const nice = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    return grain === "week" ? `Week of ${MONTHS[d.getMonth()]} ${d.getDate()}` : nice;
  }
  return period;
}

// "$ bought and sold" per period — the "what did I do this week/month?" view. Sourced
// from the fill log so it reflects real executed activity, not just closed round-trips.
export function LedgerActivity({ onDayClick }: { onDayClick?: (iso: string) => void } = {}) {
  const year = new Date().getFullYear();
  const [grain, setGrain] = useState<Grain>("week");
  const [scope, setScope] = useState<Period>(ALL_TIME);
  const [d, setD] = useState<Activity | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seqRef = useRef(0);

  const load = useCallback(() => {
    const my = ++seqRef.current;
    setD(null);
    fetch(`${API}/ledger/activity${qs(grain, scope)}`)
      .then((r) => r.json())
      .then((j) => { if (seqRef.current === my) (j && !j.error ? (setD(j), setErr(null)) : setErr(j?.error || "Couldn't load activity.")); })
      .catch(() => { if (seqRef.current === my) setErr("Couldn't load activity — network error."); });
  }, [grain, scope]);
  useEffect(() => { load(); }, [load]);

  if (err) return <p style={S.note}>{err}</p>;
  if (!d) return <div><SkeletonCards n={3} /><SkeletonPanel /></div>;

  const t = d.totals;
  const maxFlow = Math.max(1, ...d.rows.map((r) => Math.max(r.bought, r.sold)));

  return (
    <div>
      <div style={S2.cards}>
        <Card label="Bought" value={usd(t.bought)} accent="var(--accent-quiet)"
          sub={t.buy_count ? `${t.buy_count} buy${t.buy_count === 1 ? "" : "s"}` : undefined}
          hint="Gross dollars spent buying over the selected span (every executed buy fill)." />
        <Card label="Sold" value={usd(t.sold)} accent="var(--accent-quiet)"
          sub={t.sell_count ? `${t.sell_count} sell${t.sell_count === 1 ? "" : "s"}` : undefined}
          hint="Gross proceeds from selling over the selected span (every executed sell fill)." />
        <Card label="Net cash flow" value={`${t.net > 0 ? "+" : ""}${usd(t.net)}`} accent={moneyColor(t.net)}
          hint="Sold minus bought. Positive = more cash came back out of the market than went in." />
        <Card label="Realized profit" value={`${t.profit > 0 ? "+" : ""}${usd(t.profit)}`} accent={moneyColor(t.profit)} big
          hint="Profit booked by the sells in this span — (sell price minus that lot's buy price) times shares, summed across every closed trade (LIFO, matching the ladder)." />
      </div>

      <Panel
        title="By period"
        right={
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span role="tablist" aria-label="Group by" style={S2.grainTabs}>
              {GRAINS.map((g) => (
                <button key={g.id} role="tab" aria-selected={grain === g.id} className="btn btn-sm"
                  style={grain === g.id ? S2.grainOn : S2.grainOff} onClick={() => setGrain(g.id)}>{g.label}</button>
              ))}
            </span>
            <PeriodSelector value={scope} onChange={setScope} year={year} />
          </span>
        }
      >
        {d.rows.length === 0 ? (
          <p style={S.fine}>No recorded buys or sells in this period. Activity is logged from fills as trades execute.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="left">Period</th>
                  <th>Bought</th><th>Sold</th><th>Net</th><th>Profit</th><th className="left">Flow</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.period}>
                    <td className="left">{label(r.period, grain)}</td>
                    <td style={S2.num}>{usd(r.bought)}</td>
                    <td style={S2.num}>{usd(r.sold)}</td>
                    <td style={{ ...S2.num, color: moneyColor(r.net) }}>{r.net > 0 ? "+" : ""}{usd(r.net)}</td>
                    <td style={{ ...S2.num, color: moneyColor(r.profit), fontWeight: 600 }}
                      title="Realized P/L booked this period — (sell − buy) × shares across its closed trades">
                      {r.profit > 0 ? "+" : ""}{usd(r.profit)}
                    </td>
                    <td className="left" style={{ minWidth: 120 }}><FlowBar bought={r.bought} sold={r.sold} max={maxFlow} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <PLCalendar onDayClick={onDayClick} />
    </div>
  );
}

// Twin mini-bars: bought (blue) above, sold (blue) below, scaled to the largest
// flow across all periods so the eye can compare periods at a glance.
function FlowBar({ bought, sold, max }: { bought: number; sold: number; max: number }) {
  const w = (v: number) => `${Math.round((v / max) * 100)}%`;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, width: 100, verticalAlign: "middle" }}
      title={`Bought ${usd(bought)} · Sold ${usd(sold)}`}>
      <span style={S2.track}><span style={{ ...S2.fill, width: w(bought), background: "var(--accent-quiet)" }} /></span>
      <span style={S2.track}><span style={{ ...S2.fill, width: w(sold), background: "var(--accent)" }} /></span>
    </span>
  );
}

const S2: Record<string, React.CSSProperties> = {
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, margin: "4px 0 16px" },
  num: { textAlign: "right", fontVariantNumeric: "tabular-nums" },
  grainTabs: { display: "inline-flex", gap: 3, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: 2 },
  grainOn: { border: "none", background: "var(--accent-fill)", color: "var(--on-accent)", fontWeight: 700, borderRadius: "var(--r-pill)" },
  grainOff: { border: "none", background: "transparent", color: "var(--text-muted)", borderRadius: "var(--r-pill)" },
  track: { display: "block", height: 5, width: "100%", background: "var(--panel-2)", borderRadius: 3, overflow: "hidden" },
  fill: { display: "block", height: "100%", borderRadius: 3 },
};
