import { describe, it, expect } from "vitest";
import { cleanNotes } from "./UpdateBanner";

describe("cleanNotes", () => {
  it("renders GitHub's HTML release notes as readable text (the real banner input)", () => {
    // electron-updater's GitHub provider returns rendered HTML from the releases atom feed.
    const html = "<h2>v0.20.0 — At a glance</h2><p>New this version:</p><ul><li>Bulk Exit &amp; grouping</li><li>Fixed the <code>banner</code></li></ul><hr><p>How to update: restart</p>";
    const out = cleanNotes(html);
    expect(out).not.toMatch(/<[a-z]/i);          // no raw tags survive
    expect(out).toContain("• Bulk Exit & grouping"); // list item → bullet, entity decoded
    expect(out).toContain("• Fixed the banner");
    expect(out).not.toMatch(/v0\.20\.0/);         // leading version heading dropped
    expect(out).not.toMatch(/how to update/i);    // footer stripped at the <hr>
  });

  it("still handles plain markdown notes", () => {
    const md = "## v0.20.0\n- First thing\n- Second thing\n---\nHow to update: restart";
    const out = cleanNotes(md);
    expect(out).toBe("• First thing\n• Second thing");
  });

  it("is empty for nullish input", () => {
    expect(cleanNotes(null)).toBe("");
    expect(cleanNotes(undefined)).toBe("");
    expect(cleanNotes("")).toBe("");
  });
});
