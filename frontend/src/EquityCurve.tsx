import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";
import { useChartColors, withAlpha } from "./chartTheme";

// Benchmark reference line: a muted gold, distinct from the account's accent.
// Categorical (not semantic), so it's a constant across themes.
const BENCH_COLOR = "#c9a227";

type Point = { day: string; balance: number; capital_gains: number };
type BenchPoint = { day: string; value: number };

const RANGES = { "3M": 90, "1Y": 365, All: 0 } as const;
type RangeKey = keyof typeof RANGES;
const LS_RANGE = "equity.range.v1";
const readRange = (): RangeKey => {
  try { const r = localStorage.getItem(LS_RANGE); return r && r in RANGES ? (r as RangeKey) : "All"; }
  catch { return "All"; }
};
// Keep only points on/after (latest day − `days`). days=0 → keep all.
function sliceByRange<T extends { day: string }>(pts: T[], days: number): T[] {
  if (days === 0 || pts.length === 0) return pts;
  const last = new Date(pts[pts.length - 1].day);
  const cutoff = new Date(last);
  cutoff.setDate(cutoff.getDate() - days);
  const iso = cutoff.toISOString().slice(0, 10);
  return pts.filter((p) => p.day >= iso);
}

// Account value over time, from the nightly daily_balance snapshots (build_historic's
// `series`). A quiet area line — it's a reference of where the account has been, not a
// P/L signal, so it uses the neutral accent (blue), not the money green/red.
//
// When a benchmark series is supplied (W7-1), a second muted line shows what the same
// deposits would have been worth in the benchmark over the same span — the "you vs index"
// story made visual, not just two end-point numbers.
export function EquityCurve({
  series, benchmark, benchmarkLabel,
}: {
  series: Point[];
  benchmark?: BenchPoint[];
  benchmarkLabel?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<RangeKey>(readRange);
  const c = useChartColors(); // live theme colors
  useEffect(() => { try { localStorage.setItem(LS_RANGE, range); } catch { /* private mode */ } }, [range]);
  const allPoints = (series || []).filter((p) => p.balance != null && p.balance > 0);
  const points = sliceByRange(allPoints, RANGES[range]);
  const bench = sliceByRange((benchmark || []).filter((p) => p.value != null && p.value > 0), RANGES[range]);
  const showBench = bench.length >= 2;

  useEffect(() => {
    if (!container.current || points.length < 2) return;
    const chart: IChartApi = createChart(container.current, {
      height: 220,
      autoSize: true,
      layout: {
        // canvas can't read var() — colors come from the live theme (chartTheme).
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: c.text,
        fontFamily: "system-ui, sans-serif",
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      timeScale: { borderColor: c.border },
      rightPriceScale: { borderColor: c.border },
      crosshair: { mode: 0 },
    });
    const area = chart.addAreaSeries({
      lineColor: c.accent,
      topColor: withAlpha(c.accent, 0.28),
      bottomColor: withAlpha(c.accent, 0.02),
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    area.setData(points.map((p) => ({ time: p.day, value: p.balance })));
    if (showBench) {
      const line = chart.addLineSeries({
        color: BENCH_COLOR,                        // muted gold — a reference, distinct from the account line
        lineWidth: 2,
        lineStyle: 2,                              // dashed
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });
      line.setData(bench.map((p) => ({ time: p.day, value: p.value })));
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [range, points.length, points[0]?.day, points[points.length - 1]?.day, showBench, bench.length, c]); // eslint-disable-line react-hooks/exhaustive-deps

  if (allPoints.length < 2) {
    return <p style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)", margin: 0 }}>
      Not enough daily snapshots yet — the account-value line fills in as they accrue (one per trading day).
    </p>;
  }
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", gap: 16, fontSize: "var(--fs-xs)", color: "var(--text-dim)" }}>
          <Legend color={c.accent} label="Your account" />
          {showBench && <Legend color={BENCH_COLOR} label={`${benchmarkLabel || "Benchmark"} (same deposits)`} dashed />}
        </div>
        <span role="group" aria-label="Range" style={{ display: "flex", gap: 4 }}>
          {(Object.keys(RANGES) as RangeKey[]).map((k) => (
            <button key={k} className="btn btn-sm" aria-pressed={range === k}
              style={{ padding: "2px 9px", fontSize: "var(--fs-xs)",
                background: range === k ? "var(--accent-fill)" : "transparent",
                color: range === k ? "var(--on-accent)" : "var(--text-muted)",
                borderColor: range === k ? "var(--accent-fill)" : "var(--border)" }}
              onClick={() => setRange(k)}>{k}</button>
          ))}
        </span>
      </div>
      {points.length < 2
        ? <p style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)", margin: "8px 0" }}>Not enough snapshots in this range.</p>
        : <div ref={container} style={{ width: "100%" }} />}
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 14, height: 0, borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }} />
      {label}
    </span>
  );
}
