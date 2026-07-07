import { useEffect, useState } from "react";
import { useToast } from "../Toast";
import { API } from "../api";
import { Field, SS } from "./ui";

export function BenchmarkPicker() {
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
      <p style={SS.credStatus}>Any liquid ETF or stock with price history works — SPY, QQQ, VTI. Change it and the Ledger comparison updates.</p>
    </div>
  );
}
