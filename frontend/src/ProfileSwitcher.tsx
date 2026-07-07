import { useEffect, useRef, useState } from "react";

// A "profile" = one Schwab login (Christian, Dave, …), each with its own OAuth
// token + saved layout/selection. Switching reloads the app so every view
// re-reads under the new profile. Connecting an unconnected profile happens via
// the existing AuthBanner (which reflects the ACTIVE profile's token).
import { API } from "./api";

type ProfStatus = { authorized: boolean; severity: string; days_left: number | null; message: string };
type Prof = { id: string; name: string; active: boolean; connected: boolean; status: ProfStatus };

export function ProfileSwitcher() {
  const [profiles, setProfiles] = useState<Prof[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => { setOpen(false); setConfirmDel(null); setAdding(false); triggerRef.current?.focus(); };

  const load = () =>
    fetch(`${API}/profiles`).then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.profiles)) setProfiles(d.profiles); })
      .catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setConfirmDel(null); setAdding(false); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const active = profiles.find((p) => p.active);
  const dotColor = (p: Prof) =>
    p.connected && p.status.authorized ? "var(--pos)" : p.connected ? "var(--warn)" : "var(--text-faint)";

  const activate = (id: string) => {
    if (busy) return;
    setBusy(true);
    fetch(`${API}/profiles/${id}/activate`, { method: "POST" })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) window.location.reload(); else setBusy(false); })
      .catch(() => setBusy(false));
  };
  const addProfile = () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    fetch(`${API}/profiles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })
      .then((r) => r.json())
      .then((j) => { if (j?.id) activate(j.id); else setBusy(false); })  // activate → reload → AuthBanner prompts connect
      .catch(() => setBusy(false));
  };
  const del = (id: string) => {
    fetch(`${API}/profiles/${id}`, { method: "DELETE" })
      .then((r) => r.json())
      .then(() => { setConfirmDel(null); load(); })
      .catch(() => {});
  };

  return (
    <div ref={ref} style={S.wrap}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); closeMenu(); } }}>
      <button ref={triggerRef} className="btn btn-secondary btn-sm" style={S.trigger} onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu" aria-expanded={open} title="Switch trading profile">
        <span style={{ ...S.dot, background: active ? dotColor(active) : "var(--text-faint)" }} aria-hidden="true" />
        <span style={S.who}>{active ? active.name : "Profile"}</span>
        <span aria-hidden="true" style={{ opacity: 0.6 }}>▾</span>
      </button>

      {open && (
        <div role="menu" style={S.pop}>
          <div style={S.popLabel}>Trading profile</div>
          {profiles.map((p) => (
            <div key={p.id} style={{ ...S.item, ...(p.active ? S.itemActive : null) }}>
              <button role="menuitem" style={S.itemMain} disabled={busy} onClick={() => !p.active && activate(p.id)}>
                <span style={{ ...S.dot, background: dotColor(p) }} aria-hidden="true" />
                <span style={{ fontWeight: p.active ? 700 : 500 }}>{p.name}</span>
                <span style={S.itemStatus}>
                  {p.active ? "active" : p.connected ? (p.status.authorized ? "connected" : "expired") : "not connected"}
                </span>
              </button>
              {confirmDel === p.id ? (
                <span style={S.confirmRow}>
                  <button className="btn btn-danger btn-sm" onClick={() => del(p.id)}>Delete</button>
                  <button className="btn btn-ghost btn-sm" aria-label="Cancel delete" onClick={() => setConfirmDel(null)}>✕</button>
                </span>
              ) : (
                !p.active && (
                  <button className="btn btn-ghost btn-sm" title={`Delete ${p.name}`} aria-label={`Delete ${p.name}`}
                    onClick={() => setConfirmDel(p.id)}>✕</button>
                )
              )}
            </div>
          ))}

          <div style={S.divider} />
          {adding ? (
            <div style={S.addRow}>
              <input className="field" autoFocus placeholder="Name (e.g. Dave)" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addProfile(); if (e.key === "Escape") { e.stopPropagation(); setAdding(false); } }}
                style={{ height: 30, flex: 1 }} aria-label="New profile name" />
              <button className="btn btn-primary btn-sm" disabled={busy || !newName.trim()} onClick={addProfile}>Add</button>
              <button className="btn btn-ghost btn-sm" aria-label="Cancel adding profile" onClick={() => { setAdding(false); setNewName(""); }}>✕</button>
            </div>
          ) : (
            <button role="menuitem" style={S.addBtn} onClick={() => setAdding(true)}>+ Add profile</button>
          )}
          <p style={S.hint}>Switching reloads the app with that profile's Schwab login, accounts, and layout. A new profile starts disconnected — connect it from the banner.</p>
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: "relative", display: "inline-block" },
  trigger: { display: "inline-flex", alignItems: "center", gap: 7 },
  dot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  who: { fontWeight: 600, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pop: { position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, minWidth: 260, background: "var(--pop)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", boxShadow: "var(--elev-2)", padding: 6 },
  popLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)", padding: "4px 8px 6px" },
  item: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, borderRadius: "var(--r-sm)", paddingRight: 4 },
  itemActive: { background: "var(--panel-2)" },
  itemMain: { flex: 1, display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", padding: "8px 8px", textAlign: "left", fontSize: "var(--fs-sm)" },
  itemStatus: { marginLeft: "auto", fontSize: "var(--fs-2xs)", color: "var(--text-dim)" },
  confirmRow: { display: "inline-flex", gap: 4, alignItems: "center" },
  divider: { height: 1, background: "var(--border-hairline)", margin: "6px 4px" },
  addRow: { display: "flex", gap: 6, alignItems: "center", padding: "2px 4px" },
  addBtn: { width: "100%", textAlign: "left", background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", padding: "8px", fontSize: "var(--fs-sm)", fontWeight: 600, borderRadius: "var(--r-sm)" },
  hint: { fontSize: "var(--fs-2xs)", color: "var(--text-faint)", padding: "6px 8px 2px", lineHeight: 1.5, margin: 0 },
};
