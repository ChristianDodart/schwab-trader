import { describe, expect, it } from "vitest";
import { ladderPreviewRows, sizingSentence } from "./FinancialRules";

describe("ladderPreviewRows", () => {
  const drops = [
    { up_to_rung: 2, drop_pct: 0.1 },
    { up_to_rung: 7, drop_pct: 0.13 },
    { up_to_rung: 10, drop_pct: 0.16 },
  ];
  it("starts at $100 rung 1 with no drop", () => {
    const rows = ladderPreviewRows(drops, 10);
    expect(rows[0]).toEqual({ rung: 1, price: 100, drop: 0 });
  });
  it("applies the right tier drop per rung", () => {
    const rows = ladderPreviewRows(drops, 10);
    expect(rows[1].drop).toBe(0.1);   // rung 2 → 10%
    expect(rows[1].price).toBeCloseTo(90, 6);
    expect(rows[2].drop).toBe(0.13);  // rung 3 → 13%
    expect(rows[2].price).toBeCloseTo(90 * 0.87, 6);
  });
  it("caps at 6 rows shown regardless of maxRungs", () => {
    expect(ladderPreviewRows(drops, 10)).toHaveLength(6);
    expect(ladderPreviewRows(drops, 3)).toHaveLength(3);
  });
  it("tolerates unsorted drops + falls back to the last tier past its range", () => {
    const unsorted = [{ up_to_rung: 10, drop_pct: 0.16 }, { up_to_rung: 2, drop_pct: 0.1 }];
    const rows = ladderPreviewRows(unsorted, 3);
    expect(rows[1].drop).toBe(0.1);   // rung 2 still resolves to the 10% tier
    expect(rows[2].drop).toBe(0.16);  // rung 3 falls to the deepest tier
  });
  it("empty drops → flat $100 rungs (no crash)", () => {
    const rows = ladderPreviewRows([], 3);
    expect(rows.every((r) => r.price === 100)).toBe(true);
  });
});

describe("sizingSentence", () => {
  it("collapses a single-rung tier to 'rung N'", () => {
    expect(sizingSentence([{ up_to_rungs: 1, dollars: 500 }])).toContain("rung 1: $500");
  });
  it("renders ranges + the full example", () => {
    const s = sizingSentence([
      { up_to_rungs: 2, dollars: 500 },
      { up_to_rungs: 7, dollars: 1000 },
    ]);
    expect(s).toContain("rungs 1–2: $500");
    expect(s).toContain("rungs 3–7: $1,000");
    expect(s.startsWith("Example:")).toBe(true);
  });
  it("empty tiers → empty string", () => {
    expect(sizingSentence([])).toBe("");
  });
});
