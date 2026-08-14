import { useEffect, useState } from "react";

// Global table column spacing: the horizontal padding inside every .tbl cell, exposed
// as the --cell-px CSS var on :root so the user can bunch columns tighter or give them
// room. Persisted per browser. The default (12px) matches the original table padding.
const KEY = "table_cell_px_v1";
export const DEFAULT_CELL_PX = 12;
export const MIN_CELL_PX = 2;
export const MAX_CELL_PX = 22;

function read(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v >= MIN_CELL_PX && v <= MAX_CELL_PX ? v : DEFAULT_CELL_PX;
  } catch {
    return DEFAULT_CELL_PX;
  }
}

export function useCellDensity() {
  const [px, setPxState] = useState<number>(read);
  useEffect(() => {
    document.documentElement.style.setProperty("--cell-px", `${px}px`);
  }, [px]);
  const setPx = (n: number) => {
    const clamped = Math.max(MIN_CELL_PX, Math.min(MAX_CELL_PX, Math.round(n)));
    setPxState(clamped);
    try {
      localStorage.setItem(KEY, String(clamped));
    } catch {
      /* ignore quota / disabled storage */
    }
  };
  const reset = () => setPx(DEFAULT_CELL_PX);
  return { px, setPx, reset };
}

export type CellDensity = ReturnType<typeof useCellDensity>;
