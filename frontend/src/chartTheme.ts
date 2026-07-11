// Canvas charts (lightweight-charts) can't resolve CSS var() — they need literal
// colors. This reads the *current* theme's tokens off the document root and
// re-emits them whenever the theme changes, so charts restyle with the app.
import { useEffect, useState } from "react";

export interface ChartColors {
  text: string;   // axis labels        (--text-dim)
  grid: string;   // grid lines         (--border-hairline)
  border: string; // scale borders      (--border)
  pos: string;    // up candles         (--pos)
  neg: string;    // down candles       (--neg)
  accent: string; // series / buy lines (--accent)
  ref1: string;   // 52w avg line       (--text-dim)
  ref2: string;   // 52w median line    (--text-faint)
}

export function readChartColors(): ChartColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    text: v("--text-dim", "#9a9aa0"),
    grid: v("--border-hairline", "#242428"),
    border: v("--border", "#2c2c33"),
    pos: v("--pos", "#5dcaa5"),
    neg: v("--neg", "#f0997b"),
    accent: v("--accent", "#4a90e2"),
    ref1: v("--text-dim", "#7a7a82"),
    ref2: v("--text-faint", "#5c5c63"),
  };
}

/** hex (#rrggbb) → rgba() string, for canvas gradients that need transparency. */
export function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return hex;
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Current theme's chart colors; updates on theme change so effects can re-key. */
export function useChartColors(): ChartColors {
  const [c, setC] = useState<ChartColors>(() => readChartColors());
  useEffect(() => {
    const sync = () => setC(readChartColors());
    window.addEventListener("themechange", sync);
    return () => window.removeEventListener("themechange", sync);
  }, []);
  return c;
}
