import { describe, expect, it } from "vitest";
import { sanitizeColumnIds } from "./columns";

const valid = new Set(["a", "b", "c"]);

describe("sanitizeColumnIds", () => {
  it("drops unknown ids, preserving order", () => {
    expect(sanitizeColumnIds(["a", "x", "b"], valid)).toEqual(["a", "b"]);
  });
  it("de-dupes, keeping first occurrence", () => {
    expect(sanitizeColumnIds(["b", "a", "b", "a"], valid)).toEqual(["b", "a"]);
  });
  it("honors an explicitly-empty array (user removed all columns)", () => {
    expect(sanitizeColumnIds([], valid)).toEqual([]);
  });
  it("returns null for non-arrays / corrupt input (caller falls back to defaults)", () => {
    expect(sanitizeColumnIds(null, valid)).toBeNull();
    expect(sanitizeColumnIds("nope", valid)).toBeNull();
    expect(sanitizeColumnIds({ a: 1 }, valid)).toBeNull();
  });
  it("returns null when input had entries but none were valid", () => {
    expect(sanitizeColumnIds(["x", "y"], valid)).toBeNull();
  });
  it("accepts a plain array as the valid set", () => {
    expect(sanitizeColumnIds(["a", "z"], ["a", "z"])).toEqual(["a", "z"]);
  });
});
