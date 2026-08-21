import { describe, it, expect } from "vitest";
import { defaultTiming, describeTiming } from "./orderTiming";

describe("defaultTiming", () => {
  it("regular hours → MARKET/NORMAL and keeps the remembered duration", () => {
    expect(defaultTiming("regular", "GOOD_TILL_CANCEL")).toEqual({
      orderType: "MARKET", session: "NORMAL", duration: "GOOD_TILL_CANCEL",
    });
    expect(defaultTiming("regular", "DAY")).toEqual({ orderType: "MARKET", session: "NORMAL", duration: "DAY" });
  });

  it("pre-market → LIMIT/AM/DAY", () => {
    expect(defaultTiming("pre", "DAY")).toEqual({ orderType: "LIMIT", session: "AM", duration: "DAY" });
  });

  it("post-market → LIMIT/PM/DAY", () => {
    expect(defaultTiming("post", "DAY")).toEqual({ orderType: "LIMIT", session: "PM", duration: "DAY" });
  });

  it("never forces GTC on an extended session (GTC+AM/PM is an invalid Schwab combo)", () => {
    // Even if the user's remembered duration is GTC, extended defaults must be DAY.
    expect(defaultTiming("pre", "GOOD_TILL_CANCEL")!.duration).toBe("DAY");
    expect(defaultTiming("post", "GOOD_TILL_CANCEL")!.duration).toBe("DAY");
  });

  // The bug fix: any non-confirmed session must NOT silently become regular-hours-only.
  it.each(["closed", "unknown", "weird-value"])(
    "uncertain session %s → LIMIT/SEAMLESS/DAY (eligible in any live session)",
    (s) => {
      expect(defaultTiming(s, "GOOD_TILL_CANCEL")).toEqual({
        orderType: "LIMIT", session: "SEAMLESS", duration: "DAY",
      });
    },
  );

  it("returns null while the session is still unknown (null)", () => {
    expect(defaultTiming(null, "DAY")).toBeNull();
  });
});

describe("describeTiming", () => {
  it("SEAMLESS reads as regular + extended eligible", () => {
    expect(describeTiming("SEAMLESS", "DAY")).toMatch(/regular and extended hours/i);
  });

  it("NORMAL warns it won't trade after hours", () => {
    expect(describeTiming("NORMAL", "DAY")).toMatch(/regular hours only/i);
    expect(describeTiming("NORMAL", "DAY")).toMatch(/won't trade/i);
  });

  it("AM/PM describe the extended window", () => {
    expect(describeTiming("AM", "DAY")).toMatch(/pre-market/i);
    expect(describeTiming("PM", "DAY")).toMatch(/after-hours/i);
  });

  it("flags the invalid GTC + extended-hours combo for every extended session", () => {
    for (const s of ["AM", "PM", "SEAMLESS"]) {
      expect(describeTiming(s, "GOOD_TILL_CANCEL")).toMatch(/good-til-canceled isn't allowed/i);
    }
  });

  it("NORMAL + GTC notes it rests day-to-day (a valid combo)", () => {
    expect(describeTiming("NORMAL", "GOOD_TILL_CANCEL")).toMatch(/day-to-day/i);
  });
});
