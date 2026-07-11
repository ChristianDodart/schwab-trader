import { describe, it, expect } from "vitest";
import { defaultOrder, watchGroupSet } from "./DashboardTable";
import type { DashboardRow } from "./types";

// Minimal row factory — only the fields the default ordering reads.
const row = (p: Partial<DashboardRow> & { symbol: string }): DashboardRow =>
  ({ is_watch: false, last_pos_profit: null, underlying: null, ...p } as DashboardRow);

const syms = (rows: DashboardRow[]) => rows.map((r) => r.symbol);

describe("dashboard default ordering", () => {
  it("held profits descend, then losses (biggest first), then watchlist alphabetical", () => {
    const rows = [
      row({ symbol: "WLOW", is_watch: true }),
      row({ symbol: "LOSS_BIG", last_pos_profit: -10 }),
      row({ symbol: "WHIGH", is_watch: true }),
      row({ symbol: "GAIN_SM", last_pos_profit: 1 }),
      row({ symbol: "LOSS_SM", last_pos_profit: -1 }),
      row({ symbol: "GAIN_BIG", last_pos_profit: 10 }),
    ];
    expect(syms(defaultOrder(rows))).toEqual([
      "GAIN_BIG", "GAIN_SM",        // profits, biggest first
      "LOSS_BIG", "LOSS_SM",        // losses, biggest loss first
      "WHIGH", "WLOW",              // watchlist, alphabetical
    ]);
  });

  it("a held ETF under a watch-only underlying counts as a holding (not watchlist)", () => {
    // You hold RCAX (the 2x ETF, -3.08) but only WATCH its underlying RCAT.
    const rows = [
      row({ symbol: "AAA", is_watch: true }),                 // pure watch
      row({ symbol: "RCAT", is_watch: true }),                // watch-only underlying
      row({ symbol: "RCAX", last_pos_profit: -3.08, underlying: "RCAT" }), // held ETF
      row({ symbol: "QBTS", last_pos_profit: -28.4 }),        // held
    ];
    const ordered = defaultOrder(rows);
    // RCAT's group is placed by RCAX's P/L (-3.08), so it sits AMONG holdings — after the
    // bigger QBTS loss, and before the pure-watch AAA.
    expect(syms(ordered).filter((s) => s !== "RCAX")).toEqual(["QBTS", "RCAT", "AAA"]);
    // RCAT is NOT a watchlist group (you hold RCAX inside it); AAA is.
    const wg = watchGroupSet(rows);
    expect(wg.has("RCAT")).toBe(false);
    expect(wg.has("AAA")).toBe(true);
  });

  it("a watch parent with only watch children stays a watchlist group", () => {
    const rows = [
      row({ symbol: "IREN", is_watch: true }),
      row({ symbol: "IREX", is_watch: true, underlying: "IREN" }),
      row({ symbol: "HELD", last_pos_profit: 5 }),
    ];
    const wg = watchGroupSet(rows);
    expect(wg.has("IREN")).toBe(true);
    // HELD (a real holding) sorts above the IREN watch group.
    expect(syms(defaultOrder(rows)).indexOf("HELD")).toBeLessThan(
      syms(defaultOrder(rows)).indexOf("IREN"));
  });
});
