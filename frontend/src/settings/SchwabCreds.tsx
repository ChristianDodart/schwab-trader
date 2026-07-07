import { useEffect, useState } from "react";
import { useToast } from "../Toast";
import { API } from "../api";
import { Field, SS } from "./ui";

export function SchwabCreds() {
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
      <p style={SS.credStatus}>
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
        <input className="field" style={SS.credInput} value={callback}
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
      <input className="field" style={SS.credInput} type={shown ? "text" : "password"} value={value}
        placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}
        autoComplete="off" spellCheck={false} />
      <button type="button" className="btn btn-ghost btn-sm" title={shown ? "Hide" : "Show"}
        aria-label={shown ? "Hide value" : "Show value"} onClick={() => setShown((v) => !v)}>{shown ? "🙈" : "👁"}</button>
      <button type="button" className="btn btn-ghost btn-sm" title="Copy" aria-label="Copy value"
        disabled={!value} onClick={copy}>⧉</button>
    </span>
  );
}
