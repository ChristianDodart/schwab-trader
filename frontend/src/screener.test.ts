import { describe, expect, it } from "vitest";
import { fmtCap, fmtVol } from "./Screener";

describe("fmtVol", () => {
  it("scales B/M/K with the right precision", () => {
    expect(fmtVol(2_500_000_000)).toBe("2.50B");
    expect(fmtVol(3_400_000)).toBe("3.4M");
    expect(fmtVol(12_000)).toBe("12K");
    expect(fmtVol(950)).toBe("950");
  });
  it("handles null", () => {
    expect(fmtVol(null)).toBe("—");
  });
});

describe("fmtCap", () => {
  it("scales T/B/M with a $ prefix", () => {
    expect(fmtCap(4_500_000_000_000)).toBe("$4.50T");
    expect(fmtCap(23_000_000_000)).toBe("$23.00B");
    expect(fmtCap(750_000_000)).toBe("$750M");
  });
  it("handles null/undefined", () => {
    expect(fmtCap(null)).toBe("—");
    expect(fmtCap(undefined)).toBe("—");
  });
});
