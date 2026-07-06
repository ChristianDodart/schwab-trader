import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";

type Point = { day: string; balance: number; capital_gains: number };
type BenchPoint = { day: string; value: number };

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
  const points = (series || []).filter((p) => p.balance != null && p.balance > 0);
  const bench = (benchmark || []).filter((p) => p.value != null && p.value > 0);
  const showBench = bench.length >= 2;

  useEffect(() => {
    if (!container.current || points.length < 2) return;
    const chart: IChartApi = createChart(container.current, {
      height: 220,
      autoSize: true,
      layout: {
        // canvas can't read var() — literal hex matched to the design tokens.
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9a9aa0",              // --text-dim
        fontFamily: "system-ui, sans-serif",
      },
      grid: { vertLines: { color: "#242428" }, horzLines: { color: "#242428" } }, // --border-hairline
      timeScale: { borderColor: "#2c2c33" },      // --border
      rightPriceScale: { borderColor: "#2c2c33" },
      crosshair: { mode: 0 },
    });
    const area = chart.addAreaSeries({
      lineColor: "#4a90e2",                        // --accent
      topColor: "rgba(74,144,226,0.28)",
      bottomColor: "rgba(74,144,226,0.02)",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    area.setData(points.map((p) => ({ time: p.day, value: p.balance })));
    if (showBench) {
      const line = chart.addLineSeries({
        color: "#c9a227",                          // muted gold — a reference, distinct from the account's blue
        lineWidth: 2,
        lineStyle: 2,                              // dashed
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });
      line.setData(bench.map((p) => ({ time: p.day, value: p.value })));
    }
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points.length, points[0]?.day, points[points.length - 1]?.day, showBench, bench.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (points.length < 2) {
    return <p style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)", margin: 0 }}>
      Not enough daily snapshots yet — the account-value line fills in as they accrue (one per trading day).
    </p>;
  }
  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 6, fontSize: "var(--fs-xs)", color: "var(--text-dim)" }}>
        <Legend color="#4a90e2" label="Your account" />
        {showBench && <Legend color="#c9a227" label={`${benchmarkLabel || "Benchmark"} (same deposits)`} dashed />}
      </div>
      <div ref={container} style={{ width: "100%" }} />
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
