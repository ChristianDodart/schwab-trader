import { useCallback, useEffect, useState } from "react";
import type { NotifChannels, NotifPrefs } from "../types";
import { API } from "../api";
import { PS } from "./ui";
import { useToast } from "../Toast";
import { playNotifSound } from "./sound";
import { IconPlay } from "../Icon";

// The notification HUB: every account's delivery settings side by side, so you can
// manage "which notifications reach me, and how, for which account" in one place — and
// see at a glance where two accounts differ. Columns are accounts (grouped/labeled by
// profile). Rules and prefs are all local, so accounts of non-active profiles still show
// and edit; only their live account NAMES need a reconnect (shown as a masked hash).

type Col = { hash: string; label: string; live: boolean };
type OvAccount = { hash: string; label: string; selected: boolean; live: boolean };
type OvProfile = { id: string; name: string; active: boolean; connected: boolean; accounts: OvAccount[] };

type CatKey = "alert" | "trigger" | "fill";
const CATS: { key: CatKey; label: string; sample: string }[] = [
  { key: "alert", label: "Price alerts", sample: "AAPL crossed above 200 (now 200.14)" },
  { key: "trigger", label: "Strategy triggers", sample: "NVDA dipped to a buy rung — position 3 suggested" },
  { key: "fill", label: "Order fills", sample: "Filled: bought 10 MSFT @ 415.20" },
];
const CHANS: { key: keyof NotifChannels; label: string }[] = [
  { key: "bell", label: "In-app" },
  { key: "desktop", label: "Desktop" },
  { key: "phone", label: "Phone" },
  { key: "sound", label: "Sound" },
];

export function NotifHub({ desktopPerm }: { desktopPerm: string }) {
  const [cols, setCols] = useState<Col[]>([]);
  const [prefs, setPrefs] = useState<Record<string, NotifPrefs>>({});
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const loadPrefs = useCallback(async (hash: string) => {
    try {
      const p = await fetch(`${API}/notif-prefs?account_hash=${encodeURIComponent(hash)}`).then((r) => r.json());
      if (p && p.categories) setPrefs((cur) => ({ ...cur, [hash]: p }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await fetch(`${API}/accounts-overview`).then((r) => r.json());
        if (!alive) return;
        const c: Col[] = [];
        for (const pr of (d.profiles ?? []) as OvProfile[]) {
          for (const a of pr.accounts) c.push({ hash: a.hash, label: `${pr.name} · ${a.label}`, live: a.live });
        }
        setCols(c);
        c.forEach((col) => loadPrefs(col.hash));
      } catch { /* ignore */ } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [loadPrefs]);

  const post = (hash: string, patch: Record<string, unknown>) =>
    fetch(`${API}/notif-prefs`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_hash: hash, ...patch }) }).catch(() => {});

  const setCell = (hash: string, cat: CatKey, chan: keyof NotifChannels, v: boolean) => {
    setPrefs((cur) => {
      const p = cur[hash];
      if (!p) return cur;
      return { ...cur, [hash]: { ...p, categories: { ...p.categories, [cat]: { ...p.categories[cat], [chan]: v } } } };
    });
    post(hash, { categories: { [cat]: { [chan]: v } } });
  };

  const setMute = (hash: string, v: boolean) => {
    setPrefs((cur) => (cur[hash] ? { ...cur, [hash]: { ...cur[hash], muted: v } } : cur));
    post(hash, { muted: v });
  };

  const preview = (cat: typeof CATS[number]) => {
    playNotifSound(cat.key);
    toast(`${cat.label} — ${cat.sample}`, "info");
    if (desktopPerm === "granted") {
      try { new Notification("Schwab Trader", { body: `${cat.label} — ${cat.sample}` }); } catch { /* ignore */ }
    }
  };

  // A cell "differs" when the accounts don't all agree — the point of the side-by-side view.
  const differs = (cat: CatKey, chan: keyof NotifChannels) => {
    const vals = cols.map((c) => prefs[c.hash]?.categories?.[cat]?.[chan]).filter((v) => v !== undefined);
    return vals.length > 1 && new Set(vals).size > 1;
  };
  const cell = (h: string): React.CSSProperties => ({ flex: 1, minWidth: 84, display: "flex", justifyContent: "center", alignItems: "center", opacity: prefs[h]?.muted ? 0.4 : 1 });

  if (loading) return <div style={{ ...PS.body, maxHeight: "none" }}><p style={G.dim}>Loading accounts…</p></div>;
  if (cols.length === 0)
    return (
      <div style={{ ...PS.body, maxHeight: "none" }}>
        <p style={G.dim}>No accounts to show yet. Connect a profile (and pick its account) to manage notifications here.</p>
      </div>
    );

  return (
    <div style={{ ...PS.body, maxHeight: "none" }}>
      <p style={{ ...G.dim, marginTop: 0 }}>
        Every account's notification settings, side by side. A <span style={G.diffDot} /> marks a row where accounts
        differ. Accounts from a profile that isn't connected show a masked number until you reconnect it.
      </p>
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 320 + cols.length * 84 }}>
          {/* header: account columns */}
          <div style={G.row}>
            <div style={G.rowLabel} />
            {cols.map((c) => (
              <div key={c.hash} style={{ ...G.colHead, ...(c.live ? null : G.colHeadStale) }} title={c.live ? c.label : `${c.label} (reconnect this profile for the account name)`}>
                {c.label}
              </div>
            ))}
          </div>
          {/* mute row */}
          <div style={{ ...G.row, ...G.muteRow }}>
            <div style={G.rowLabel}><b>Mute all</b></div>
            {cols.map((c) => (
              <label key={c.hash} style={{ ...cell(c.hash), opacity: 1 }} title={`Mute everything for ${c.label}`}>
                <input type="checkbox" checked={!!prefs[c.hash]?.muted} onChange={(e) => setMute(c.hash, e.target.checked)}
                  aria-label={`Mute all — ${c.label}`} />
              </label>
            ))}
          </div>
          {/* per-category channel rows */}
          {CATS.map((cat) => (
            <div key={cat.key}>
              <div style={{ ...G.row, ...G.catRow }}>
                <div style={{ ...G.rowLabel, ...G.catLabel }}>
                  <b>{cat.label}</b>
                  <button type="button" style={G.preview} onClick={() => preview(cat)}
                    title={`Preview a ${cat.label} notification (see + hear it)`} aria-label={`Preview ${cat.label}`}>
                    <IconPlay /> Preview
                  </button>
                </div>
                {cols.map((c) => <div key={c.hash} style={cell(c.hash)} />)}
              </div>
              {CHANS.map((ch) => (
                <div key={ch.key} style={G.row}>
                  <div style={{ ...G.rowLabel, ...G.chanLabel }}>
                    {differs(cat.key, ch.key) && <span style={G.diffDot} />}
                    <span style={{ color: "var(--text-muted)" }}>{ch.label}</span>
                  </div>
                  {cols.map((c) => (
                    <label key={c.hash} style={cell(c.hash)} title={`${cat.label} → ${ch.label} — ${c.label}`}>
                      <input type="checkbox" disabled={!!prefs[c.hash]?.muted}
                        checked={!!prefs[c.hash]?.categories?.[cat.key]?.[ch.key]}
                        onChange={(e) => setCell(c.hash, cat.key, ch.key, e.target.checked)}
                        aria-label={`${cat.label} ${ch.label} — ${c.label}`} />
                    </label>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {desktopPerm !== "granted" && desktopPerm !== "unsupported" && (
        <p style={{ ...G.dim, marginTop: 10 }}>Desktop pop-ups need permission — enable them from the Settings sub-tab.</p>
      )}
    </div>
  );
}

const G: Record<string, React.CSSProperties> = {
  dim: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", lineHeight: 1.5 },
  row: { display: "flex", alignItems: "center", borderTop: "1px solid var(--border-hairline)", minHeight: 34 },
  rowLabel: { width: 200, flexShrink: 0, fontSize: "var(--fs-sm)", paddingRight: 8 },
  colHead: { flex: 1, minWidth: 84, textAlign: "center", fontSize: "var(--fs-2xs)", fontWeight: 700,
    color: "var(--text-muted)", padding: "6px 4px", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis" },
  colHeadStale: { color: "var(--text-faint)", fontStyle: "italic" },
  muteRow: { background: "var(--panel-2)" },
  catRow: { background: "var(--panel-header)" },
  catLabel: { display: "flex", alignItems: "center", gap: 8, width: 200 },
  chanLabel: { display: "flex", alignItems: "center", gap: 6, paddingLeft: 14 },
  diffDot: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "var(--warn)", flexShrink: 0 },
  preview: { display: "inline-flex", alignItems: "center", gap: 4, background: "transparent",
    border: "1px solid var(--border)", borderRadius: "var(--r-pill)", color: "var(--accent)",
    cursor: "pointer", fontSize: "var(--fs-2xs)", fontWeight: 600, padding: "1px 8px" },
};
