import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, type IChartApi, type CandlestickData } from "lightweight-charts";
import { API } from "./api";

const RANGES = ["1D", "5D", "1M", "6M", "1Y"] as const;
type Range = (typeof RANGES)[number];

export function PriceChart({ symbol }: { symbol: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<Range>("6M");

  useEffect(() => {
    if (!container.current) return;
    const intraday = range === "1D" || range === "5D";
    const chart: IChartApi = createChart(container.current, {
      height: 260,
      autoSize: true,
      layout: {
        // lightweight-charts renders on <canvas>; CSS var() cannot resolve here,
        // so these are literal hex values matched to the design tokens.
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9a9aa0", // --text-dim
        fontFamily: "system-ui, sans-serif",
      },
      grid: { vertLines: { color: "#242428" }, horzLines: { color: "#242428" } }, // --border-hairline
      timeScale: { timeVisible: intraday, borderColor: "#2c2c33" }, // --border
      rightPriceScale: { borderColor: "#2c2c33" }, // --border
      crosshair: { mode: 0 },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#5dcaa5", // --pos
      downColor: "#f0997b", // --neg
      borderVisible: false,
      wickUpColor: "#5dcaa5",
      wickDownColor: "#f0997b",
    });

    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = (attempt: number) => {
      fetch(`${API}/price-history/${symbol}?range=${range}`)
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          if (j.candles && j.candles.length) {
            series.setData(j.candles as CandlestickData[]);
            chart.timeScale().fitContent();
          } else if (attempt < 3) {
            timer = setTimeout(() => load(attempt + 1), 2500); // throttled — retry
          }
        })
        .catch(() => {});
    };
    load(0);

    return () => {
      alive = false;
      clearTimeout(timer);
      chart.remove();
    };
  }, [symbol, range]);

  return (
    <div style={S.wrap}>
      <div style={S.tabs}>
        {RANGES.map((r) => (
          <button
            key={r}
            className="navtab"
            aria-current={r === range ? "page" : undefined}
            style={{ padding: "2px 10px", fontSize: "var(--fs-xs)" }}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <div ref={container} style={{ width: "100%" }} />
    </div>
  );
}

const S = {
  wrap: { marginTop: 4 } as React.CSSProperties,
  tabs: { display: "flex", gap: 4, marginBottom: 8 } as React.CSSProperties,
};
