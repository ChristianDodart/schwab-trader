import { useEffect, useState } from "react";
import { useToast } from "../Toast";
import { API } from "../api";
import { SS } from "./ui";

type BackupInfo = { file: string; bytes: number; at: string };
type BackupList = { dir: string; db_bytes: number | null; keep: number; backups: BackupInfo[] };

export function Backups() {
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
      <p style={SS.credStatus}>
        {last
          ? <>Last backup <b>{when(last.at)}</b> · {mb(last.bytes)} · {list!.backups.length} kept (max {list!.keep})</>
          : list ? <span style={{ color: "var(--warn)" }}>No backups yet — one is written automatically on startup.</span>
          : "Loading…"}
      </p>
      <p style={{ ...SS.credStatus, wordBreak: "break-all" }}>
        Folder: <code>{list?.dir ?? "…"}</code> · database {mb(list?.db_bytes)}
        {list?.dir && (
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} title="Copy folder path" aria-label="Copy folder path"
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
          <p style={SS.note}>To restore: close the app, replace the database file in the folder above with a backup, reopen. (No in-app restore — a manual swap is safer for real-money data.)</p>
        </div>
      )}
    </div>
  );
}
