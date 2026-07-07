import { useEffect, useState } from "react";
import { useToast } from "../Toast";
import { API } from "../api";
import { Field, SS } from "./ui";

export function FmpKey() {
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
      <p style={SS.credStatus}>
        {configured
          ? <>Configured <b style={{ color: "var(--pos)" }}>✓</b> — new tickers auto-tag; existing ones fill on demand below.</>
          : <span style={{ color: "var(--text-dim)" }}>Not set — optional. Get a free key at financialmodelingprep.com, then paste it here.</span>}
      </p>
      <Field label="FMP API key">
        <input className="field" style={SS.credInput} type="password" value={key}
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
