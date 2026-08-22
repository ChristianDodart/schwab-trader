import { describe, it, expect } from "vitest";
import { comboError, offerableTypes } from "./orderEligibility";

const ALL = ["LIMIT", "MARKET", "STOP", "STOP_LIMIT", "TRAILING_STOP"];

describe("comboError (mirror of the server broker rule)", () => {
  it("accepts valid combinations (null)", () => {
    expect(comboError("MARKET", "NORMAL", "DAY")).toBeNull();
    expect(comboError("LIMIT", "SEAMLESS", "DAY")).toBeNull();
    expect(comboError("LIMIT", "NORMAL", "GOOD_TILL_CANCEL")).toBeNull();
  });

  it("rejects any non-LIMIT type in an extended session", () => {
    for (const s of ["AM", "PM", "SEAMLESS"]) {
      expect(comboError("MARKET", s, "DAY")).toMatch(/extended-hours session/i);
      expect(comboError("STOP_LIMIT", s, "DAY")).toMatch(/limit order/i);
      expect(comboError("TRAILING_STOP", s, "DAY")).toBeTruthy();
    }
  });

  it("rejects good-till-canceled in an extended session", () => {
    for (const s of ["AM", "PM", "SEAMLESS"]) {
      expect(comboError("LIMIT", s, "GOOD_TILL_CANCEL")).toMatch(/good-till-canceled/i);
    }
  });

  it("is case-insensitive and treats blanks as NORMAL/DAY", () => {
    expect(comboError("market", "am", "day")).toBeTruthy();
    expect(comboError("MARKET", "", "")).toBeNull();
  });
});

describe("offerableTypes (shared clock affordance)", () => {
  it("offers the full menu in confirmed regular hours", () => {
    expect(offerableTypes("regular", ALL)).toEqual(ALL);
    expect(offerableTypes("regular", ["LIMIT", "MARKET"])).toEqual(["LIMIT", "MARKET"]);
  });

  it("keeps the full menu while the clock is still loading (null)", () => {
    // Preserves both tickets' pre-resolution behavior — MARKET stays enabled for the beat
    // before /market-hours answers, then re-restricts.
    expect(offerableTypes(null, ALL)).toEqual(ALL);
  });

  it("restricts to a price-protected LIMIT outside confirmed regular hours", () => {
    for (const s of ["pre", "post", "closed", "unknown", "weird-value"]) {
      expect(offerableTypes(s, ALL)).toEqual(["LIMIT"]);
      // Bulk's LIMIT/MARKET menu → MARKET disabled outside regular.
      expect(offerableTypes(s, ["LIMIT", "MARKET"])).toEqual(["LIMIT"]);
    }
  });
});
