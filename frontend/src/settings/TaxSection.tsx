import { Field, SS } from "./ui";

/** The "Taxes" section body: filing status + flat state rate. State lives in the
 * Settings orchestrator (it's part of the dirty-tracked config). */
export function TaxSection({ filing, stateRate, onChange }: {
  filing: string;
  stateRate: number; // stored as a fraction (0.05 = 5%)
  onChange: (patch: { tax_filing?: string; tax_state_rate?: number }) => void;
}) {
  return (
    <>
      <Field label="Filing status">
        <select className="field" style={SS.input} value={filing} onChange={(e) => onChange({ tax_filing: e.target.value })}>
          <option value="single">Single</option>
          <option value="joint">Married filing jointly</option>
        </select>
      </Field>
      <Field label="State tax rate (%)">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input className="field" style={{ ...SS.input, width: 110 }} type="number" step="0.1"
            value={+(stateRate * 100).toFixed(4)}
            onChange={(e) => onChange({ tax_state_rate: Number(e.target.value) / 100 })} />
          <span style={{ color: "var(--text-faint)" }}>%</span>
        </span>
      </Field>
    </>
  );
}
