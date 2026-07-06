// The patch notes, bundled straight from the repo-root CHANGELOG.md (the same file the
// build script pushes into each GitHub release body). One source of truth: the update
// banner shows the incoming version's notes; this powers an always-available "What's new"
// panel + the "you're now on vX" toast.
import raw from "../../CHANGELOG.md?raw";

export type ChangelogEntry = { version: string; title: string; body: string };

// Sections look like:  ## v0.7.0 — "Some title"   (title optional; em-dash or hyphen)
export function parseChangelog(md: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^##\s+v(\d+\.\d+\.\d+)\s*(?:[—-]\s*"?(.*?)"?)?\s*$/);
    if (m) {
      if (cur) out.push(cur);
      cur = { version: m[1], title: (m[2] || "").trim(), body: "" };
    } else if (cur) {
      cur.body += line + "\n";
    }
  }
  if (cur) out.push(cur);
  return out.map((e) => ({ ...e, body: e.body.trim() }));
}

export const CHANGELOG: ChangelogEntry[] = parseChangelog(raw);

export const entryFor = (version?: string | null): ChangelogEntry | null =>
  version ? CHANGELOG.find((e) => e.version === version) ?? null : null;
