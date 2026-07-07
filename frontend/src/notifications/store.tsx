// App-wide notifications store (W29). Owns the live WebSocket, the feed/alerts/audit
// data, the unread count, desktop-notification firing, and the delivery prefs — all
// lifted out of the old header bell so the connection runs for the whole app (the bell
// is just a shortcut now) and the Notifications tab reads the same live state.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { Alert, AuditEvent, Notification as AppNote, NotifPrefs } from "../types";
import { API, wsUrl } from "../api";
import { desktopSupported, fireDesktop } from "./desktop";

const WS_URL = wsUrl("/ws/notifications");

const DEFAULT_PREFS: NotifPrefs = {
  muted: false,
  categories: {
    alert: { bell: true, desktop: true, phone: true },
    trigger: { bell: true, desktop: true, phone: true },
    fill: { bell: true, desktop: false, phone: true },
  },
  muted_symbols: [],
};

type Ctx = {
  notes: AppNote[];
  unread: number;
  pulse: boolean;
  alerts: Alert[];
  audit: AuditEvent[];
  desktopPerm: string;
  prefs: NotifPrefs;
  enableDesktop: () => void;
  markAllRead: () => void;
  loadAlerts: () => void;
  loadAudit: () => void;
  addAlert: (body: { symbol: string; direction: string; threshold: number; repeat: boolean }) => Promise<{ ok: boolean; error?: string; warning?: string }>;
  removeAlert: (id: number) => Promise<void>;
  savePrefs: (patch: Partial<NotifPrefs>) => Promise<void>;
};

const NotifCtx = createContext<Ctx | null>(null);

export function useNotifs(): Ctx {
  const c = useContext(NotifCtx);
  if (!c) throw new Error("useNotifs must be used within NotificationsProvider");
  return c;
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<AppNote[]>([]);
  const [unread, setUnread] = useState(0);
  const [pulse, setPulse] = useState(false);
  const prevUnread = useRef(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [desktopPerm, setDesktopPerm] = useState<string>(desktopSupported ? Notification.permission : "unsupported");
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULT_PREFS);

  const loadNotes = useCallback(() =>
    fetch(`${API}/notifications`).then((r) => r.json())
      .then((d) => { setNotes(d.notifications ?? []); setUnread(d.unread ?? 0); }).catch(() => {}), []);
  const loadAlerts = useCallback(() =>
    fetch(`${API}/alerts`).then((r) => r.json()).then((d) => setAlerts(d.alerts ?? [])).catch(() => {}), []);
  const loadAudit = useCallback(() =>
    fetch(`${API}/audit`).then((r) => r.json()).then((d) => setAudit(d.events ?? [])).catch(() => {}), []);
  const loadPrefs = useCallback(() =>
    fetch(`${API}/notif-prefs`).then((r) => r.json())
      .then((p) => { if (p && p.categories) setPrefs(p); }).catch(() => {}), []);

  const enableDesktop = useCallback(() => {
    if (!desktopSupported) return;
    Notification.requestPermission().then(setDesktopPerm).catch(() => {});
  }, []);

  // Badge pulses only when the count RISES (a fresh alert) — never on mark-read.
  useEffect(() => {
    if (unread > prevUnread.current) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 500);
      prevUnread.current = unread;
      return () => clearTimeout(t);
    }
    prevUnread.current = unread;
  }, [unread]);

  useEffect(() => { loadNotes(); loadAlerts(); loadAudit(); loadPrefs(); }, [loadNotes, loadAlerts, loadAudit, loadPrefs]);

  // Live push — one connection for the whole app lifetime.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(WS_URL);
      ws.onopen = () => { if (!disposed) { loadNotes(); loadAudit(); } };
      ws.onclose = () => { if (!disposed) retry = setTimeout(connect, 1500); };
      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const n: AppNote = JSON.parse(ev.data);
          setNotes((prev) => [n, ...prev].slice(0, 100));
          if (!n.read) setUnread((u) => u + 1);   // muted pushes arrive read → no badge
          fireDesktop(n);                          // respects n.desktop (server's prefs decision)
          if (n.alert_id != null) loadAlerts();
          loadAudit();
        } catch { /* malformed frame */ }
      };
    };
    connect();
    return () => { disposed = true; clearTimeout(retry); if (ws) { ws.onclose = null; ws.onmessage = null; ws.onopen = null; ws.close(); } };
  }, [loadNotes, loadAlerts, loadAudit]);

  const markAllRead = useCallback(() =>
    fetch(`${API}/notifications/read-all`, { method: "POST" })
      .then(() => { setNotes((prev) => prev.map((n) => ({ ...n, read: true }))); setUnread(0); }).catch(() => {}), []);

  const addAlert = useCallback(async (body: { symbol: string; direction: string; threshold: number; repeat: boolean }) => {
    try {
      const res = await fetch(`${API}/alerts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }).then((r) => r.json());
      if (res.ok) loadAlerts();
      return res;
    } catch { return { ok: false, error: "could not create alert" }; }
  }, [loadAlerts]);

  const removeAlert = useCallback(async (id: number) => {
    await fetch(`${API}/alerts/${id}`, { method: "DELETE" }).catch(() => {});
    loadAlerts();
  }, [loadAlerts]);

  const savePrefs = useCallback(async (patch: Partial<NotifPrefs>) => {
    // optimistic — the grid should feel instant
    setPrefs((cur) => ({ ...cur, ...patch }));
    try {
      const saved = await fetch(`${API}/notif-prefs`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      }).then((r) => r.json());
      if (saved && saved.categories) setPrefs(saved);
    } catch { /* keep optimistic value */ }
  }, []);

  const value: Ctx = {
    notes, unread, pulse, alerts, audit, desktopPerm, prefs,
    enableDesktop, markAllRead, loadAlerts, loadAudit, addAlert, removeAlert, savePrefs,
  };
  return <NotifCtx.Provider value={value}>{children}</NotifCtx.Provider>;
}
