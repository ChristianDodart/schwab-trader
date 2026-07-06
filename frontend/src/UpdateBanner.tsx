import { useEffect, useState } from "react";

// A friendly "new version is ready" banner for the packaged desktop app. electron-updater
// downloads a newer GitHub release in the background; the main process forwards the events
// here (via the preload bridge). We show the patch notes + a one-click restart. If the user
// ignores it, the update still installs on the next quit — so "Later" is safe.
//
// No-op in the dev browser (window.desktop is undefined) and while nothing has downloaded.
type Downloaded = { version?: string; notes?: string | null };

// The release notes come from electron-updater. For the GitHub provider these arrive as
// GitHub's RENDERED HTML (from the releases atom feed) — <p>…</p>, <ul><li>…, entities —
// NOT the raw markdown, so a naive plaintext pass leaves literal "<p>" tags on screen.
// Normalize HTML → readable plain text, then strip our own heading + "How to update"
// footer. (Falls through gracefully if the notes happen to be markdown/plaintext.)
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function htmlToText(raw: string): string {
  return decodeEntities(
    raw
      .replace(/\r\n/g, "\n")
      .replace(/<\s*(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "\n• ")                 // list item → bullet
      .replace(/<\s*\/\s*(p|div|h[1-6]|ul|ol|li|tr)\s*>/gi, "\n")  // block ends → newline
      .replace(/<[^>]+>/g, "")                            // drop every remaining tag
  );
}

export function cleanNotes(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = /<[a-z!/][^>]*>/i.test(raw) ? htmlToText(raw) : raw.replace(/\r\n/g, "\n");
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) { if (out.length && out[out.length - 1] !== "") out.push(""); continue; }  // collapse blanks
    if (/^#{1,6}\s/.test(t)) continue;                  // markdown heading
    if (/^v?\d+\.\d+\.\d+\b/i.test(t) && out.length === 0) continue;  // leading "vX — title" heading (HTML-stripped)
    if (/^-{3,}$/.test(t)) break;                        // horizontal rule → footer starts
    if (/^how to update/i.test(t)) break;               // our appended footer
    out.push(t.replace(/^[-*]\s+/, "• "));
  }
  return out.join("\n").trim();
}

export function UpdateBanner() {
  const desktop = typeof window !== "undefined" ? window.desktop : undefined;
  const [info, setInfo] = useState<Downloaded | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!desktop?.onUpdateDownloaded) return;
    const offDown = desktop.onUpdateDownloaded((i) => { setInfo(i); setDismissed(false); });
    const offAvail = desktop.onUpdateAvailable?.((i) => setDownloading(i?.version ?? ""));
    return () => { offDown?.(); offAvail?.(); };
  }, [desktop]);

  // "Downloading…" is a quiet, dismissible heads-up; the real moment is when it's ready.
  if (!info && downloading != null && !dismissed) {
    return (
      <div style={{ ...S.bar, ...S.downloading }} role="status">
        <span style={S.msg}>Downloading update{downloading ? ` ${downloading}` : ""}… you can keep working; we'll let you know when it's ready.</span>
        <button style={S.x} title="Hide" onClick={() => setDismissed(true)}>✕</button>
      </div>
    );
  }

  if (!info || dismissed) return null;

  const notes = cleanNotes(info.notes);
  const restart = () => {
    setRestarting(true);
    desktop?.installUpdate?.().catch(() => setRestarting(false));
  };

  return (
    <div style={{ ...S.bar, ...S.ready }} role="dialog" aria-label="Update ready">
      <div style={{ flex: 1 }}>
        <div style={S.title}>
          Version {info.version || "update"} is ready to install
        </div>
        {notes && <div style={S.notes}>{notes}</div>}
        <div style={S.hint}>
          Click Restart to update now (a few seconds), or just close and reopen the app later —
          either way your data and settings stay exactly as they are.
        </div>
      </div>
      <div style={S.actions}>
        <button className="btn btn-primary" disabled={restarting} onClick={restart}>
          {restarting ? "Restarting…" : "Restart & update"}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => setDismissed(true)}>Later</button>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  bar: { display: "flex", alignItems: "flex-start", gap: 16, border: "1px solid", borderRadius: "var(--r-lg)", padding: "12px 16px", marginTop: 14 },
  ready: { background: "var(--accent-bg, rgba(74,144,226,0.10))", borderColor: "var(--accent)" },
  downloading: { background: "var(--panel-2)", borderColor: "var(--border)", alignItems: "center" },
  title: { fontSize: "var(--fs-md)", fontWeight: 700, color: "var(--text)" },
  notes: { fontSize: "var(--fs-sm)", color: "var(--text-muted)", marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.5 },
  hint: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", marginTop: 8, lineHeight: 1.45 },
  msg: { color: "var(--text-muted)", flex: 1, fontSize: "var(--fs-sm)" },
  actions: { display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch", flexShrink: 0 },
  x: { background: "transparent", color: "var(--text-muted)", border: "none", fontSize: "var(--fs-md)", cursor: "pointer", padding: "0 4px" },
};
