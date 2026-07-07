// Notifications bell orchestrator (split in W27-4): owns the data (feed, alerts,
// audit), the live WebSocket, and the popover shell; the tab panels live in
// src/notifications/ (FeedPanel / ActivityPanel / AlertsPanel).
import { useEffect, useRef, useState } from "react";
import { useToast } from "./Toast";
import type { Alert, AlertPrefill, AuditEvent, Notification } from "./types";

import { API, wsUrl } from "./api";
import { desktopSupported, desktopCats, DESKTOP_CATS_KEY, fireDesktop } from "./notifications/desktop";
import { round2, fmtNum } from "./notifications/format";
import { FeedPanel } from "./notifications/FeedPanel";
import { ActivityPanel } from "./notifications/ActivityPanel";
import { AlertsPanel } from "./notifications/AlertsPanel";

const WS_URL = wsUrl("/ws/notifications");

export function NotificationsBell({
  prefill,
  onPrefillConsumed,
}: {
  prefill: AlertPrefill | null;
  onPrefillConsumed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"feed" | "activity" | "alerts">("feed");
  const [notes, setNotes] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [pulse, setPulse] = useState(false);
  const prevUnread = useRef(0);
  const [q, setQ] = useState(""); // history search (feed + activity)
  const [dcats, setDcats] = useState(desktopCats);
  const toggleDcat = (k: string) => setDcats((c) => {
    const next = { ...c, [k]: !c[k] };
    try { localStorage.setItem(DESKTOP_CATS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [desktopPerm, setDesktopPerm] = useState<string>(desktopSupported ? Notification.permission : "unsupported");
  const wrapRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // add-alert form (lives here so it survives tab switches and popover close)
  const [sym, setSym] = useState("");
  const [dir, setDir] = useState<"above" | "below">("above");
  const [price, setPrice] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);

  const loadNotes = () =>
    fetch(`${API}/notifications`)
      .then((r) => r.json())
      .then((d) => {
        setNotes(d.notifications ?? []);
        setUnread(d.unread ?? 0);
      })
      .catch(() => {});
  const loadAlerts = () =>
    fetch(`${API}/alerts`)
      .then((r) => r.json())
      .then((d) => setAlerts(d.alerts ?? []))
      .catch(() => {});
  const loadAudit = () =>
    fetch(`${API}/audit`)
      .then((r) => r.json())
      .then((d) => setAudit(d.events ?? []))
      .catch(() => {});

  const enableDesktop = () => {
    if (!desktopSupported) return;
    Notification.requestPermission().then(setDesktopPerm).catch(() => {});
  };

  // Pop the unread badge whenever the count goes UP (a fresh alert arrived) — a quick,
  // non-annoying nudge. Never on a decrease (marking read shouldn't animate).
  useEffect(() => {
    if (unread > prevUnread.current) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 500);
      prevUnread.current = unread;
      return () => clearTimeout(t);
    }
    prevUnread.current = unread;
  }, [unread]);

  useEffect(() => {
    loadNotes();
    loadAlerts();
    loadAudit();
  }, []);

  // live push of newly-fired notifications
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let disposed = false;   // no reconnect after unmount (StrictMode double-invoke / re-mount)
    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        if (disposed) return;
        // resync against the DB so anything fired during a disconnect is recovered
        loadNotes();
        loadAudit();
      };
      ws.onclose = () => {
        if (disposed) return;
        retry = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const n: Notification = JSON.parse(ev.data);
          setNotes((prev) => [n, ...prev].slice(0, 100));
          setUnread((u) => u + 1);
          fireDesktop(n);              // loud: a native OS notification
          if (n.alert_id != null) loadAlerts();  // a price alert fired → may have deactivated
          loadAudit();                 // the same event was also logged
        } catch {
          /* ignore a malformed push frame */
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      if (ws) { ws.onclose = null; ws.onmessage = null; ws.onopen = null; ws.close(); }
    };
  }, []);

  // Escape + click-outside close the popover.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // open pre-filled when a row's bell is clicked (ladder strategy buys the dip →
  // default to "falls below" so the common case is one edit away).
  useEffect(() => {
    if (!prefill) return;
    setTab("alerts");
    setOpen(true);
    setSym(prefill.symbol);
    setDir("below");
    setPrice(prefill.price != null ? String(round2(prefill.price)) : "");
    setFormMsg(null);
    onPrefillConsumed();
  }, [prefill]);

  const markAllRead = () =>
    fetch(`${API}/notifications/read-all`, { method: "POST" })
      .then(() => {
        setNotes((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnread(0);
      })
      .catch(() => {});

  const openFeed = () => {
    setOpen((o) => !o);
    setTab("feed");
    // re-sync in case OS/browser notification permission changed since last open
    if (desktopSupported) setDesktopPerm(Notification.permission);
  };

  const addAlert = () => {
    const s = sym.trim().toUpperCase();
    const t = parseFloat(price);
    if (!s || !isFinite(t) || t <= 0) {
      setFormMsg("Enter a symbol and a positive price.");
      return;
    }
    fetch(`${API}/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: s, direction: dir, threshold: t, repeat }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res.ok) {
          setFormMsg(res.error || "could not create alert");
          return;
        }
        setFormMsg(res.warning || "Alert set.");
        setPrice("");
        loadAlerts();
      })
      .catch(() => setFormMsg("could not create alert"));
  };

  const removeAlert = (a: Alert) => {
    fetch(`${API}/alerts/${a.id}`, { method: "DELETE" }).then(() => loadAlerts()).catch(() => {});
    toast(`Deleted ${a.symbol} ${a.direction === "above" ? "≥" : "≤"} ${fmtNum(a.threshold)} alert`, "info", {
      label: "Undo",
      onClick: () =>
        fetch(`${API}/alerts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: a.symbol, direction: a.direction, threshold: a.threshold, repeat: a.repeat }),
        }).then(() => loadAlerts()).catch(() => {}),
    });
  };

  const activeCount = alerts.filter((a) => a.active).length;

  // APG tablist keyboard nav: arrows/Home/End move selection AND focus.
  const TAB_KEYS = ["feed", "activity", "alerts"] as const;
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TAB_KEYS.indexOf(tab);
    let next: typeof tab | null = null;
    if (e.key === "ArrowRight") next = TAB_KEYS[(i + 1) % TAB_KEYS.length];
    else if (e.key === "ArrowLeft") next = TAB_KEYS[(i - 1 + TAB_KEYS.length) % TAB_KEYS.length];
    else if (e.key === "Home") next = TAB_KEYS[0];
    else if (e.key === "End") next = TAB_KEYS[TAB_KEYS.length - 1];
    if (next) { e.preventDefault(); setTab(next); document.getElementById(`nt-tab-${next}`)?.focus(); }
  };

  return (
    <div style={S.wrap} ref={wrapRef}>
      <button style={S.bell} onClick={openFeed} aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        aria-haspopup="true" aria-expanded={open}>
        <span style={{ display: "inline-block", transform: pulse ? "scale(1.25) rotate(-8deg)" : "none", transition: "transform .18s ease" }}>🔔</span>
        {unread > 0 && <span style={{ ...S.badge, ...(pulse ? S.badgePulse : null) }}>{unread > 99 ? "99+" : unread}</span>}
      </button>

      {open && (
        <div style={S.pop} aria-label="Notifications">
          <div style={S.tabs} role="tablist" aria-label="Notification views">
            <button id="nt-tab-feed" role="tab" aria-selected={tab === "feed"} aria-controls="nt-panel-feed"
              tabIndex={tab === "feed" ? 0 : -1} onKeyDown={onTabKey} style={tabStyle(tab === "feed")} onClick={() => setTab("feed")}>
              Notifications{unread > 0 ? ` (${unread})` : ""}
            </button>
            <button id="nt-tab-activity" role="tab" aria-selected={tab === "activity"} aria-controls="nt-panel-activity"
              tabIndex={tab === "activity" ? 0 : -1} onKeyDown={onTabKey} style={tabStyle(tab === "activity")} onClick={() => { setTab("activity"); loadAudit(); }}>
              Activity
            </button>
            <button id="nt-tab-alerts" role="tab" aria-selected={tab === "alerts"} aria-controls="nt-panel-alerts"
              tabIndex={tab === "alerts" ? 0 : -1} onKeyDown={onTabKey} style={tabStyle(tab === "alerts")} onClick={() => setTab("alerts")}>
              Alerts{activeCount > 0 ? ` (${activeCount})` : ""}
            </button>
            <button style={S.close} onClick={() => setOpen(false)} aria-label="Close notifications">
              ✕
            </button>
          </div>

          {tab === "feed" ? (
            <FeedPanel
              notes={notes}
              unread={unread}
              q={q}
              onQ={setQ}
              desktopPerm={desktopPerm}
              onEnableDesktop={enableDesktop}
              onMarkAllRead={markAllRead}
              dcats={dcats}
              onToggleDcat={toggleDcat}
            />
          ) : tab === "activity" ? (
            <ActivityPanel audit={audit} q={q} onQ={setQ} />
          ) : (
            <AlertsPanel
              alerts={alerts}
              sym={sym} onSym={setSym}
              dir={dir} onDir={setDir}
              price={price} onPrice={setPrice}
              repeat={repeat} onRepeat={setRepeat}
              formMsg={formMsg}
              onAdd={addAlert}
              onRemove={removeAlert}
            />
          )}
        </div>
      )}
    </div>
  );
}

const tabStyle = (active: boolean): React.CSSProperties => ({
  background: "transparent",
  color: active ? "var(--text)" : "var(--text-dim)",
  border: "none",
  borderBottom: "2px solid " + (active ? "var(--accent)" : "transparent"),
  padding: "8px 12px",
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
  cursor: "pointer",
});

const S: Record<string, React.CSSProperties> = {
  wrap: { position: "relative" },
  bell: {
    position: "relative",
    background: "var(--panel-2)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--r-md)",
    padding: "5px 9px",
    fontSize: "var(--fs-lg)",
    cursor: "pointer",
    lineHeight: 1,
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    background: "var(--danger)",
    color: "white",
    fontSize: 10,
    fontWeight: 700,
    borderRadius: "var(--r-pill)",
    padding: "1px 5px",
    minWidth: 16,
    textAlign: "center",
    transition: "transform .18s ease, box-shadow .18s ease",
  },
  badgePulse: {
    transform: "scale(1.4)",
    boxShadow: "0 0 0 3px var(--danger-bg)",
  },
  pop: {
    position: "absolute",
    right: 0,
    top: "calc(100% + 8px)",
    width: 360,
    maxWidth: "calc(100vw - 24px)",
    background: "var(--pop)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--r-lg)",
    boxShadow: "var(--shadow-pop)",
    zIndex: "var(--z-popover)" as unknown as number,
    overflow: "hidden",
  },
  tabs: {
    display: "flex",
    alignItems: "center",
    borderBottom: "1px solid var(--border)",
    background: "var(--panel-header)",
  },
  close: {
    marginLeft: "auto",
    background: "transparent",
    color: "var(--text-dim)",
    border: "none",
    fontSize: "var(--fs-md)",
    cursor: "pointer",
    padding: "0 12px",
  },
};
