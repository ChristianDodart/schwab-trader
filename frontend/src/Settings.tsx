import { useEffect, useState } from "react";
import { ConnectionStatus } from "./Reauth";
import { useToast } from "./Toast";
import { CHANGELOG, entryFor } from "./changelog";
import { SIGNAL_METRICS, newRule, metricUnit, type SignalRule } from "./signals";

import { API } from "./api";

// Render CHANGELOG body readably: leading "- " → "• ", drop the machine footer.
const prettyNotes = (body: string) =>
  body.split("\n")
    .filter((l) => !/^-{3,}$/.test(l.trim()) && !/^how to update/i.test(l.trim()))
    .map((l) => l.replace(/^[-*]\s+/, "• "))
    .join("\n").trim();

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
        {" "}<b>Rules</b> tab. Tip: press <kbd style={{ fontFamily: "monospace", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)", padding: "0 5px" }}>?</kbd> anywhere for keyboard shortcuts.
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

      <Section title="Signals" info="Dashboard buy/sell flags. The default rule is built in (BUY at the next ladder rung, SELL at the strategy sell target — set those under Rules). Add your own OR rules with custom colors — a ticker flags when the default OR any enabled rule matches.">
        <SignalRulesEditor />
      </Section>

      <Section title="Benchmark" info="The buy-and-hold yardstick for the Ledger's 'If it were all …' comparison — what your exact deposits would be worth in this ticker instead of actively traded.">
        <BenchmarkPicker />
      </Section>

      <Section title="Phone notifications" info="Optional. Also send resting-fill, strategy-trigger, and price alerts to your phone. ntfy.sh needs no account — pick a hard-to-guess topic and subscribe to it in the free ntfy app. Or use email via SMTP (an app password, not your login password). The in-app bell always works regardless.">
        <PhoneNotify />
      </Section>

      <Section title="Data health & import" info="The app rebuilds your ladder and realized history from a durable fill ledger: recent trades sync from Schwab automatically, and one Transactions CSV export backfills years of history in a single upload (trades, deposits, and dividends are all routed from the same file). Re-importing is always safe — nothing double-counts.">
        <DataHealth />
      </Section>

      <Section title="Data & backups" info="Your entire trading history lives in one local database file. The app backs it up automatically on startup and daily (keeping the newest 14), using a method that's safe while the app is running. Backups exclude the Schwab connection — after restoring, just reconnect.">
        <Backups />
      </Section>

      <Section title="What's new" info="Patch notes for your current version. The same notes appear in the update banner when a new version is ready.">
        <WhatsNew />
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

type PhoneCfg = {
  channel: "off" | "ntfy" | "email";
  ntfy_url: string; smtp_host: string; smtp_port: number; smtp_user: string;
  smtp_from: string; smtp_to: string; smtp_tls: boolean; smtp_pass_set?: boolean;
  cat_alerts: boolean; cat_triggers: boolean; cat_fills: boolean;
};

function PhoneNotify() {
  const toast = useToast();
  const [cfg, setCfg] = useState<PhoneCfg | null>(null);
  const [pass, setPass] = useState(""); // write-only; blank keeps the stored one
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API}/phone-notify`).then((r) => r.json())
      .then((s) => setCfg({
        channel: s.channel ?? "off", ntfy_url: s.ntfy_url ?? "",
        smtp_host: s.smtp_host ?? "", smtp_port: s.smtp_port ?? 587, smtp_user: s.smtp_user ?? "",
        smtp_from: s.smtp_from ?? "", smtp_to: s.smtp_to ?? "", smtp_tls: s.smtp_tls ?? true,
        smtp_pass_set: !!s.smtp_pass_set,
        cat_alerts: s.cat_alerts ?? true, cat_triggers: s.cat_triggers ?? true, cat_fills: s.cat_fills ?? true,
      }))
      .catch(() => {});
  }, []);

  if (!cfg) return <p style={S.credStatus}>Loading…</p>;
  const patch = (p: Partial<PhoneCfg>) => setCfg((c) => (c ? { ...c, ...p } : c));

  const save = () => {
    setBusy(true);
    const body: Record<string, unknown> = { ...cfg };
    delete body.smtp_pass_set;
    if (pass.trim()) body.smtp_pass = pass.trim(); // omit when blank → server keeps stored
    fetch(`${API}/phone-notify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((s) => { patch({ smtp_pass_set: !!s.smtp_pass_set }); setPass(""); toast("Phone settings saved.", "success"); })
      .catch(() => toast("Couldn't save phone settings.", "error"))
      .finally(() => setBusy(false));
  };

  const test = () => {
    setBusy(true);
    fetch(`${API}/phone-notify/test`, { method: "POST" })
      .then((r) => r.json())
      .then((s) => toast(s.ok ? "Test sent — check your phone." : `Test failed: ${s.error}`, s.ok ? "success" : "error"))
      .catch(() => toast("Test failed — network error.", "error"))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <Field label="Channel">
        <select className="field" style={S.input} value={cfg.channel} onChange={(e) => patch({ channel: e.target.value as PhoneCfg["channel"] })}>
          <option value="off">Off</option>
          <option value="ntfy">ntfy.sh (no account)</option>
          <option value="email">Email (SMTP)</option>
        </select>
      </Field>

      {cfg.channel === "ntfy" && (
        <>
          <Field label="Topic URL">
            <input className="field" style={S.credInput} value={cfg.ntfy_url} placeholder="https://ntfy.sh/my-secret-topic"
              onChange={(e) => patch({ ntfy_url: e.target.value })} aria-label="ntfy topic URL" />
          </Field>
          <p style={S.credStatus}>Install the ntfy app, subscribe to this exact topic. Anyone who knows the topic can read it — use a long random name.</p>
        </>
      )}

      {cfg.channel === "email" && (
        <>
          <Field label="SMTP host"><input className="field" style={S.credInput} value={cfg.smtp_host} placeholder="smtp.gmail.com" onChange={(e) => patch({ smtp_host: e.target.value })} /></Field>
          <Field label="Port"><input className="field" style={S.input} type="number" value={cfg.smtp_port} onChange={(e) => patch({ smtp_port: Number(e.target.value) || 587 })} /></Field>
          <Field label="Username"><input className="field" style={S.credInput} value={cfg.smtp_user} placeholder="you@gmail.com" onChange={(e) => patch({ smtp_user: e.target.value })} /></Field>
          <Field label="Password / app password">
            <input className="field" style={S.credInput} type="password" value={pass}
              placeholder={cfg.smtp_pass_set ? "•••••• (leave blank to keep)" : "app password"}
              onChange={(e) => setPass(e.target.value)} aria-label="SMTP password" />
          </Field>
          <Field label="From"><input className="field" style={S.credInput} value={cfg.smtp_from} placeholder="you@gmail.com" onChange={(e) => patch({ smtp_from: e.target.value })} /></Field>
          <Field label="To (your phone)"><input className="field" style={S.credInput} value={cfg.smtp_to} placeholder="you@icloud.com" onChange={(e) => patch({ smtp_to: e.target.value })} /></Field>
          <p style={S.credStatus}>Use an app password (Gmail/iCloud require one), never your login password. Port 465 = SSL, 587 = STARTTLS.</p>
        </>
      )}

      {cfg.channel !== "off" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-dim)", marginBottom: 4 }}>Send to phone:</div>
          {([["cat_alerts", "Price alerts"], ["cat_triggers", "Strategy triggers"], ["cat_fills", "Order fills"]] as const).map(([k, label]) => (
            <label key={k} style={{ ...S.toggle, fontSize: "var(--fs-sm)", marginRight: 16 }}>
              <input type="checkbox" checked={cfg[k]} onChange={(e) => patch({ [k]: e.target.checked })} />
              {label}
            </label>
          ))}
          <p style={S.credStatus}>The in-app bell always shows everything; these only gate what reaches your phone.</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>Save</button>
        <button className="btn btn-secondary btn-sm" disabled={busy || cfg.channel === "off"} onClick={test}
          title="Send a test message to confirm it works">Send test</button>
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

  const diagText = () => [
    `Schwab Trader v${d?.version ?? "?"}`,
    `Data dir: ${d?.dataDir ?? "?"}`,
    `Database: ${mb(d?.dbBytes)} · ${d?.database ?? "?"}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
  ].join("\n");

  const copy = () => {
    navigator.clipboard?.writeText(diagText()).then(() => toast("Diagnostics copied.", "info")).catch(() => {});
  };

  // A fuller bundle for a support message: diagnostics + where the log/backups live so
  // the user can attach backend.log (we can't read files from the browser sandbox).
  const copyBundle = () => {
    const dir = d?.dataDir ?? "?";
    const txt = [
      diagText(),
      "",
      "--- support bundle ---",
      `Copied: ${new Date().toISOString()}`,
      `Attach this file: ${dir}\\backend.log`,
      `Backups folder: ${dir}\\backups`,
    ].join("\n");
    navigator.clipboard?.writeText(txt)
      .then(() => toast("Support bundle copied — attach backend.log from the data folder.", "info"))
      .catch(() => {});
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
        <button className="btn btn-secondary btn-sm" onClick={copyBundle} title="Diagnostics plus where to find the log to attach">Copy support bundle</button>
      </div>
    </div>
  );
}

type StrategyInfo = { sell?: { default_mode?: string; dollar_gain?: number; pct_above?: number }; ladder_drops?: { drop_pct?: number }[] };

function SignalRulesEditor() {
  const toast = useToast();
  const [rules, setRules] = useState<SignalRule[] | null>(null);
  const [strat, setStrat] = useState<StrategyInfo | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`${API}/signal-rules`).then((r) => r.json())
      .then((j) => setRules(Array.isArray(j?.rules) ? j.rules : [])).catch(() => setRules([]));
    fetch(`${API}/strategy`).then((r) => r.json()).then((j) => setStrat(j)).catch(() => {});
  }, []);
  // Describe the built-in default rule with the ACTUAL strategy numbers it fires at.
  const sellDefault = (() => {
    const s = strat?.sell;
    if (!s) return "the strategy sell target";
    if (s.default_mode === "pct_above" && s.pct_above != null) return `+${(s.pct_above * 100).toFixed(0)}% above a lot's cost`;
    if (s.dollar_gain != null) return `+$${s.dollar_gain.toFixed(0)} profit on a lot`;
    return "the strategy sell target";
  })();
  const buyDefault = (() => {
    const d0 = strat?.ladder_drops?.[0]?.drop_pct;
    return d0 != null ? `the next ladder rung (first dip −${(d0 * 100).toFixed(0)}%)` : "the next ladder rung";
  })();
  if (!rules) return <p style={S.credStatus}>Loading…</p>;
  const patch = (i: number, p: Partial<SignalRule>) => setRules((rs) => rs!.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = () => {
    setBusy(true);
    fetch(`${API}/signal-rules`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules }) })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) { setRules(j.rules); toast("Signal rules saved — the dashboard will use them.", "success"); } else toast("Couldn't save rules.", "error"); })
      .catch(() => toast("Couldn't save rules.", "error"))
      .finally(() => setBusy(false));
  };
  return (
    <div>
      <div style={{ ...S.credStatus, display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="chip chip-buy">▲BUY</span>
        <span>at {buyDefault}</span>
        <span style={{ color: "var(--text-faint)" }}>·</span>
        <span className="chip chip-sell">▼SELL</span>
        <span>at {sellDefault}</span>
        <span style={{ color: "var(--text-faint)" }}>— built in (change under Rules).</span>
      </div>
      {rules.map((r, i) => (
        <div key={r.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", margin: "6px 0", padding: 8, background: "var(--panel-2)", borderRadius: "var(--r-md)" }}>
          <select value={r.side} className="field" style={{ height: 28, minWidth: 76, paddingRight: 24 }}
            onChange={(e) => { const side = e.target.value as "buy" | "sell"; patch(i, { side, metric: SIGNAL_METRICS[side][0].key }); }}>
            <option value="sell">Sell</option><option value="buy">Buy</option>
          </select>
          <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>when</span>
          <select value={r.metric} className="field" style={{ height: 28, minWidth: 200, paddingRight: 24 }} onChange={(e) => patch(i, { metric: e.target.value })}>
            {SIGNAL_METRICS[r.side].map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <select value={r.op} className="field" style={{ height: 28, width: 54 }} onChange={(e) => patch(i, { op: e.target.value as ">=" | "<=" })}>
            <option value=">=">≥</option><option value="<=">≤</option>
          </select>
          <input type="number" value={r.value} className="field" style={{ height: 28, width: 80, textAlign: "right" }}
            onChange={(e) => patch(i, { value: Number(e.target.value) })} aria-label="Threshold" />
          <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>{metricUnit(r.side, r.metric)}</span>
          <input type="color" value={r.color} title="Chip color" aria-label="Chip color"
            onChange={(e) => patch(i, { color: e.target.value })} style={{ width: 30, height: 28, padding: 0, border: "none", background: "none", cursor: "pointer" }} />
          <input value={r.label} placeholder="label" className="field" style={{ height: 28, width: 96 }}
            onChange={(e) => patch(i, { label: e.target.value })} aria-label="Chip label" />
          <label style={{ fontSize: "var(--fs-xs)", color: "var(--text-muted)", display: "inline-flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={r.enabled} onChange={(e) => patch(i, { enabled: e.target.checked })} />on
          </label>
          <button className="btn btn-ghost btn-sm" aria-label="Delete rule" onClick={() => setRules((rs) => rs!.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setRules((rs) => [...rs!, newRule("sell")])}>+ Sell rule</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setRules((rs) => [...rs!, newRule("buy")])}>+ Buy rule</button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={save} style={{ marginLeft: "auto" }}>Save rules</button>
      </div>
    </div>
  );
}

type HealthReport = {
  ok: boolean;
  fill_ledger: { total: number; by_source: Record<string, number>; earliest: string | null; latest: string | null };
  projection: { open_lots: number; synthetic_lots: { symbol: string; shares: number }[]; completed_trades: number; earliest_completed: string | null };
  position_diffs: { symbol: string; reconstructed: number; actual: number; diff: number }[];
  basis_diffs?: { symbol: string; our_cost: number; schwab_basis: number; diff: number; count_matches?: boolean }[];
  cash_check?: {
    expected_cash: number; actual_cash: number; residual: number; residual_pct_of_flow: number;
    components: { net_deposits: number; trading_net: number; income: number };
    caveats: string;
  } | null;
  positions_checked: boolean;
  recommendations: string[];
};

// Data-integrity panel: fill-ledger coverage + gaps, and the ONE-FILE intake — a
// Schwab Transactions CSV routes trades/deposits/dividends in a single upload.
function DataHealth() {
  const toast = useToast();
  const [h, setH] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const load = () => {
    fetch(`${API}/data/health`).then((r) => r.json())
      .then((j) => setH(j?.ok ? j : null)).catch(() => setH(null));
  };
  useEffect(load, []);

  const onFile = (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setSummary(null);
    file.text()
      .then((csv) => fetch(`${API}/data/import-csv`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }),
      }))
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) { toast(j?.error || "Couldn't import the file.", "error"); return; }
        const t = j.trades || {};
        const parts = [
          `${t.added ?? 0} trades added${t.skipped_known ? ` (${t.skipped_known} already known)` : ""}`,
          `${j.cashflows?.added ?? 0} deposits/withdrawals`,
          `${j.dividends?.added ?? 0} dividends`,
        ];
        if (t.splits) parts.push(`${t.splits} reverse split${t.splits === 1 ? "" : "s"} applied`);
        if (t.unmatched_splits) parts.push(`${t.unmatched_splits} split row(s) UNMATCHED — tell support`);
        if (t.shorts_excluded) parts.push(`${t.shorts_excluded} short-sale rows excluded (long-only; covering buys netted out)`);
        const others = Object.entries(j.other_actions || {});
        if (others.length) parts.push(`skipped: ${others.map(([k, v]) => `${k} ×${v}`).join(", ")}`);
        setSummary(parts.join(" · "));
        toast(t.added ? "History imported — ladder and realized trades re-projected." : "Nothing new in this file — already fully imported.", "success");
        load();
      })
      .catch(() => toast("Import failed — network error.", "error"))
      .finally(() => setBusy(false));
  };

  const led = h?.fill_ledger;
  const proj = h?.projection;
  return (
    <div>
      {h ? (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
            <span>Fill history <b style={{ color: "var(--text)" }}>{led!.total.toLocaleString()}</b>
              {led!.total > 0 && <> · {Object.entries(led!.by_source).map(([s, n]) => `${n} ${s}`).join(" + ")}</>}
            </span>
            {led!.earliest && <span>covers <b style={{ color: "var(--text)" }}>{led!.earliest} → {led!.latest}</b></span>}
            <span>Realized trades <b style={{ color: "var(--text)" }}>{proj!.completed_trades.toLocaleString()}</b>
              {proj!.earliest_completed && <> (since {proj!.earliest_completed})</>}</span>
          </div>
          {proj!.synthetic_lots.length > 0 && (
            <p style={{ ...S.credStatus, color: "var(--warn)" }}>
              {proj!.synthetic_lots.length} holding{proj!.synthetic_lots.length === 1 ? "" : "s"} ({proj!.synthetic_lots.map((l) => l.symbol).join(", ")}) partly
              predate the stored history — shown as "prior holdings" lots until older trades are imported.
            </p>
          )}
          {h.position_diffs.length > 0 && (
            <p style={{ ...S.credStatus, color: "var(--warn)" }}>
              Share-count differences vs Schwab: {h.position_diffs.map((d) => `${d.symbol} ${d.diff > 0 ? "+" : ""}${d.diff}`).join(", ")} — a resync or CSV import usually resolves this.
            </p>
          )}
          {(h.basis_diffs?.some((b) => !b.count_matches) ?? false) && (
            <p style={{ ...S.credStatus, color: "var(--warn)" }}>
              Cost basis differs from Schwab: {h.basis_diffs!.filter((b) => !b.count_matches).map((b) => `${b.symbol} ${b.diff > 0 ? "+" : "-"}$${Math.abs(b.diff).toFixed(0)}`).join(", ")} — usually an estimated backfill; a CSV covering those buys fixes it exactly.
            </p>
          )}
          {(h.basis_diffs?.some((b) => b.count_matches) ?? false) && (
            <p style={S.credStatus}
              title="Same trades, different surviving lots: this app assigns sells to the newest lots (LIFO — the ladder strategy), while Schwab's remaining-cost figure follows your account's tax-lot election (often FIFO). With share counts matching, nothing is missing.">
              Lot-accounting note on {h.basis_diffs!.filter((b) => b.count_matches).map((b) => `${b.symbol} (${b.diff > 0 ? "+" : "-"}$${Math.abs(b.diff).toFixed(0)})`).join(", ")}: share counts match Schwab exactly; the cost difference is LIFO (this app) vs your Schwab tax-lot method. Informational — hover for the why.
            </p>
          )}
          {h.cash_check && (
            <p style={S.credStatus}
              title={`Expected = deposits ${h.cash_check.components.net_deposits.toLocaleString("en-US", { style: "currency", currency: "USD" })} + trading net ${h.cash_check.components.trading_net.toLocaleString("en-US", { style: "currency", currency: "USD" })} + income ${h.cash_check.components.income.toLocaleString("en-US", { style: "currency", currency: "USD" })}. Advisory only — ${h.cash_check.caveats}.`}>
              Cash cross-check vs Schwab:{" "}
              <b style={{ color: Math.abs(h.cash_check.residual) > 100 ? "var(--warn)" : "var(--text)" }}>
                {h.cash_check.residual >= 0 ? "+" : ""}{h.cash_check.residual.toLocaleString("en-US", { style: "currency", currency: "USD" })}
              </b>{" "}
              unexplained ({h.cash_check.residual_pct_of_flow}% of traded volume). Small residuals are normal (fees, interest); a large one hints at missing history. Hover for the math.
            </p>
          )}
          {h.recommendations.map((r, i) => <p key={i} style={S.credStatus}>{r}</p>)}
        </>
      ) : (
        <p style={S.credStatus}>Loading health report…</p>
      )}
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <label className={`btn btn-secondary btn-sm${busy ? " disabled" : ""}`} style={{ cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Importing…" : "Import Schwab transactions CSV"}
          <input type="file" accept=".csv,text/csv" disabled={busy} style={{ display: "none" }}
            onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} />
        </label>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-dim)" }}>
          Schwab.com → Accounts → History → Export. One file imports trades, deposits, and dividends together.
        </span>
      </div>
      {summary && <p style={{ ...S.credStatus, marginTop: 8 }}>{summary}</p>}
    </div>
  );
}

function BenchmarkPicker() {
  const toast = useToast();
  const [sym, setSym] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    fetch(`${API}/benchmark-symbol`).then((r) => r.json())
      .then((j) => { const s = j?.symbol || "SPY"; setSym(s); setSaved(s); }).catch(() => {});
  }, []);
  const save = () => {
    const s = sym.trim().toUpperCase() || "SPY";
    fetch(`${API}/benchmark-symbol`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: s }) })
      .then((r) => r.json())
      .then((j) => { const v = j?.symbol || s; setSym(v); setSaved(v); toast(`Benchmark set to ${v}.`, "success"); })
      .catch(() => toast("Couldn't save the benchmark.", "error"));
  };
  return (
    <div>
      <Field label="Benchmark ticker">
        <span style={{ display: "inline-flex", gap: 6 }}>
          <input className="field" style={{ width: 110, textAlign: "left" }} value={sym}
            onChange={(e) => setSym(e.target.value.toUpperCase())} placeholder="SPY" aria-label="Benchmark ticker" />
          <button className="btn btn-primary btn-sm" disabled={!sym.trim() || sym.trim().toUpperCase() === saved} onClick={save}>Save</button>
        </span>
      </Field>
      <p style={S.credStatus}>Any liquid ETF or stock with price history works — SPY, QQQ, VTI. Change it and the Ledger comparison updates.</p>
    </div>
  );
}

function WhatsNew() {
  const [version, setVersion] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    fetch(`${API}/version`).then((r) => r.json()).then((j) => setVersion(j?.version ?? null)).catch(() => {});
  }, []);
  if (!CHANGELOG.length) return <p style={S.credStatus}>No release notes bundled.</p>;
  const current = entryFor(version) ?? CHANGELOG[0];
  const list = showAll ? CHANGELOG : current ? [current] : [];
  return (
    <div>
      {list.map((e) => (
        <div key={e.version} style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: "var(--fs-md)" }}>
            v{e.version}{e.title ? ` — ${e.title}` : ""}
            {e.version === version && <span style={S.nowTag}>you're on this</span>}
          </div>
          <div style={S.notesBody}>{prettyNotes(e.body)}</div>
        </div>
      ))}
      {CHANGELOG.length > 1 && (
        <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show only current" : "Show older versions"}
        </button>
      )}
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
  notesBody: { whiteSpace: "pre-wrap", color: "var(--text-muted)", fontSize: "var(--fs-sm)", marginTop: 4, lineHeight: 1.5 },
  nowTag: { fontSize: "var(--fs-2xs)", color: "var(--pos)", border: "1px solid var(--pos)", borderRadius: "var(--r-pill)", padding: "0 7px", marginLeft: 8, textTransform: "uppercase", letterSpacing: "0.04em" },
  toggle: { display: "flex", gap: 8, alignItems: "center", fontSize: "var(--fs-md)", color: "var(--text-muted)" },
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 16 },
  savedMsg: { color: "var(--pos)", fontSize: "var(--fs-md)" },
  dirtyMsg: { color: "var(--warn)", fontSize: "var(--fs-sm)", fontWeight: 600 },
  note: { color: "var(--text-faint)", fontSize: "var(--fs-sm)", marginTop: 16 },
};
