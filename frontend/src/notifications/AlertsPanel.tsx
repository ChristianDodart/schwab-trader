import type { Alert } from "../types";
import { fmtNum, fmtTime } from "./format";
import { PS } from "./ui";

/** The "Alerts" tab: the price-alerts manager — add form + active/triggered list.
 * Form state lives in the bell so it survives tab switches and prefill opens. */
export function AlertsPanel({ alerts, sym, onSym, dir, onDir, price, onPrice, repeat, onRepeat, formMsg, onAdd, onRemove }: {
  alerts: Alert[];
  sym: string;
  onSym: (v: string) => void;
  dir: "above" | "below";
  onDir: (v: "above" | "below") => void;
  price: string;
  onPrice: (v: string) => void;
  repeat: boolean;
  onRepeat: (v: boolean) => void;
  formMsg: string | null;
  onAdd: () => void;
  onRemove: (a: Alert) => void;
}) {
  return (
    <div style={PS.body} id="nt-panel-alerts" role="tabpanel" aria-labelledby="nt-tab-alerts" tabIndex={0}>
      <div style={PS.form}>
        <input
          className="field"
          style={{ width: 70 }}
          placeholder="SYM"
          aria-label="Alert symbol"
          value={sym}
          onChange={(e) => onSym(e.target.value.toUpperCase())}
        />
        <select
          className="field"
          value={dir}
          aria-label="Alert direction"
          onChange={(e) => onDir(e.target.value as "above" | "below")}
        >
          <option value="above">rises ≥</option>
          <option value="below">falls ≤</option>
        </select>
        <input
          className="field"
          style={{ width: 80 }}
          placeholder="price"
          aria-label="Alert price"
          inputMode="decimal"
          value={price}
          onChange={(e) => onPrice(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
        />
        <label style={PS.repeat} title="re-arm and fire on every future crossing">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => onRepeat(e.target.checked)}
          />
          repeat
        </label>
        <button className="btn btn-primary btn-sm" onClick={onAdd}>
          Set
        </button>
      </div>
      <div aria-live="polite">
        {formMsg && <div style={PS.formMsg}>{formMsg}</div>}
      </div>

      {alerts.length === 0 ? (
        <p style={PS.empty}>No alerts. Add one above.</p>
      ) : (
        alerts.map((a) => (
          <div key={a.id} style={{ ...PS.note, opacity: a.active ? 1 : 0.5 }}>
            <div style={{ flex: 1 }}>
              <div style={PS.noteMsg}>
                <b>{a.symbol}</b> {a.direction === "above" ? "≥" : "≤"}{" "}
                {fmtNum(a.threshold)}
                {a.repeat && <span style={PS.tagRepeat}>repeat</span>}
                {!a.active && <span style={PS.tagDone}>triggered</span>}
              </div>
              <div style={PS.noteTime}>
                {a.active
                  ? "watching…"
                  : `fired ${fmtTime(a.last_fired_at)}`}
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              title="delete alert"
              aria-label={`Delete alert for ${a.symbol}`}
              onClick={() => onRemove(a)}
            >
              ✕
            </button>
          </div>
        ))
      )}
    </div>
  );
}
