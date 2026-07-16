import { useEffect, useState } from "react";
import { useToast } from "../Toast";
import { API } from "../api";
import { SS } from "./ui";

type Diag = {
  version?: string; dataDir?: string; dbBytes?: number | null;
  database?: string; streamMode?: string;
  schwab?: { verified_live?: boolean | null; message?: string; last_checked_ago_s?: number | null; latency_ms?: number | null };
  fmp?: boolean; lastBackup?: string | null;
};

export function Diagnostics() {
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
      <p style={{ ...SS.credStatus, fontSize: "var(--fs-md)" }}>
        <b>Schwab Trader v{d?.version ?? "…"}</b>
      </p>
      <p style={{ ...SS.credStatus, wordBreak: "break-all" }}>
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
      <p style={SS.credStatus}>Backups &amp; database controls are in the <b>Data &amp; backups</b> section above.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={load}>{busy ? "Refreshing…" : "Refresh"}</button>
        <button className="btn btn-secondary btn-sm" onClick={copy}>Copy diagnostics</button>
        <button className="btn btn-secondary btn-sm" onClick={copyBundle} title="Diagnostics plus where to find the log to attach">Copy support bundle</button>
      </div>
      <BalanceFields />
      <RecentErrors />
    </div>
  );
}

// ---- Live balance fields (v0.55): the raw figures behind "Available to trade", so the
// mapping to Schwab's account page can be confirmed at a glance. "Available to trade"
// (tradable_funds) is what the app plans against; if it doesn't match Schwab's "Settled
// Funds" / "Funds Available to Withdraw", the individual fields here show why. ----
function BalanceFields() {
  const [m, setM] = useState<Record<string, number | null> | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    fetch(`${API}/account/margin`)
      .then((r) => r.json())
      .then((j) => { if (j?.blocked) { setBlocked(true); setM(null); } else { setBlocked(false); setM(j); } })
      .catch(() => setBlocked(true))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, []);

  const money = (n: number | null | undefined) =>
    n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  // Ordered most-conservative → loosest, so the number that matches Schwab's usable
  // figure is easy to spot. "Available to trade" is what the app actually uses.
  const fields: [string, keyof NonNullable<typeof m>, boolean][] = [
    ["Available to trade (used by the app)", "tradable_funds", true],
    ["Available funds — non-marginable", "available_funds_non_marginable", false],
    ["Buying power — non-marginable", "buying_power_non_marginable", false],
    ["Available funds", "available_funds", false],
    ["Reg-T buying power", "buying_power", false],
    ["Day-trading buying power", "day_trading_buying_power", false],
    ["Cash", "cash", false],
    ["SMA", "sma", false],
  ];

  return (
    <div style={{ marginTop: 16 }}>
      <div style={RS.head}>
        <span style={RS.title}>Balances (live from Schwab)</span>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={load}>{busy ? "…" : "Refresh"}</button>
      </div>
      {blocked ? (
        <p style={SS.credStatus}>Not connected — can't read live balances.</p>
      ) : !m ? (
        <p style={SS.credStatus}>Loading…</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "3px 14px", fontSize: "var(--fs-sm)" }}>
          {fields.map(([label, key, strong]) => (
            <div key={String(key)} style={{ display: "contents" }}>
              <span style={{ color: strong ? "var(--text)" : "var(--text-muted)", fontWeight: strong ? 600 : 400 }}>{label}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: strong ? 700 : 400,
                color: strong ? "var(--accent-quiet)" : "var(--text)" }}>{money(m[key])}</span>
            </div>
          ))}
        </div>
      )}
      <p style={RS.fine}>
        "Available to trade" is what buy suggestions and the order ticket size against — it should match
        Schwab's "Settled Funds" / "Funds Available to Withdraw". If a different row matches instead, tell
        us which and we'll point the app at it.
      </p>
    </div>
  );
}

// ---- Recent errors (W27-4): the backend's WARNING+ ring buffer, newest first ----

type LogEntry = { at: string; level: string; logger: string; message: string };

function RecentErrors() {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [logFile, setLogFile] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    fetch(`${API}/logs/recent`)
      .then((r) => r.json())
      .then((j) => {
        setEntries(Array.isArray(j?.entries) ? j.entries : []);
        setLogFile(typeof j?.log_file === "string" ? j.log_file : "");
      })
      .catch(() => setEntries([]))
      .finally(() => setBusy(false));
  };
  useEffect(() => { load(); }, []);

  // WARNING is a caution; ERROR and above read as failures.
  const levelColor = (lv: string) => (/^warn/i.test(lv) ? "var(--warn)" : "var(--neg)");
  const when = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={RS.head}>
        <span style={RS.title}>Recent errors</span>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={load}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {entries == null ? (
        <p style={SS.credStatus}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={SS.credStatus}>No warnings or errors this run.</p>
      ) : (
        <div style={RS.list}>
          {/* API already returns newest-first */}
          {entries.map((e, i) => (
            <div key={i} style={RS.line}>
              <span style={RS.time}>{when(e.at)}</span>{" "}
              <span style={{ color: levelColor(e.level), fontWeight: 700 }}>{e.level}</span>{" "}
              <span style={RS.logger}>{e.logger}</span>{" "}
              <span>{e.message}</span>
            </div>
          ))}
        </div>
      )}
      {logFile && <p style={RS.fine}>Full log: {logFile}</p>}
    </div>
  );
}

const RS: Record<string, React.CSSProperties> = {
  head: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 },
  title: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)", fontWeight: 700 },
  list: {
    maxHeight: 240, overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: "var(--fs-xs)",
    background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-md)",
    padding: "8px 10px", lineHeight: 1.6,
  },
  line: { whiteSpace: "pre-wrap", wordBreak: "break-word" },
  time: { color: "var(--text-faint)" },
  logger: { color: "var(--text-dim)" },
  fine: { fontSize: "var(--fs-2xs)", color: "var(--text-faint)", marginTop: 6, wordBreak: "break-all" },
};
