// Notifications: a thin header bell (unread shortcut into the tab) + the full
// Notifications tab. All live state lives in NotificationsProvider (store.tsx) so the
// WebSocket + desktop firing run app-wide, not just while the tab is open.
import { useEffect, useState } from "react";
import type { AlertPrefill } from "./types";
import { round2, fmtNum } from "./notifications/format";
import { useNotifs } from "./notifications/store";
import { FeedPanel } from "./notifications/FeedPanel";
import { ActivityPanel } from "./notifications/ActivityPanel";
import { AlertsPanel } from "./notifications/AlertsPanel";
import { PrefsPanel } from "./notifications/PrefsPanel";
import { useToast } from "./Toast";
import { IconBell } from "./Icon";

export { NotificationsProvider } from "./notifications/store";

/** Header bell — unread count + pulse; clicking opens the Notifications tab. */
export function NotificationsBell({ onOpen }: { onOpen: () => void }) {
  const { unread, pulse } = useNotifs();
  return (
    <button style={S.bell} onClick={onOpen}
      aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}>
      <span style={{ display: "inline-flex", transform: pulse ? "scale(1.25) rotate(-8deg)" : "none", transition: "transform .18s ease" }}><IconBell size={18} /></span>
      {unread > 0 && <span style={{ ...S.badge, ...(pulse ? S.badgePulse : null) }}>{unread > 99 ? "99+" : unread}</span>}
    </button>
  );
}

type Sub = "feed" | "alerts" | "activity" | "settings";
const SUBS: { id: Sub; label: string }[] = [
  { id: "feed", label: "Feed" },
  { id: "alerts", label: "Alerts" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

export function NotificationsTab({ prefill, onPrefillConsumed }: {
  prefill: AlertPrefill | null;
  onPrefillConsumed: () => void;
}) {
  const n = useNotifs();
  const toast = useToast();
  const [sub, setSub] = useState<Sub>("feed");
  const [q, setQ] = useState("");

  // add-alert form (kept here so it survives sub-tab switches)
  const [sym, setSym] = useState("");
  const [dir, setDir] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);

  // A dashboard row's bell click prefills a "falls below" alert (the ladder buys dips).
  useEffect(() => {
    if (!prefill) return;
    setSub("alerts");
    setSym(prefill.symbol);
    setDir("below");
    setPrice(prefill.price != null ? String(round2(prefill.price)) : "");
    setFormMsg(null);
    onPrefillConsumed();
  }, [prefill, onPrefillConsumed]);

  const addAlert = async () => {
    const s = sym.trim().toUpperCase();
    const t = parseFloat(price);
    if (!s || !isFinite(t) || t <= 0) { setFormMsg("Enter a symbol and a positive price."); return; }
    const res = await n.addAlert({ symbol: s, direction: dir, threshold: t, repeat });
    if (!res.ok) { setFormMsg(res.error || "could not create alert"); return; }
    setFormMsg(res.warning || "Alert set."); setPrice("");
  };

  const removeAlert = (a: { id: number; symbol: string; direction: string; threshold: number; repeat: boolean }) => {
    n.removeAlert(a.id);
    toast(`Deleted ${a.symbol} ${a.direction === "above" ? "≥" : "≤"} ${fmtNum(a.threshold)} alert`, "info", {
      label: "Undo",
      onClick: () => n.addAlert({ symbol: a.symbol, direction: a.direction, threshold: a.threshold, repeat: a.repeat }),
    });
  };

  const activeCount = n.alerts.filter((a) => a.active).length;

  return (
    <div style={S.page}>
      <h2 className="page-title" style={{ marginTop: 4 }}>Notifications</h2>
      <div className="panel" style={S.card}>
        <div style={S.tabs} role="tablist" aria-label="Notification views">
          {SUBS.map((t) => (
            <button key={t.id} id={`nt-tab-${t.id}`} role="tab" aria-selected={sub === t.id}
              aria-controls={`nt-panel-${t.id}`} style={tabStyle(sub === t.id)} onClick={() => setSub(t.id)}>
              {t.label}
              {t.id === "feed" && n.unread > 0 ? ` (${n.unread})` : ""}
              {t.id === "alerts" && activeCount > 0 ? ` (${activeCount})` : ""}
            </button>
          ))}
        </div>

        {sub === "feed" ? (
          <FeedPanel notes={n.notes} unread={n.unread} q={q} onQ={setQ}
            desktopPerm={n.desktopPerm} onEnableDesktop={n.enableDesktop} onMarkAllRead={n.markAllRead} />
        ) : sub === "activity" ? (
          <ActivityPanel audit={n.audit} q={q} onQ={setQ} />
        ) : sub === "alerts" ? (
          <AlertsPanel alerts={n.alerts}
            sym={sym} onSym={setSym} dir={dir} onDir={setDir} price={price} onPrice={setPrice}
            repeat={repeat} onRepeat={setRepeat} formMsg={formMsg} onAdd={addAlert} onRemove={removeAlert} />
        ) : (
          <PrefsPanel prefs={n.prefs} savePrefs={n.savePrefs}
            desktopPerm={n.desktopPerm} onEnableDesktop={n.enableDesktop} />
        )}
      </div>
    </div>
  );
}

const tabStyle = (active: boolean): React.CSSProperties => ({
  background: "transparent",
  color: active ? "var(--text)" : "var(--text-dim)",
  border: "none",
  borderBottom: "2px solid " + (active ? "var(--accent)" : "transparent"),
  padding: "10px 16px",
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
  cursor: "pointer",
});

const S: Record<string, React.CSSProperties> = {
  bell: {
    position: "relative", background: "var(--panel-2)", border: "1px solid var(--border-strong)",
    borderRadius: "var(--r-md)", padding: "5px 9px", fontSize: "var(--fs-lg)", cursor: "pointer", lineHeight: 1,
  },
  badge: {
    position: "absolute", top: -6, right: -6, background: "var(--danger)", color: "white",
    fontSize: 10, fontWeight: 700, borderRadius: "var(--r-pill)", padding: "1px 5px", minWidth: 16,
    textAlign: "center", transition: "transform .18s ease, box-shadow .18s ease",
  },
  badgePulse: { transform: "scale(1.4)", boxShadow: "0 0 0 3px var(--danger-bg)" },
  page: { maxWidth: 640 },
  card: { marginTop: 12, padding: 0, overflow: "hidden" },
  tabs: { display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", background: "var(--panel-header)" },
};
