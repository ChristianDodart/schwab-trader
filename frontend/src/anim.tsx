// Motion utilities for the feel pass (v0.41.0). All are theme-INDEPENDENT and
// reduced-motion aware: with reduced motion, count-ups become instant sets and
// flashes don't fire — the *information* is always preserved, only the movement
// is dropped. Keyframes live in motion.css; these drive the JS-side motion.
import { useEffect, useRef, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
  });
  useEffect(() => {
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const on = () => setReduced(mq.matches);
      mq.addEventListener?.("change", on);
      return () => mq.removeEventListener?.("change", on);
    } catch { return; }
  }, []);
  return reduced;
}

/**
 * Tween a number toward `target`. Deliberately gated: only animates when the
 * change is worth it (>= `threshold`, default 0.2% of the value or $1), so the
 * header figures roll on a real move (a fill, a deposit) but SNAP on the tiny
 * sub-dollar ticks that arrive every ~2s — no constant jitter on live numbers.
 */
export function useCountUp(target: number, opts?: { duration?: number; threshold?: number }): number {
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);
  const rafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const duration = opts?.duration ?? 420;
    const from = displayRef.current;
    const delta = Math.abs(target - from);
    const threshold = opts?.threshold ?? Math.max(1, Math.abs(target) * 0.002);

    if (reduced || delta < threshold || duration <= 0) {
      displayRef.current = target; setDisplay(target); return;
    }
    let start: number | undefined;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // cubic ease-out
    const step = (ts: number) => {
      if (start === undefined) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      const v = from + (target - from) * ease(p);
      displayRef.current = v; setDisplay(v);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
      else { displayRef.current = target; setDisplay(target); }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  return display;
}

/** A number that rolls to its new value on a meaningful change, formatted with `format`. */
export function CountUp(
  { value, format, ...rest }:
  { value: number; format: (n: number) => string } & React.HTMLAttributes<HTMLSpanElement>,
) {
  const n = useCountUp(value);
  return <span {...rest}>{format(n)}</span>;
}

export type FillRow = { symbol: string; shares: number; last_pos_cost: number | null; is_watch: boolean };
export type FillSig = { sig: string; shares: number };

/** The fill signature — fill-only fields. Price and P&L are deliberately absent so
 *  the ambient 2s ticks never register as a change. */
export const fillSig = (r: FillRow): FillSig => ({ sig: `${r.shares}|${r.last_pos_cost}|${r.is_watch}`, shares: r.shares });

/**
 * Pure diff: which rows had a POSITION change vs the previous snapshot, and the
 * direction. A first-seen symbol never flashes. Exported for testing so the
 * anti-strobe guarantee (ticks don't flash) is pinned down.
 */
export function computeFillChanges(
  prev: Map<string, FillSig>, rows: FillRow[],
): Array<{ symbol: string; dir: "buy" | "sell" }> {
  const out: Array<{ symbol: string; dir: "buy" | "sell" }> = [];
  for (const r of rows) {
    const before = prev.get(r.symbol);
    const now = fillSig(r);
    if (before && before.sig !== now.sig) out.push({ symbol: r.symbol, dir: r.shares >= before.shares ? "buy" : "sell" });
  }
  return out;
}

/** A simultaneous change this large reads as a reload/account-switch, not fills. */
export const BULK_RELOAD_THRESHOLD = 3;

/**
 * Detect when a row's POSITION changed — a fill — as opposed to the ambient price
 * ticks that arrive every ~2s. The signature is fill-only fields (shares, last
 * position cost, watch flag); price/P&L are excluded so ticks never flash. Returns
 * a lookup: "buy" when shares grew (a buy / a buy-down rung firing / a position
 * opening), "sell" when they shrank (a trim / a close). A large simultaneous change
 * (> 3 symbols) is treated as a reload/account-switch, not individual fills, and
 * doesn't flash. Reduced-motion → never flashes.
 */
export function useFillFlash(rows: FillRow[]): (symbol: string) => "buy" | "sell" | undefined {
  const reduced = usePrefersReducedMotion();
  const prev = useRef<Map<string, { sig: string; shares: number }>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [flash, setFlash] = useState<Map<string, "buy" | "sell">>(new Map());

  useEffect(() => {
    const changed = reduced ? [] : computeFillChanges(prev.current, rows);
    // Always refresh signatures so a fill during reduced-motion / a bulk reload
    // doesn't flash the moment it re-enables or the next single fill lands.
    const next = new Map(prev.current);
    for (const r of rows) next.set(r.symbol, fillSig(r));
    prev.current = next;

    if (!changed.length || changed.length > BULK_RELOAD_THRESHOLD) return; // no flash storm
    setFlash((m) => { const n = new Map(m); for (const c of changed) n.set(c.symbol, c.dir); return n; });
    for (const c of changed) {
      const t = timers.current.get(c.symbol); if (t) clearTimeout(t);
      timers.current.set(c.symbol, setTimeout(() => {
        setFlash((m) => { const n = new Map(m); n.delete(c.symbol); return n; });
        timers.current.delete(c.symbol);
      }, 1150));
    }
  }, [rows, reduced]);

  useEffect(() => () => { for (const t of timers.current.values()) clearTimeout(t); }, []);

  return (symbol: string) => flash.get(symbol);
}
