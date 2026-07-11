import { describe, it, expect } from "vitest";
import { tickPrices, simulateFill } from "./demo";
import { fillSig } from "./anim";
import type { Dashboard, DashboardRow } from "./types";

const row = (p: Partial<DashboardRow> & { symbol: string }): DashboardRow => ({
  symbol: p.symbol, name: null, sector: null, is_watch: false, positions: 1, shares: 100,
  invested: 4000, basis_per_share: 40, price: 42, current_value: 4200, unrealized: 200,
  day_change: 10, lilo_pct: -2, avg_52wk: 45, median_52wk: 44, pct_of_high: 0.8,
  portfolio_pct: 10, year_high: 52, year_low: 30, next_buy_price: 38, buy_mark: false,
  sell_mark: false, last_pos_cost: 2000, last_pos_profit: 100, log_profit: 0, trades: 3,
  year_profit: 0, year_trades: 0, avg_monthly: 0, first_buy_date: null, dividends: 0,
  total_return: 300, ...p,
});

const dash = (rows: DashboardRow[]): Dashboard => ({ mode: "live", total_invested: 4000, rows });

const sigs = (d: Dashboard) => new Map(d.rows.map((r) => [r.symbol, fillSig(r).sig]));

describe("demo feed", () => {
  it("a price tick NEVER changes a fill signature (so it can't strobe the table)", () => {
    const before = dash([row({ symbol: "ASTS" }), row({ symbol: "QBTS", shares: 50 }),
      row({ symbol: "IREN", is_watch: true, shares: 0, last_pos_cost: null, last_pos_profit: null })]);
    const beforeSigs = sigs(before);
    for (let i = 0; i < 25; i++) {
      const after = tickPrices(before);
      for (const r of after.rows) expect(fillSig(r).sig).toBe(beforeSigs.get(r.symbol));
    }
  });

  it("a price tick DOES move price + recompute aggregates", () => {
    const before = dash([row({ symbol: "ASTS" })]);
    const after = tickPrices(before);
    expect(after.rows[0].price).not.toBe(before.rows[0].price);
    // total_value recomputed from held rows
    expect(after.total_value).toBeCloseTo(after.rows[0].current_value ?? 0, 5);
  });

  it("a simulated fill changes exactly ONE row's fill signature (one flash, not a storm)", () => {
    const before = dash([row({ symbol: "ASTS" }), row({ symbol: "QBTS", shares: 60 }),
      row({ symbol: "LUNR", shares: 40 })]);
    const beforeSigs = sigs(before);
    for (let i = 0; i < 40; i++) {
      const after = simulateFill(before);
      if (!after) continue;
      const changed = after.rows.filter((r) => fillSig(r).sig !== beforeSigs.get(r.symbol));
      expect(changed.length).toBe(1);
    }
  });
});
