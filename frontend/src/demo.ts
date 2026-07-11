// Demo / showcase feed. When ON, it takes a snapshot of your REAL dashboard and
// drives it with a synthetic feed — gentle price ticks (so the header count-ups
// roll and the price column moves) plus the occasional simulated fill (so rows
// flash green/rose). It is DISPLAY-ONLY: it never calls the backend, never places
// an order, and never persists. A reload turns it off. Used to show the app off
// when the market is closed and nothing is actually moving.
import { useEffect, useRef, useState } from "react";
import type { Dashboard, DashboardRow } from "./types";

const jitter = (p: number, span: number) => p * (1 + (Math.random() - 0.5) * span);

// One price tick: nudge price ~±0.3% and carry the change through the price-derived
// fields. Share-bearing fields (shares, last_pos_cost, is_watch) are untouched here,
// so a tick never trips the fill-flash — only simulateFill() does.
function tickRow(r: DashboardRow): DashboardRow {
  if (r.price == null) return r;
  const price = Math.max(0.01, jitter(r.price, 0.006));
  const dPrice = price - r.price;
  const pct_of_high = r.year_high ? price / r.year_high : r.pct_of_high;
  if (r.is_watch || r.shares <= 0) return { ...r, price, pct_of_high };

  const current_value = price * r.shares;
  const unrealized = current_value - r.invested;
  const day_change = r.day_change != null ? r.day_change + dPrice * r.shares : r.day_change;
  // The last position's P/L moves 1:1 with price on its own shares (cost / basis).
  const lastPosShares = r.basis_per_share ? (r.last_pos_cost ?? 0) / r.basis_per_share : 0;
  const last_pos_profit = r.last_pos_profit != null ? r.last_pos_profit + dPrice * lastPosShares : r.last_pos_profit;
  return {
    ...r, price, current_value, unrealized, day_change, last_pos_profit, pct_of_high,
    total_return: r.total_return + dPrice * r.shares,
  };
}

// Recompute the header aggregates from the (mutated) rows so the KPI count-ups move.
function reaggregate(d: Dashboard): Dashboard {
  const held = d.rows.filter((r) => !r.is_watch);
  const total_value = held.reduce((s, r) => s + (r.current_value ?? 0), 0);
  const total_day_change = held.reduce((s, r) => s + (r.day_change ?? 0), 0);
  const harvestable = held.reduce((s, r) => s + Math.max(0, r.last_pos_profit ?? 0), 0);
  return { ...d, total_value, total_unrealized: total_value - d.total_invested, total_day_change, harvestable };
}

export const tickPrices = (d: Dashboard): Dashboard => reaggregate({ ...d, rows: d.rows.map(tickRow) });

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

// One simulated fill on a single row → changes its fill signature → that row flashes.
// A buy-down rung firing / a new position opening / a trim / a full sell-out.
export function simulateFill(d: Dashboard): Dashboard | null {
  const held = d.rows.filter((r) => !r.is_watch && r.shares > 0 && r.price != null);
  const watch = d.rows.filter((r) => r.is_watch && r.price != null);
  const roll = Math.random();
  let sym: string | undefined;
  let mutate: ((r: DashboardRow) => DashboardRow) | undefined;

  if (roll < 0.18 && watch.length) {
    // open a position in a watched name
    const t = pick(watch); sym = t.symbol;
    mutate = (r) => {
      const price = r.price!;
      const lot = Math.max(1, Math.round((500 + Math.random() * 500) / price));
      const invested = lot * price;
      return { ...r, is_watch: false, shares: lot, invested, basis_per_share: price, positions: 1,
        last_pos_cost: invested, last_pos_profit: 0, current_value: invested, unrealized: 0, last_held: null };
    };
  } else if (roll < 0.72 && held.length) {
    // buy-down rung fires: add to an existing position
    const t = pick(held); sym = t.symbol;
    mutate = (r) => {
      const price = r.price!;
      const lot = Math.max(1, Math.round((400 + Math.random() * 600) / price));
      const cost = lot * price;
      const shares = r.shares + lot;
      const invested = r.invested + cost;
      return { ...r, shares, invested, basis_per_share: invested / shares, positions: r.positions + 1,
        last_pos_cost: cost, last_pos_profit: 0, current_value: shares * price, unrealized: shares * price - invested };
    };
  } else if (held.length) {
    const t = pick(held); sym = t.symbol;
    const sellOut = Math.random() < 0.4;
    mutate = (r) => {
      const price = r.price!;
      if (sellOut) {
        return { ...r, is_watch: true, shares: 0, positions: 0, invested: 0, basis_per_share: 0,
          last_pos_cost: null, last_pos_profit: null, current_value: 0, unrealized: 0, last_held: price };
      }
      const lot = Math.max(1, Math.floor(r.shares / 3));
      const shares = Math.max(1, r.shares - lot);
      const invested = r.basis_per_share * shares;
      return { ...r, shares, invested, positions: Math.max(1, r.positions - 1),
        last_pos_cost: r.basis_per_share * lot, last_pos_profit: (price - r.basis_per_share) * lot,
        current_value: shares * price, unrealized: shares * price - invested };
    };
  }
  if (!sym || !mutate) return null;
  const m = mutate;
  return reaggregate({ ...d, rows: d.rows.map((r) => (r.symbol === sym ? m(r) : r)) });
}

/**
 * When `on`, returns a synthetic, self-animating copy of `real`; otherwise returns
 * `real` unchanged. Seeds from the current real snapshot and then simulates locally
 * (ignoring live updates) until turned off or the account changes.
 */
export function useDemoFeed(real: Dashboard | null, on: boolean): Dashboard | null {
  const realRef = useRef(real);
  realRef.current = real;
  const simRef = useRef<Dashboard | null>(null);
  const [sim, setSim] = useState<Dashboard | null>(null);
  const symbolsKey = real ? real.rows.map((r) => r.symbol).join(",") : "";

  useEffect(() => {
    if (!on || !realRef.current) { simRef.current = null; setSim(null); return; }
    const seed: Dashboard = { ...realRef.current, rows: realRef.current.rows.map((r) => ({ ...r })) };
    simRef.current = seed; setSim(seed);

    const priceTimer = setInterval(() => {
      if (simRef.current) { const n = tickPrices(simRef.current); simRef.current = n; setSim(n); }
    }, 1300);
    const fillTimer = setInterval(() => {
      if (simRef.current) { const n = simulateFill(simRef.current); if (n) { simRef.current = n; setSim(n); } }
    }, 3800);
    return () => { clearInterval(priceTimer); clearInterval(fillTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, symbolsKey]);

  return on ? (sim ?? realRef.current) : real;
}
