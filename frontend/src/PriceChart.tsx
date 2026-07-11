import { useEffect, useRef, useState } from "react";
import {
  createChart, ColorType, LineStyle,
  type IChartApi, type ISeriesApi, type IPriceLine, type CandlestickData,
} from "lightweight-charts";
import { API } from "./api";
import { useChartColors } from "./chartTheme";

const RANGES = ["1D", "5D", "1M", "6M", "1Y"] as const;
type Range = (typeof RANGES)[number];

// `rungs` are projected buy-trigger prices; avg52/median52 are the 52-week
// reference levels. All optional — the chart works with just a symbol.
export function PriceChart({
  symbol, rungs = [], avg52, median52,
}: {
  symbol: string;
  rungs?: number[];
  avg52?: number | null;
  median52?: number | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [range, setRange] = useState<Range>("6M");
  const [chartGen, setChartGen] = useState(0); // bumps each (re)build so the overlay redraws
  const c = useChartColors(); // live theme colors; changes rebuild the chart

  useEffect(() => {
    if (!container.current) return;
    const intraday = range === "1D" || range === "5D";
    const chart: IChartApi = createChart(container.current, {
      height: 260,
      autoSize: true,
      layout: {
        // canvas can't resolve var(); colors come from the live theme tokens (chartTheme).
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: c.text,
        fontFamily: "system-ui, sans-serif",
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      timeScale: { timeVisible: intraday, borderColor: c.border },
      rightPriceScale: { borderColor: c.border },
      crosshair: { mode: 0 },
    });
    const series = chart.addCandlestickSeries({
      upColor: c.pos,
      downColor: c.neg,
      borderVisible: false,
      wickUpColor: c.pos,
      wickDownColor: c.neg,
    });
    seriesRef.current = series;
    setChartGen((n) => n + 1); // let the overlay effect (re)draw its price lines

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
      seriesRef.current = null;
    };
  }, [symbol, range, c]);

  // Overlay: buy-rung triggers (dashed blue) + 52wk avg/median (dotted grey) as
  // horizontal price lines. Managed apart from the candle stream so the parent's
  // 2s price refresh never rebuilds the chart. Redraws on chart rebuild or when
  // the levels change; canvas can't read var(), so colors are literal hex.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const lines: IPriceLine[] = [];
    for (const price of rungs) {
      if (price > 0)
        lines.push(series.createPriceLine({
          price, color: c.accent, lineWidth: 1, lineStyle: LineStyle.Dashed,
          axisLabelVisible: true, title: "buy",
        }));
    }
    if (avg52 != null)
      lines.push(series.createPriceLine({
        price: avg52, color: c.ref1, lineWidth: 1, lineStyle: LineStyle.Dotted,
        axisLabelVisible: true, title: "52w avg",
      }));
    if (median52 != null)
      lines.push(series.createPriceLine({
        price: median52, color: c.ref2, lineWidth: 1, lineStyle: LineStyle.Dotted,
        axisLabelVisible: true, title: "52w med",
      }));
    return () => { for (const l of lines) { try { series.removePriceLine(l); } catch { /* chart gone */ } } };
  }, [chartGen, rungs.join(","), avg52, median52, c]);

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
