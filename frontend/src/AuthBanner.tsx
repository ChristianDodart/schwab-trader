import { useCallback, useEffect, useState } from "react";
import { ReauthButton } from "./Reauth";
import type { AuthStatus } from "./types";

import { API } from "./api";

export function AuthBanner() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const [checking, setChecking] = useState(false);

  const load = useCallback(() => {
    fetch(`${API}/auth/status`)
      .then((r) => r.json())
      .then((s: AuthStatus) => {
        setStatus(s);
        setDismissed((d) => (s.severity === "expired" ? false : d));
      })
      .catch(() => {});
  }, []);

  // Force an immediate real round-trip (not the timestamp) — for troubleshooting or
  // right after reconnecting on another device.
  const checkNow = useCallback(() => {
    setChecking(true);
    fetch(`${API}/auth/check`, { method: "POST" })
      .then((r) => r.json())
      .then((s: AuthStatus) => { setStatus(s); setDismissed((d) => (s.severity === "expired" ? false : d)); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000); // re-check every 5 min
    return () => clearInterval(t);
  }, [load]);

  // Only nag when something needs doing; "ok" shows nothing.
  if (!status || status.severity === "ok") return null;
  // A "warn" can be dismissed for the session; "expired" cannot.
  if (dismissed && status.severity !== "expired") return null;

  const c = status.severity === "expired" ? COLORS.expired : COLORS.warn;
  return (
    <div style={{ ...S.bar, background: c.bg, borderColor: c.border }}>
      <span style={{ fontSize: 15 }}>{status.severity === "expired" ? "⛔" : "⚠️"}</span>
      <span style={S.msg}>{status.message}</span>
      <button style={S.check} disabled={checking} onClick={checkNow}
        title="Make a real authenticated call to Schwab right now">
        {checking ? "Checking…" : "Check now"}
      </button>
      <ReauthButton onComplete={load} label={status.expired ? "Connect Schwab" : "Re-authorize"} style={S.reauth} />
      {status.severity !== "expired" && (
        <button style={S.x} title="dismiss for now" onClick={() => setDismissed(true)}>✕</button>
      )}
    </div>
  );
}

// Always-visible header pill showing whether Schwab ACTUALLY answered a real
// authenticated call recently (probe/stream), not just the token-file timestamp.
// Click to force an immediate check.
export function LiveStatusPill() {
  const [s, setS] = useState<AuthStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback((force = false) => {
    if (force) setChecking(true);
    fetch(`${API}/auth/${force ? "check" : "status"}`, force ? { method: "POST" } : undefined)
      .then((r) => r.json()).then(setS).catch(() => {}).finally(() => force && setChecking(false));
  }, []);
  useEffect(() => { load(); const t = setInterval(() => load(), 60_000); return () => clearInterval(t); }, [load]);

  if (!s) return null;
  // verified_live null = not yet checked; true = a real call just succeeded; false = it failed.
  const live = s.verified_live;
  const color = live === true ? "var(--pos)" : live === false ? "var(--neg)" : "var(--text-faint)";
  const label = live === true ? "Live" : live === false ? "Not live" : "Checking";
  const ago = s.last_checked_ago_s;
  const tip = (live === true ? "Schwab answered a real authenticated call" : live === false ? (s.message || "Schwab rejected the last call") : "verifying…")
    + (ago != null ? ` · checked ${ago}s ago${s.check_source ? ` (${s.check_source})` : ""}` : "")
    + (s.latency_ms ? ` · ${s.latency_ms}ms` : "") + " — click to re-check";
  return (
    <button className="pill" title={tip} onClick={() => load(true)} disabled={checking}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", background: "transparent", border: "1px solid var(--border)" }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {checking ? "Checking…" : label}
    </button>
  );
}

const COLORS = {
  warn: { bg: "var(--warn-bg)", border: "var(--warn-border)" },
  expired: { bg: "var(--danger-bg)", border: "var(--danger)" },
};

const S: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    border: "1px solid",
    borderRadius: "var(--r-lg)",
    padding: "9px 14px",
    marginTop: 14,
    fontSize: "var(--fs-md)",
  },
  msg: { color: "var(--text)", flex: 1 },
  reauth: {
    background: "var(--text)",
    color: "var(--bg)",
    border: "none",
    borderRadius: "var(--r-md)",
    padding: "6px 13px",
    fontSize: "var(--fs-sm)",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  check: {
    background: "transparent",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: "var(--r-md)",
    padding: "6px 11px",
    fontSize: "var(--fs-sm)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  x: {
    background: "transparent",
    color: "var(--text-muted)",
    border: "none",
    fontSize: "var(--fs-md)",
    cursor: "pointer",
    padding: "0 4px",
  },
};
