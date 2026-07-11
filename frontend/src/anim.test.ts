import { describe, it, expect } from "vitest";
import { computeFillChanges, fillSig, type FillRow, type FillSig } from "./anim";

const row = (p: Partial<FillRow> & { symbol: string }): FillRow =>
  ({ shares: 0, last_pos_cost: null, is_watch: false, ...p });

const snapshot = (rows: FillRow[]): Map<string, FillSig> => {
  const m = new Map<string, FillSig>();
  for (const r of rows) m.set(r.symbol, fillSig(r));
  return m;
};

describe("fill flash — anti-strobe discipline", () => {
  it("a price/P&L-only tick does NOT flash (signature is fill-only)", () => {
    const before = [row({ symbol: "ASTS", shares: 100, last_pos_cost: 4000 })];
    const prev = snapshot(before);
    // Same position, but the payload's price/P&L fields changed — those aren't in FillRow,
    // so the row we hand the differ is identical → no change.
    const after = [row({ symbol: "ASTS", shares: 100, last_pos_cost: 4000 })];
    expect(computeFillChanges(prev, after)).toEqual([]);
  });

  it("buying more shares flashes 'buy'; trimming flashes 'sell'", () => {
    const prev = snapshot([row({ symbol: "QBTS", shares: 50, last_pos_cost: 1000 })]);
    expect(computeFillChanges(prev, [row({ symbol: "QBTS", shares: 80, last_pos_cost: 1600 })]))
      .toEqual([{ symbol: "QBTS", dir: "buy" }]);
    expect(computeFillChanges(prev, [row({ symbol: "QBTS", shares: 20, last_pos_cost: 400 })]))
      .toEqual([{ symbol: "QBTS", dir: "sell" }]);
  });

  it("selling out (shares → 0, becomes watch) flashes 'sell'", () => {
    const prev = snapshot([row({ symbol: "LUNR", shares: 30, last_pos_cost: 300 })]);
    expect(computeFillChanges(prev, [row({ symbol: "LUNR", shares: 0, last_pos_cost: null, is_watch: true })]))
      .toEqual([{ symbol: "LUNR", dir: "sell" }]);
  });

  it("a newly-appeared symbol never flashes on first sight", () => {
    const prev = snapshot([row({ symbol: "ASTS", shares: 100 })]);
    const after = [row({ symbol: "ASTS", shares: 100 }), row({ symbol: "RCAT", shares: 10, last_pos_cost: 90 })];
    expect(computeFillChanges(prev, after)).toEqual([]);
  });

  it("average-cost recalc (same shares, new cost) flashes as a fill", () => {
    const prev = snapshot([row({ symbol: "ASTS", shares: 100, last_pos_cost: 4000 })]);
    // Same share count but cost basis moved — a fill happened (add + partial, etc.).
    expect(computeFillChanges(prev, [row({ symbol: "ASTS", shares: 100, last_pos_cost: 4200 })]))
      .toEqual([{ symbol: "ASTS", dir: "buy" }]);
  });
});
