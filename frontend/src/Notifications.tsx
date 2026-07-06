import { useEffect, useRef, useState } from "react";
import { useToast } from "./Toast";
import type { Alert, AlertPrefill, AuditEvent, Notification } from "./types";

import { API, wsUrl } from "./api";
const WS_URL = wsUrl("/ws/notifications");

const desktopSupported = typeof window !== "undefined" && "Notification" in window;
function fireDesktop(n: Notification) {
  if (!desktopSupported || Notification.permission !== "granted") return;
  try {
    new Notification(n.symbol ? `${n.symbol} alert` : "Schwab Trader", {
      body: n.message,
      tag: `note-${n.id}`,
    });
  } catch {
    /* some browsers throw if invoked without a user gesture / SW — ignore */
  }
}

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
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [desktopPerm, setDesktopPerm] = useState<string>(desktopSupported ? Notification.permission : "unsupported");
  const wrapRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // add-alert form
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
        🔔
        {unread > 0 && <span style={S.badge}>{unread > 99 ? "99+" : unread}</span>}
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
            <div style={S.body} id="nt-panel-feed" role="tabpanel" aria-labelledby="nt-tab-feed" tabIndex={0}>
              <div style={S.barRow}>
                <span style={S.dim}>{notes.length} recent</span>
                <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {desktopPerm === "granted" ? (
                    <span style={{ ...S.dim, color: "var(--pos)" }}>🔔 desktop on</span>
                  ) : desktopPerm === "unsupported" ? null : (
                    <button style={S.linkBtn} onClick={enableDesktop}>Enable desktop alerts</button>
                  )}
                  {unread > 0 && (
                    <button style={S.linkBtn} onClick={markAllRead}>
                      Mark all read
                    </button>
                  )}
                </span>
              </div>
              {notes.length === 0 ? (
                <p style={S.empty}>No notifications yet. Set a price alert →</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} style={{ ...S.note, opacity: n.read ? 0.55 : 1 }}>
                    {!n.read && <span style={S.dot} />}
                    <div style={{ flex: 1 }}>
                      <div style={S.noteMsg}>{n.message}</div>
                      <div style={S.noteTime}>{fmtTime(n.created_at)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : tab === "activity" ? (
            <div style={S.body} id="nt-panel-activity" role="tabpanel" aria-labelledby="nt-tab-activity" tabIndex={0}>
              <div style={S.barRow}>
                <span style={S.dim}>{audit.length} events — every fill (incl. market) is logged here, not pushed</span>
              </div>
              {audit.length === 0 ? (
                <p style={S.empty}>No activity yet.</p>
              ) : (
                audit.map((e) => (
                  <div key={e.id} style={S.note}>
                    <div style={{ flex: 1 }}>
                      <div style={S.noteMsg}>{e.message}</div>
                      <div style={S.noteTime}>
                        {fmtTime(e.at || e.created_at)}
                        {e.order_type ? ` · ${e.order_type.replace(/_/g, " ")}` : ""}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div style={S.body} id="nt-panel-alerts" role="tabpanel" aria-labelledby="nt-tab-alerts" tabIndex={0}>
              <div style={S.form}>
                <input
                  className="field"
                  style={{ width: 70 }}
                  placeholder="SYM"
                  aria-label="Alert symbol"
                  value={sym}
                  onChange={(e) => setSym(e.target.value.toUpperCase())}
                />
                <select
                  className="field"
                  value={dir}
                  aria-label="Alert direction"
                  onChange={(e) => setDir(e.target.value as "above" | "below")}
                >
                  <option value="above">rises ≥</option>
                  <option value="below">falls ≤</option>
                </select>
                <input
                  className="field"
                  style={{ width: 80 }}
                  placeholder="price"
                  aria-label="Alert price"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addAlert()}
                />
                <label style={S.repeat} title="re-arm and fire on every future crossing">
                  <input
                    type="checkbox"
                    checked={repeat}
                    onChange={(e) => setRepeat(e.target.checked)}
                  />
                  repeat
                </label>
                <button className="btn btn-primary btn-sm" onClick={addAlert}>
                  Set
                </button>
              </div>
              {formMsg && <div style={S.formMsg}>{formMsg}</div>}

              {alerts.length === 0 ? (
                <p style={S.empty}>No alerts. Add one above.</p>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} style={{ ...S.note, opacity: a.active ? 1 : 0.5 }}>
                    <div style={{ flex: 1 }}>
                      <div style={S.noteMsg}>
                        <b>{a.symbol}</b> {a.direction === "above" ? "≥" : "≤"}{" "}
                        {fmtNum(a.threshold)}
                        {a.repeat && <span style={S.tagRepeat}>repeat</span>}
                        {!a.active && <span style={S.tagDone}>triggered</span>}
                      </div>
                      <div style={S.noteTime}>
                        {a.active
                          ? "watching…"
                          : `fired ${fmtTime(a.last_fired_at)}`}
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      title="delete alert"
                      aria-label={`Delete alert for ${a.symbol}`}
                      onClick={() => removeAlert(a)}
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtNum = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 2 });
function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  body: { maxHeight: 420, overflowY: "auto", padding: "6px 0" },
  barRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 14px 8px",
  },
  dim: { color: "var(--text-faint)", fontSize: "var(--fs-xs)" },
  linkBtn: {
    background: "transparent",
    color: "var(--accent-quiet)",
    border: "none",
    fontSize: "var(--fs-xs)",
    cursor: "pointer",
  },
  empty: { color: "var(--text-faint)", fontSize: "var(--fs-sm)", padding: "12px 14px" },
  note: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "9px 14px",
    borderTop: "1px solid var(--border-hairline)",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "var(--r-pill)",
    background: "var(--accent)",
    marginTop: 5,
    flexShrink: 0,
  },
  noteMsg: { fontSize: "var(--fs-sm)", color: "var(--text)" },
  noteTime: { fontSize: "var(--fs-2xs)", color: "var(--text-faint)", marginTop: 2 },
  form: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    flexWrap: "wrap",
  },
  repeat: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: "var(--fs-xs)",
    color: "var(--text-muted)",
    cursor: "pointer",
  },
  formMsg: { fontSize: "var(--fs-xs)", color: "var(--warn)", padding: "0 14px 6px" },
  tagRepeat: {
    fontSize: 10,
    color: "var(--accent-quiet)",
    border: "1px solid #3a4a5a",
    borderRadius: "var(--r-sm)",
    padding: "0 5px",
    marginLeft: 6,
    textTransform: "uppercase",
  },
  tagDone: {
    fontSize: 10,
    color: "var(--warn)",
    border: "1px solid var(--warn-border)",
    borderRadius: "var(--r-sm)",
    padding: "0 5px",
    marginLeft: 6,
    textTransform: "uppercase",
  },
};
