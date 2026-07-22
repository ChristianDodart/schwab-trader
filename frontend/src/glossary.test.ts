import { describe, it, expect } from "vitest";
import { GLOSSARY, TERM_IDS, SOURCE_LABEL } from "./glossary";

describe("glossary registry", () => {
  it("every entry has a term, a one-liner, and a valid source", () => {
    for (const [id, e] of Object.entries(GLOSSARY)) {
      expect(e.term, `${id}.term`).toBeTruthy();
      expect(e.oneLiner, `${id}.oneLiner`).toBeTruthy();
      expect(SOURCE_LABEL[e.source], `${id}.source is a known source`).toBeTruthy();
    }
  });

  it("every `related` id resolves to a real entry (no dangling cross-links)", () => {
    for (const [id, e] of Object.entries(GLOSSARY)) {
      for (const rel of e.related ?? []) {
        expect(GLOSSARY[rel], `${id} → related "${rel}" must exist`).toBeDefined();
      }
    }
  });

  it("computed/hybrid money terms explain how they're calculated", () => {
    // A number the app derives should say how — otherwise the 'Source' promise is empty.
    const mustExplain = ["invested", "unrealized_pl", "realized_pl", "leverage", "deployed_pct", "xirr"];
    for (const id of mustExplain) {
      expect(GLOSSARY[id]?.howCalculated, `${id}.howCalculated`).toBeTruthy();
    }
  });

  it("has a substantive seed set", () => {
    expect(TERM_IDS.length).toBeGreaterThanOrEqual(25);
  });

  it("no term links to itself", () => {
    for (const [id, e] of Object.entries(GLOSSARY)) {
      expect(e.related ?? [], `${id} self-link`).not.toContain(id);
    }
  });

  it("example() works the formula on live figures and returns null when data is missing", () => {
    const f = { longMarketValue: 5048.1, equity: 4677.55, deployedPct: 107.9,
                marketValue: 5200, invested: 5048.1, unrealized: 151.9 };
    const dep = GLOSSARY.deployed_pct.example!(f);
    expect(dep).toContain("÷");
    expect(dep).toContain("107.9%");
    const un = GLOSSARY.unrealized_pl.example!(f);
    expect(un).toContain("−");
    expect(un).toContain("+");        // positive unrealized gets a leading +
    // missing pieces → null, never a broken/NaN string
    expect(GLOSSARY.deployed_pct.example!({})).toBeNull();
    expect(GLOSSARY.leverage.example!({ longMarketValue: 100 })).toBeNull(); // no equity
  });

  it("example() guards divide-by-zero equity", () => {
    expect(GLOSSARY.deployed_pct.example!({ longMarketValue: 100, equity: 0, deployedPct: 0 })).toBeNull();
  });
});
