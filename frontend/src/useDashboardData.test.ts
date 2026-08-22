import { describe, it, expect } from "vitest";
import { pricesAreStale } from "./useDashboardData";

describe("pricesAreStale", () => {
  it("is stale when Schwab liveness is explicitly false (real feed)", () => {
    expect(pricesAreStale("schwab", false)).toBe(true);
    expect(pricesAreStale(undefined, false)).toBe(true);
  });

  it("is not stale while liveness is still unknown (null) — only an explicit false dims", () => {
    expect(pricesAreStale("schwab", null)).toBe(false);
    expect(pricesAreStale(undefined, null)).toBe(false);
  });

  it("is not stale when live", () => {
    expect(pricesAreStale("schwab", true)).toBe(false);
  });

  it("a demo feed is never 'stale' — it isn't meant to be live", () => {
    expect(pricesAreStale("demo", false)).toBe(false);
    expect(pricesAreStale("demo", null)).toBe(false);
  });
});
