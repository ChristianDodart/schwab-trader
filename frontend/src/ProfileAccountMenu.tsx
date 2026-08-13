import { useEffect, useRef, useState } from "react";

// One top-right menu that does BOTH context switches, consolidating the old
// ContextChip + ProfileSwitcher + AccountPicker:
//   • a "profile" = one Schwab login (own token/creds) — switching HARD-reloads
//     the app so every view re-reads under that login.
//   • an "account" = a Schwab account under the active profile — switching is a
//     SOFT state update (App owns the server select via onSelectAccount).
// Re-auth is intentionally NOT here — the header AuthBanner + Settings own that;
// this menu only reflects connection status through the dots.
import { API } from "./api";
import { usd } from "./format";
import { IconClose, IconPlus, IconEdit, IconCheck } from "./Icon";

type ProfStatus = { authorized: boolean; severity: string; days_left: number | null; message: string };
type Prof = { id: string; name: string; active: boolean; connected: boolean; status: ProfStatus };
type Account = {
  hash: string;
  mask: string;
  type: string | null;
  liquidation_value: number | null;
  cash: number | null;
  positions_count: number | null;
  day_profit: number | null;
  invested: number | null;
  tradable: boolean;
};

export function ProfileAccountMenu({ acctKey, onSelectAccount }: {
  acctKey: string;
  onSelectAccount: (hash: string) => void;
}) {
  const [profiles, setProfiles] = useState<Prof[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selHash, setSelHash] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const resetRows = () => { setConfirmDel(null); setAdding(false); setRenaming(null); };
  const closeMenu = () => { setOpen(false); resetRows(); triggerRef.current?.focus(); };

  // Refetchers — fired on mount, on acctKey change, on menu-open (data can be
  // minutes stale), and after any profile CRUD so the list stays in sync.
  const loadProfiles = () =>
    fetch(`${API}/profiles`).then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.profiles)) setProfiles(d.profiles); })
      .catch(() => {});
  const loadAccounts = () =>
    fetch(`${API}/accounts`).then((r) => r.json())
      .then((j) => { setAccounts(j.accounts ?? []); setSelHash(j.selected_hash ?? null); })
      .catch(() => {});

  useEffect(() => { loadProfiles(); }, []);
  // Re-read accounts whenever the active account changes so mask/numbers stay in sync.
  useEffect(() => { loadAccounts(); }, [acctKey]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); resetRows(); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const active = profiles.find((p) => p.active);
  const dotColor = (p: { connected: boolean; status: { authorized: boolean } }) =>
    p.connected && p.status?.authorized ? "var(--pos)" : p.connected ? "var(--warn)" : "var(--text-faint)";

  const cur = acctKey || selHash || "";
  const selAcct = accounts.find((a) => a.hash === cur);

  const toggle = () => setOpen((v) => {
    const nv = !v;
    if (nv) { loadProfiles(); loadAccounts(); }   // refresh on open
    else resetRows();
    return nv;
  });

  // --- Profile actions (mirrors ProfileSwitcher) ---
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
      .then(() => { setConfirmDel(null); loadProfiles(); })
      .catch(() => {});
  };
  const startRename = (p: Prof) => { resetRows(); setRenameName(p.name); setRenaming(p.id); };
  const rename = (id: string) => {
    const name = renameName.trim();
    if (!name || busy) { setRenaming(null); return; }
    // Rename only changes the label (id is stable) — no reload, just refresh the list.
    fetch(`${API}/profiles/${id}/rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })
      .then((r) => r.json())
      .then(() => { setRenaming(null); loadProfiles(); })
      .catch(() => setRenaming(null));
  };

  // --- Account action (SOFT switch; App owns the server select) ---
  const pickAccount = (hash: string) => { onSelectAccount(hash); closeMenu(); };

  return (
    <div ref={ref} style={S.wrap}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); closeMenu(); } }}>
      {/* TRIGGER — identical to the old ContextChip: status dot + profile · account */}
      <button ref={triggerRef} className="btn btn-secondary btn-sm" style={S.chip} onClick={toggle}
        aria-haspopup="menu" aria-expanded={open} title="Profile & account — click to switch">
        <span style={{ ...S.dot, background: active ? dotColor(active) : "var(--text-faint)" }} aria-hidden="true" />
        <span style={S.who}>{active?.name ?? "Profile"}</span>
        <span style={S.sep} aria-hidden="true">·</span>
        <span style={S.acct}>{selAcct ? selAcct.mask : "No account"}</span>
      </button>

      {open && (
        <div role="menu" style={S.pop}>
          {/* ---- PROFILE ---- */}
          <div style={S.popLabel}>Profile</div>
          {profiles.map((p) => (
            <div key={p.id} style={{ ...S.item, ...(p.active ? S.itemActive : null) }}>
              {renaming === p.id ? (
                <span style={S.addRow}>
                  <input className="field" autoFocus value={renameName} maxLength={64}
                    onChange={(e) => setRenameName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") rename(p.id); if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }}
                    style={{ height: 30, flex: 1 }} aria-label={`Rename ${p.name}`} />
                  <button className="btn btn-primary btn-sm" disabled={!renameName.trim()} aria-label="Save name" onClick={() => rename(p.id)}><IconCheck /></button>
                  <button className="btn btn-ghost btn-sm" aria-label="Cancel rename" onClick={() => setRenaming(null)}><IconClose /></button>
                </span>
              ) : (
                <>
                  <button role="menuitem" style={S.itemMain} disabled={busy} onClick={() => !p.active && activate(p.id)}>
                    <span style={{ ...S.dot, background: dotColor(p) }} aria-hidden="true" />
                    <span style={{ fontWeight: p.active ? 700 : 500, color: p.active ? "var(--accent)" : undefined }}>{p.name}</span>
                    {p.active && <span aria-hidden="true" style={S.check}><IconCheck size={13} /></span>}
                    <span style={S.itemStatus}>
                      {p.active ? "active" : p.connected ? (p.status.authorized ? "connected" : "expired") : "not connected"}
                    </span>
                  </button>
                  {confirmDel === p.id ? (
                    <span style={S.confirmRow}>
                      <button className="btn btn-danger btn-sm" onClick={() => del(p.id)}>Delete</button>
                      <button className="btn btn-ghost btn-sm" aria-label="Cancel delete" onClick={() => setConfirmDel(null)}><IconClose /></button>
                    </span>
                  ) : (
                    <span style={S.confirmRow}>
                      <button className="btn btn-ghost btn-sm" title={`Rename ${p.name}`} aria-label={`Rename ${p.name}`}
                        onClick={() => startRename(p)}><IconEdit /></button>
                      {!p.active && (
                        <button className="btn btn-ghost btn-sm" title={`Delete ${p.name}`} aria-label={`Delete ${p.name}`}
                          onClick={() => setConfirmDel(p.id)}><IconClose /></button>
                      )}
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
          {adding ? (
            <div style={S.addRow}>
              <input className="field" autoFocus placeholder="Name (e.g. Dave)" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addProfile(); if (e.key === "Escape") { e.stopPropagation(); setAdding(false); } }}
                style={{ height: 30, flex: 1 }} aria-label="New profile name" />
              <button className="btn btn-primary btn-sm" disabled={busy || !newName.trim()} onClick={addProfile}>Add</button>
              <button className="btn btn-ghost btn-sm" aria-label="Cancel adding profile" onClick={() => { setAdding(false); setNewName(""); }}><IconClose /></button>
            </div>
          ) : (
            <button role="menuitem" style={S.addBtn} onClick={() => setAdding(true)}><IconPlus /> Add profile</button>
          )}

          {/* ---- ACCOUNT ---- */}
          <div style={S.divider} />
          <div style={S.popLabel}>Account</div>
          {accounts.length === 0 ? (
            <p style={S.empty}>No accounts on this profile.</p>
          ) : accounts.map((a) => {
            const sel = a.hash === cur;
            const dp = a.day_profit;
            return (
              <button key={a.hash} role="menuitem" style={{ ...S.acctRow, ...(sel ? S.acctRowSel : null) }}
                onClick={() => pickAccount(a.hash)}
                title={sel ? "Selected account" : `Switch to ${a.mask}`}>
                <span style={S.acctLeft}>
                  <span style={S.acctName}>
                    <b style={{ fontWeight: sel ? 700 : 600 }}>{a.mask}</b>
                    <span style={S.acctType}> · {a.type ?? "?"}</span>
                  </span>
                  {!a.tradable && <span style={S.restricted}>restricted</span>}
                  {sel && <span aria-hidden="true" style={S.check}><IconCheck size={13} /></span>}
                </span>
                <span style={S.acctRight}>
                  <span style={S.acctVal}>{usd(a.liquidation_value)}</span>
                  {/* signed + money-colored day P/L, as AccountPicker's rollup does */}
                  <span style={{ ...S.acctDay, color: (dp ?? 0) > 0 ? "var(--pos)" : (dp ?? 0) < 0 ? "var(--neg)" : "var(--text-muted)" }}>
                    {dp != null ? `${dp > 0 ? "+" : ""}${usd(dp)}` : "—"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { position: "relative", display: "inline-block" },
  // Trigger — copied from the old ContextChip
  chip: { display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 260 },
  dot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  who: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 },
  sep: { opacity: 0.5 },
  acct: { color: "var(--text-muted)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 },
  // Popover — right-aligned under the trigger (it lives in the top-right corner)
  pop: { position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, minWidth: 300, maxWidth: 360,
    background: "var(--pop)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", boxShadow: "var(--elev-2)", padding: 6 },
  popLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)", padding: "4px 8px 6px" },
  // Profile rows (from ProfileSwitcher)
  item: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, borderRadius: "var(--r-sm)", paddingRight: 4 },
  itemActive: { background: "var(--panel-2)" },
  itemMain: { flex: 1, display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", padding: "8px 8px", textAlign: "left", fontSize: "var(--fs-sm)" },
  itemStatus: { marginLeft: "auto", fontSize: "var(--fs-2xs)", color: "var(--text-dim)" },
  check: { display: "inline-flex", color: "var(--accent)", flexShrink: 0 },
  confirmRow: { display: "inline-flex", gap: 4, alignItems: "center" },
  divider: { height: 1, background: "var(--border-hairline)", margin: "6px 4px" },
  addRow: { display: "flex", gap: 6, alignItems: "center", padding: "2px 4px" },
  addBtn: { width: "100%", textAlign: "left", background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", padding: "8px", fontSize: "var(--fs-sm)", fontWeight: 600, borderRadius: "var(--r-sm)" },
  // Account rows (consolidated from AccountPicker's rollup cards)
  acctRow: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
    background: "transparent", border: "none", color: "var(--text)", cursor: "pointer", padding: "8px",
    textAlign: "left", fontSize: "var(--fs-sm)", borderRadius: "var(--r-sm)" },
  acctRowSel: { background: "var(--panel-2)" },
  acctLeft: { display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 },
  acctName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
  acctType: { color: "var(--text-dim)", fontSize: "var(--fs-xs)" },
  restricted: { color: "var(--warn)", fontSize: "var(--fs-2xs)", flexShrink: 0 },
  acctRight: { display: "inline-flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, lineHeight: 1.25 },
  acctVal: { fontVariantNumeric: "tabular-nums", fontWeight: 600 },
  acctDay: { fontSize: "var(--fs-2xs)", fontVariantNumeric: "tabular-nums" },
  empty: { fontSize: "var(--fs-xs)", color: "var(--text-faint)", padding: "4px 8px 8px", margin: 0 },
};
