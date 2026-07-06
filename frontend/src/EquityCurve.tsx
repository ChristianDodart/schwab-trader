import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi } from "lightweight-charts";

type Point = { day: string; balance: number; capital_gains: number };

// Account value over time, from the nightly daily_balance snapshots (build_historic's
// `series`). A quiet area line — it's a reference of where the account has been, not a
// P/L signal, so it uses the neutral accent (blue), not the money green/red.
export function EquityCurve({ series }: { series: Point[] }) {
  const container = useRef<HTMLDivElement>(null);
  const points = (series || []).filter((p) => p.balance != null && p.balance > 0);

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
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points.length, points[0]?.day, points[points.length - 1]?.day]); // eslint-disable-line react-hooks/exhaustive-deps

  if (points.length < 2) {
    return <p style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)", margin: 0 }}>
      Not enough daily snapshots yet — the account-value line fills in as they accrue (one per trading day).
    </p>;
  }
  return <div ref={container} style={{ width: "100%" }} />;
}
