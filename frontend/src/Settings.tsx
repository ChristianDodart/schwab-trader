import { useEffect, useState } from "react";
import { ConnectionStatus } from "./Reauth";
import { useToast } from "./Toast";

import { API } from "./api";

type Config = {
  account_hash: string;
  trading_enabled: boolean;
  tax_filing: string;
  tax_state_rate: number;
};

export function Settings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  const [c, setC] = useState<Config | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetch(`${API}/config`).then((r) => r.json()).then(setC).catch(() => {});
  }, []);

  // Publish dirty state to the parent (App guards tab/account switches on it);
  // clear it on unmount so a stale flag can't block navigation later.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]);
  useEffect(() => () => onDirtyChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn on browser close/refresh while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!c) return <p style={S.note}>Loading settings…</p>;
  const set = (patch: Partial<Config>) => { setC({ ...c, ...patch }); setSaved(false); setDirty(true); };

  const save = () => {
    fetch(`${API}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trading_enabled: c.trading_enabled,
        tax_filing: c.tax_filing,
        tax_state_rate: c.tax_state_rate,
      }),
    })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => {
        if (!j || j.error) throw new Error("bad response");
        setC(j); setSaved(true); setDirty(false);
      })
      .catch(() => toast("Couldn't save settings — check the values and try again.", "error"));
  };

  return (
    <div style={S.wrap}>
      <p style={S.scope}>
        Account settings for the selected account. Your buy/sell rules now live in the
        {" "}<b>Rules</b> tab.
      </p>

      <Section title="Schwab API credentials" info="Your Schwab developer-app key + secret (from developer.schwab.com) and callback URL. Stored on THIS install (overrides .env), so each person/install uses their own app. Set these first, then connect each profile under Schwab connection.">
        <SchwabCreds />
      </Section>

      <Section title="Schwab connection" info="Schwab's refresh token expires every 7 days. Re-authorize the ACTIVE profile here to keep its live feed and trading working — no terminal needed.">
        <ConnectionStatus />
      </Section>

      <Section title="Company data (Financial Modeling Prep)" info="Optional free API key from financialmodelingprep.com. Schwab has no sector/industry/country data, so this auto-tags your tickers — making the Screener's sector-exclusion and country guardrails work automatically. Free tier covers this; the whole-market screener is paywalled.">
        <FmpKey />
      </Section>

      <Section title="Account" info="Controls whether this account may place orders. The managed (LLC) account stays off; enable only the account you actually trade through the API.">
        <label style={S.toggle}>
          <input type="checkbox" checked={c.trading_enabled}
            onChange={(e) => set({ trading_enabled: e.target.checked })} />
          Trading enabled (allow placing orders on this account)
        </label>
      </Section>

      <Section title="Taxes" info="Used to estimate taxes on the Ledger. Filing status picks the federal bracket table; state rate is your flat state income-tax rate (day-trade gains are short-term = ordinary income).">
        <Field label="Filing status">
          <select className="field" style={S.input} value={c.tax_filing} onChange={(e) => set({ tax_filing: e.target.value })}>
            <option value="single">Single</option>
            <option value="joint">Married filing jointly</option>
          </select>
        </Field>
        <Field label="State tax rate (%)">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input className="field" style={{ ...S.input, width: 110 }} type="number" step="0.1"
              value={+(c.tax_state_rate * 100).toFixed(4)}
              onChange={(e) => set({ tax_state_rate: Number(e.target.value) / 100 })} />
            <span style={{ color: "var(--text-faint)" }}>%</span>
          </span>
        </Field>
      </Section>

      <Section title="Data & backups" info="Your entire trading history lives in one local database file. The app backs it up automatically on startup and daily (keeping the newest 14), using a method that's safe while the app is running. Backups exclude the Schwab connection — after restoring, just reconnect.">
        <Backups />
      </Section>

      <Section title="About & diagnostics" info="Build version + a live health snapshot. Use “Copy diagnostics” to paste the whole picture into a support message.">
        <Diagnostics />
      </Section>

      <div style={S.actions}>
        <button className="btn btn-primary" onClick={save}>Save settings</button>
        {dirty ? (
          <span style={S.dirtyMsg}>● Unsaved changes</span>
        ) : saved ? (
          <span style={S.savedMsg}>✓ Saved</span>
        ) : null}
      </div>
    </div>
  );
}

function SchwabCreds() {
  const toast = useToast();
  const [configured, setConfigured] = useState(false);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [callback, setCallback] = useState("https://127.0.0.1/");
  const [busy, setBusy] = useState(false);

  // Prefill the actual stored values (this profile's) so the reveal/copy controls have
  // something to show. Per-profile: switching profiles reloads via the key remount.
  const load = () =>
    fetch(`${API}/schwab-creds/reveal`).then((r) => r.json())
      .then((c: { client_id: string; client_secret: string; callback_url: string }) => {
        setClientId(c.client_id || "");
        setSecret(c.client_secret || "");
        setCallback(c.callback_url || "https://127.0.0.1/");
        setConfigured(!!(c.client_id && c.client_secret));
      })
      .catch(() => {});
  useEffect(() => { load(); }, []);

  const save = () => {
    const body: Record<string, string> = { callback_url: callback };
    if (clientId.trim()) body.client_id = clientId.trim();
    if (secret.trim()) body.client_secret = secret.trim();
    setBusy(true);
    fetch(`${API}/schwab-creds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then(() => { load(); toast("Schwab credentials saved for this profile.", "success"); })
      .catch(() => toast("Couldn't save credentials.", "error"))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <p style={S.credStatus}>
        {configured
          ? <>Configured <b style={{ color: "var(--pos)" }}>✓</b> — these are <b>this profile's</b> credentials.</>
          : <span style={{ color: "var(--warn)" }}>Not configured — enter this profile's Schwab developer-app credentials.</span>}
      </p>
      <Field label="Client ID">
        <SecretInput value={clientId} onChange={setClientId} placeholder="App key" ariaLabel="Schwab client id" onCopied={() => toast("Client ID copied.", "info")} />
      </Field>
      <Field label="Client secret">
        <SecretInput value={secret} onChange={setSecret} placeholder="App secret" ariaLabel="Schwab client secret" onCopied={() => toast("Client secret copied.", "info")} />
      </Field>
      <Field label="Callback URL">
        <input className="field" style={S.credInput} value={callback}
          onChange={(e) => setCallback(e.target.value)} aria-label="Schwab callback url" />
      </Field>
      <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} disabled={busy} onClick={save}>Save credentials</button>
    </div>
  );
}

// A secret field: hidden dots by default, with an eye toggle to reveal/select and a
// copy button. Value is editable (typing replaces it); reveal only changes visibility.
function SecretInput({ value, onChange, placeholder, ariaLabel, onCopied }:
  { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string; onCopied?: () => void }) {
  const [shown, setShown] = useState(false);
  const copy = () => {
    if (!value) return;
    navigator.clipboard?.writeText(value).then(() => onCopied?.()).catch(() => {});
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <input className="field" style={S.credInput} type={shown ? "text" : "password"} value={value}
        placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}
        autoComplete="off" spellCheck={false} />
      <button type="button" className="btn btn-ghost btn-sm" title={shown ? "Hide" : "Show"}
        aria-label={shown ? "Hide value" : "Show value"} onClick={() => setShown((v) => !v)}>{shown ? "🙈" : "👁"}</button>
      <button type="button" className="btn btn-ghost btn-sm" title="Copy" aria-label="Copy value"
        disabled={!value} onClick={copy}>⧉</button>
    </span>
  );
}

function FmpKey() {
  const toast = useToast();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => fetch(`${API}/fmp-status`).then((r) => r.json())
    .then((s) => setConfigured(!!s?.configured)).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = () => {
    if (!key.trim()) return;
    setBusy(true);
    fetch(`${API}/fmp-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key.trim() }) })
      .then((r) => r.json())
      .then((s) => { setConfigured(!!s?.configured); setKey(""); toast("FMP key saved.", "success"); })
      .catch(() => toast("Couldn't save the key.", "error"))
      .finally(() => setBusy(false));
  };

  const enrich = () => {
    setBusy(true);
    fetch(`${API}/tickers/enrich`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: false }) })
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) { toast(j?.error || "Couldn't fetch company info.", "error"); return; }
        toast(`Tagged ${j.updated} of ${j.checked} ticker${j.checked === 1 ? "" : "s"}.`, j.updated ? "success" : "info");
      })
      .catch(() => toast("Couldn't fetch company info.", "error"))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <p style={S.credStatus}>
        {configured
          ? <>Configured <b style={{ color: "var(--pos)" }}>✓</b> — new tickers auto-tag; existing ones fill on demand below.</>
          : <span style={{ color: "var(--text-dim)" }}>Not set — optional. Get a free key at financialmodelingprep.com, then paste it here.</span>}
      </p>
      <Field label="FMP API key">
        <input className="field" style={S.credInput} type="password" value={key}
          placeholder={configured ? "•••••• (leave blank to keep)" : "API key"}
          onChange={(e) => setKey(e.target.value)} aria-label="FMP API key" />
      </Field>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={busy || !key.trim()} onClick={save}>Save key</button>
        <button className="btn btn-secondary btn-sm" disabled={busy || !configured} onClick={enrich}
          title="Fetch sector / industry / country for every ticker">Fetch company info for all tickers</button>
      </div>
    </div>
  );
}

type BackupInfo = { file: string; bytes: number; at: string };
type BackupList = { dir: string; db_bytes: number | null; keep: number; backups: BackupInfo[] };

function Backups() {
  const toast = useToast();
  const [list, setList] = useState<BackupList | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => fetch(`${API}/backups`).then((r) => r.json()).then(setList).catch(() => {});
  useEffect(() => { load(); }, []);

  const backupNow = () => {
    setBusy(true);
    fetch(`${API}/backup`, { method: "POST" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) { toast("Backup written.", "success"); load(); }
        else toast(j?.error || "Backup failed.", "error");
      })
      .catch(() => toast("Backup failed.", "error"))
      .finally(() => setBusy(false));
  };

  const mb = (n: number | null | undefined) => (n == null ? "—" : `${(n / 1048576).toFixed(1)} MB`);
  const when = (iso: string) => new Date(iso).toLocaleString();
  const last = list?.backups?.[0];

  return (
    <div>
      <p style={S.credStatus}>
        {last
          ? <>Last backup <b>{when(last.at)}</b> · {mb(last.bytes)} · {list!.backups.length} kept (max {list!.keep})</>
          : list ? <span style={{ color: "var(--warn)" }}>No backups yet — one is written automatically on startup.</span>
          : "Loading…"}
      </p>
      <p style={{ ...S.credStatus, wordBreak: "break-all" }}>
        Folder: <code>{list?.dir ?? "…"}</code> · database {mb(list?.db_bytes)}
        {list?.dir && (
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} title="Copy folder path"
            onClick={() => navigator.clipboard?.writeText(list.dir).then(() => toast("Folder path copied.", "info")).catch(() => {})}>⧉</button>
        )}
      </p>
      <button className="btn btn-secondary btn-sm" disabled={busy} onClick={backupNow}>
        {busy ? "Backing up…" : "Back up now"}
      </button>
      {list && list.backups.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="tbl">
            <thead><tr><th className="left">Backup file</th><th>When</th><th>Size</th></tr></thead>
            <tbody>
              {list.backups.map((b) => (
                <tr key={b.file}>
                  <td className="left" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)" }}>{b.file}</td>
                  <td style={{ textAlign: "right" }}>{when(b.at)}</td>
                  <td style={{ textAlign: "right" }}>{mb(b.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={S.note}>To restore: close the app, replace the database file in the folder above with a backup, reopen. (No in-app restore — a manual swap is safer for real-money data.)</p>
        </div>
      )}
    </div>
  );
}

type Diag = {
  version?: string; dataDir?: string; dbBytes?: number | null;
  database?: string; streamMode?: string;
  schwab?: { verified_live?: boolean | null; message?: string; last_checked_ago_s?: number | null; latency_ms?: number | null };
  fmp?: boolean; lastBackup?: string | null;
};

function Diagnostics() {
  const toast = useToast();
  const [d, setD] = useState<Diag | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    // /health is at the server ROOT (not under /api); everything else is under /api.
    const ROOT = API.replace(/\/api$/, "");
    Promise.allSettled([
      fetch(`${API}/version`).then((r) => r.json()),
      fetch(`${ROOT}/health`).then((r) => r.json()),
      fetch(`${API}/auth/status`).then((r) => r.json()),
      fetch(`${API}/backups`).then((r) => r.json()),
      fetch(`${API}/fmp-status`).then((r) => r.json()),
    ]).then(([ver, health, auth, backups, fmp]) => {
      const g = <T,>(r: PromiseSettledResult<T>): T | undefined => (r.status === "fulfilled" ? r.value : undefined);
      const v = g(ver) as any, h = g(health) as any, a = g(auth) as any, b = g(backups) as any, f = g(fmp) as any;
      setD({
        version: v?.version ?? h?.version, dataDir: v?.data_dir,
        dbBytes: b?.db_bytes, database: h?.database, streamMode: h?.stream_mode,
        schwab: a, fmp: !!f?.configured, lastBackup: b?.backups?.[0]?.at ?? null,
      });
    }).finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, []);

  const mb = (n: number | null | undefined) => (n == null ? "—" : `${(n / 1048576).toFixed(1)} MB`);
  const streamLabel = (m?: string) => ({ schwab: "Live", reauth: "Offline — reconnect", demo: "Demo (not connected)", starting: "Connecting…" } as Record<string, string>)[m ?? ""] ?? (m ?? "—");
  const schwabLabel = () => {
    const s = d?.schwab;
    if (!s) return "—";
    if (s.verified_live) return `Live · verified ${s.last_checked_ago_s ?? "?"}s ago${s.latency_ms ? ` · ${s.latency_ms}ms` : ""}`;
    return s.message || "Not verified";
  };
  const rows: [string, string, "ok" | "warn" | "bad" | "muted"][] = d ? [
    ["Database", d.database === "connected" ? "Connected" : (d.database || "—"), d.database === "connected" ? "ok" : "bad"],
    ["Schwab API", schwabLabel(), d.schwab?.verified_live ? "ok" : "warn"],
    ["Quote stream", streamLabel(d.streamMode), d.streamMode === "schwab" ? "ok" : d.streamMode === "reauth" ? "bad" : "muted"],
    ["Company data (FMP)", d.fmp ? "Configured ✓" : "Not set", d.fmp ? "ok" : "muted"],
    ["Last backup", d.lastBackup ? new Date(d.lastBackup).toLocaleString() : "none yet", d.lastBackup ? "ok" : "warn"],
  ] : [];
  const color = (t: string) => ({ ok: "var(--pos)", warn: "var(--warn)", bad: "var(--neg)", muted: "var(--text-faint)" }[t] || "var(--text)");

  const copy = () => {
    const txt = [
      `Schwab Trader v${d?.version ?? "?"}`,
      `Data dir: ${d?.dataDir ?? "?"}`,
      `Database: ${mb(d?.dbBytes)} · ${d?.database ?? "?"}`,
      ...rows.map(([k, v]) => `${k}: ${v}`),
    ].join("\n");
    navigator.clipboard?.writeText(txt).then(() => toast("Diagnostics copied.", "info")).catch(() => {});
  };

  return (
    <div>
      <p style={{ ...S.credStatus, fontSize: "var(--fs-md)" }}>
        <b>Schwab Trader v{d?.version ?? "…"}</b>
      </p>
      <p style={{ ...S.credStatus, wordBreak: "break-all" }}>
        Data folder: <code>{d?.dataDir ?? "…"}</code> · database {mb(d?.dbBytes)}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", margin: "8px 0", fontSize: "var(--fs-sm)" }}>
        {rows.map(([k, v, t]) => (
          <div key={k} style={{ display: "contents" }}>
            <span style={{ color: "var(--text-muted)" }}>{k}</span>
            <span style={{ color: color(t) }}>{v}</span>
          </div>
        ))}
      </div>
      <p style={S.credStatus}>Backups &amp; database controls are in the <b>Data &amp; backups</b> section above.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={load}>{busy ? "Refreshing…" : "Refresh"}</button>
        <button className="btn btn-secondary btn-sm" onClick={copy}>Copy diagnostics</button>
      </div>
    </div>
  );
}

function Section({ title, info, children }: { title: string; info?: string; children: React.ReactNode }) {
  return (
    <section style={S.section}>
      <h3 className="section-title" style={S.h3}>
        {title}
        {info && <span style={S.infoIcon} title={info}>(i)</span>}
      </h3>
      {children}
    </section>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={S.field}>
      <span style={S.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 16, maxWidth: 560 },
  scope: { color: "var(--text-dim)", fontSize: "var(--fs-sm)", marginBottom: 8 },
  section: { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: 16, marginTop: 12 },
  h3: { margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 },
  infoIcon: { fontSize: "var(--fs-2xs)", color: "var(--accent-quiet)", border: "1px solid #3a4a5a", borderRadius: "var(--r-pill)", padding: "0 5px", cursor: "help", textTransform: "none", letterSpacing: 0 },
  colHead: { display: "flex", gap: 8, fontSize: "var(--fs-2xs)", color: "var(--text-faint)", padding: "0 0 4px" },
  tierRow: { display: "flex", gap: 8, alignItems: "center", marginBottom: 6 },
  tierInput: { flex: 1, textAlign: "right", minWidth: 0 },
  field: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: "var(--fs-md)" },
  fieldLabel: { color: "var(--text-muted)" },
  input: { width: 150, textAlign: "right" },
  credInput: { width: 280, textAlign: "left" },
  credStatus: { fontSize: "var(--fs-sm)", color: "var(--text-muted)", margin: "0 0 10px" },
  toggle: { display: "flex", gap: 8, alignItems: "center", fontSize: "var(--fs-md)", color: "var(--text-muted)" },
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 16 },
  savedMsg: { color: "var(--pos)", fontSize: "var(--fs-md)" },
  dirtyMsg: { color: "var(--warn)", fontSize: "var(--fs-sm)", fontWeight: 600 },
  note: { color: "var(--text-faint)", fontSize: "var(--fs-sm)", marginTop: 16 },
};
