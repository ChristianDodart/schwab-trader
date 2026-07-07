import { useEffect, useState } from "react";
import { API } from "../api";
import { CHANGELOG, entryFor } from "../changelog";
import { SS } from "./ui";

// Render CHANGELOG body readably: leading "- " → "• ", drop the machine footer.
const prettyNotes = (body: string) =>
  body.split("\n")
    .filter((l) => !/^-{3,}$/.test(l.trim()) && !/^how to update/i.test(l.trim()))
    .map((l) => l.replace(/^[-*]\s+/, "• "))
    .join("\n").trim();

export function WhatsNew() {
  const [version, setVersion] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    fetch(`${API}/version`).then((r) => r.json()).then((j) => setVersion(j?.version ?? null)).catch(() => {});
  }, []);
  if (!CHANGELOG.length) return <p style={SS.credStatus}>No release notes bundled.</p>;
  const current = entryFor(version) ?? CHANGELOG[0];
  const list = showAll ? CHANGELOG : current ? [current] : [];
  return (
    <div>
      {list.map((e) => (
        <div key={e.version} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: "var(--fs-md)" }}>
            v{e.version}{e.title ? ` — ${e.title}` : ""}
            {e.version === version && <span style={S.nowTag}>you're on this</span>}
          </div>
          <div style={S.notesBody}>{prettyNotes(e.body)}</div>
        </div>
      ))}
      {CHANGELOG.length > 1 && (
        <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show only current" : "Show older versions"}
        </button>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  notesBody: { whiteSpace: "pre-wrap", color: "var(--text-muted)", fontSize: "var(--fs-sm)", marginTop: 4, lineHeight: 1.5 },
  nowTag: { fontSize: "var(--fs-2xs)", color: "var(--pos)", border: "1px solid var(--pos)", borderRadius: "var(--r-pill)", padding: "0 7px", marginLeft: 8, textTransform: "uppercase", letterSpacing: "0.04em" },
};
