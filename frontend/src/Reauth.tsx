import { useEffect, useRef, useState } from "react";
import type { AuthStatus } from "./types";

import { API } from "./api";

/** Button that opens the two-step manual-OAuth re-authorization modal. */
export function ReauthButton({
  onComplete,
  label = "Re-authorize Schwab",
  style: btnStyle,
}: {
  onComplete?: () => void;
  label?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [received, setReceived] = useState("");
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const desktop = typeof window !== "undefined" ? window.desktop : undefined;
  const isDesktop = !!desktop?.isDesktop;

  const begin = () => {
    setOpen(true);
    setErr(null);
    setDone(null);
    setReceived("");
    setAuthUrl(null);
    setStarting(true);
    fetch(`${API}/auth/begin`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.authorization_url) setAuthUrl(d.authorization_url);
        else setErr(d.error || "Could not start re-authorization.");
      })
      .catch(() => setErr("Could not reach the backend."))
      .finally(() => setStarting(false));
  };

  // Exchange a captured/pasted redirect URL for a token (shared by both paths).
  const submitReceived = (url: string) => {
    setBusy(true);
    setErr(null);
    return fetch(`${API}/auth/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ received_url: url }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setDone(d.message || "Re-authorized successfully.");
          onComplete?.();
        } else {
          setErr(d.error || "Token exchange failed.");
        }
      })
      .catch(() => setErr("Token exchange failed."))
      .finally(() => setBusy(false));
  };

  const complete = () => {
    const url = received.trim();
    if (!url) { setErr("Paste the full redirect URL."); return; }
    submitReceived(url);
  };

  // Desktop: open Schwab in a dedicated window; the main process captures the
  // redirect URL automatically — no copy-paste.
  const connectAuto = async () => {
    if (!authUrl || !desktop) return;
    setBusy(true);
    setErr(null);
    try {
      const url = await desktop.captureOAuth(authUrl);
      if (!url) {
        setErr("Sign-in window closed before finishing. Try again, or paste the URL manually below.");
        setManualOpen(true);
        setBusy(false);
        return;
      }
      await submitReceived(url);
    } catch {
      setErr("Automatic sign-in failed — paste the URL manually below.");
      setManualOpen(true);
      setBusy(false);
    }
  };

  // Focus the first control when the modal opens (or its content changes step).
  useEffect(() => {
    if (!open) return;
    modalRef.current?.querySelector<HTMLElement>("a, button, textarea, input")?.focus();
  }, [open, authUrl, done]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "Tab" && modalRef.current) {
      const list = Array.from(modalRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, [tabindex]:not([tabindex="-1"])'));
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  return (
    <>
      <button className="btn btn-secondary" style={btnStyle} onClick={begin}>{label}</button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div
            className="modal"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="Re-authorize Schwab"
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{ width: "min(480px, calc(100vw - 32px))", padding: 22 }}
          >
            <h3 style={S.h3}>Re-authorize Schwab</h3>
            {done ? (
              <>
                <p style={S.success}>✓ {done}</p>
                <p style={S.dim}>The live feed is reconnecting with your new token.</p>
                <div style={S.actions}>
                  <button className="btn btn-primary" onClick={() => setOpen(false)}>Done</button>
                </div>
              </>
            ) : (
              <>
                {isDesktop ? (
                  <>
                    <p style={{ ...S.dim, fontSize: "var(--fs-md)", lineHeight: 1.5 }}>
                      Sign in to Schwab and approve access. This window captures the result
                      automatically — no copying anything.
                    </p>
                    <div style={{ margin: "14px 0" }}>
                      <button className="btn btn-primary" disabled={!authUrl || busy} onClick={connectAuto}>
                        {busy ? "Waiting for Schwab sign-in…" : starting ? "Preparing…" : "Sign in to Schwab ↗"}
                      </button>
                    </div>
                    {err && <p style={S.err}>{err}</p>}
                    {manualOpen && (
                      <div style={{ marginTop: 8 }}>
                        <p style={S.dim}>Paste the full <code style={S.code}>https://127.0.0.1/…</code> URL:</p>
                        <textarea className="field" style={S.textarea} rows={3}
                          placeholder="https://127.0.0.1/?code=…&session=…" aria-label="Pasted redirect URL"
                          value={received} onChange={(e) => setReceived(e.target.value)} />
                        <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }}
                          onClick={complete} disabled={busy || !received.trim() || !authUrl}>
                          {busy ? "Exchanging…" : "Complete with pasted URL"}
                        </button>
                      </div>
                    )}
                    <div style={S.actions}>
                      {!manualOpen && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setManualOpen(true)}>Paste URL manually</button>
                      )}
                      <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <ol style={S.steps}>
                      <li>
                        Open the Schwab login page and approve access.
                        <div style={S.linkWrap}>
                          {authUrl ? (
                            <a style={S.link} href={authUrl} target="_blank" rel="noreferrer">
                              Open Schwab login ↗
                            </a>
                          ) : (
                            <span style={S.dim}>{starting ? "preparing login link…" : "—"}</span>
                          )}
                        </div>
                      </li>
                      <li>
                        Your browser will then try to load{" "}
                        <code style={S.code}>https://127.0.0.1/…</code> and show a
                        “can’t reach this page” error — <b>that’s expected</b>. Copy the{" "}
                        <b>entire URL</b> from the address bar.
                      </li>
                      <li>Paste it here:</li>
                    </ol>
                    <textarea
                      className="field"
                      style={S.textarea}
                      placeholder="https://127.0.0.1/?code=…&session=…"
                      aria-label="Pasted redirect URL"
                      value={received}
                      rows={3}
                      onChange={(e) => setReceived(e.target.value)}
                    />
                    {err && <p style={S.err}>{err}</p>}
                    <div style={S.actions}>
                      <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
                      <button
                        className="btn btn-primary"
                        onClick={complete}
                        disabled={busy || !received.trim() || !authUrl}
                      >
                        {busy ? "Exchanging…" : "Complete re-auth"}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Connection status line + re-auth button (used in the Settings tab). */
export function ConnectionStatus() {
  const [s, setS] = useState<AuthStatus | null>(null);
  const load = () =>
    fetch(`${API}/auth/status`).then((r) => r.json()).then(setS).catch(() => {});
  useEffect(() => { load(); }, []);

  const color = !s ? "var(--text-dim)" : s.severity === "ok" ? "var(--pos)" : s.severity === "warn" ? "var(--warn)" : "var(--neg)";
  const text = !s
    ? "…"
    : s.expired
      ? "Not connected"
      : `Connected — ${s.days_left?.toFixed(1)} days left`;
  return (
    <div>
      <div style={S.statusLine}>
        <span style={S.dim}>Token status:</span>
        <b style={{ color }}>{text}</b>
      </div>
      {s && !s.expired && s.expires_at && (
        <div style={S.dim}>Refresh token expires {new Date(s.expires_at).toLocaleString()}</div>
      )}
      <div style={{ marginTop: 10 }}>
        <ReauthButton onComplete={load} label={s?.expired ? "Connect Schwab" : "Re-authorize Schwab"} />
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  h3: { margin: "0 0 14px", fontSize: "var(--fs-lg)", fontWeight: 600 },
  steps: { margin: 0, paddingLeft: 20, lineHeight: 1.55, fontSize: "var(--fs-md)", color: "var(--text-muted)" },
  linkWrap: { margin: "6px 0 10px" },
  link: {
    display: "inline-block",
    background: "var(--accent)",
    color: "white",
    textDecoration: "none",
    borderRadius: "var(--r-md)",
    padding: "6px 12px",
    fontSize: "var(--fs-sm)",
    fontWeight: 600,
  },
  code: { background: "var(--bg)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)", padding: "1px 5px", fontSize: "var(--fs-xs)", fontFamily: "var(--font-mono)" },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "var(--font-mono)",
    marginTop: 10,
    resize: "vertical",
  },
  err: { color: "var(--neg)", fontSize: "var(--fs-sm)", margin: "8px 0 0" },
  success: { color: "var(--pos)", fontSize: "var(--fs-lg)", fontWeight: 600 },
  dim: { color: "var(--text-dim)", fontSize: "var(--fs-sm)" },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  statusLine: { display: "flex", gap: 8, alignItems: "center", fontSize: "var(--fs-md)" },
};
