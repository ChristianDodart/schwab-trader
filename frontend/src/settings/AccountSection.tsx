import { SS } from "./ui";

/** The "Account" section body: the trading-enabled toggle. State lives in the
 * Settings orchestrator (it's part of the dirty-tracked config). */
export function AccountSection({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={SS.toggle}>
      <input type="checkbox" checked={enabled}
        onChange={(e) => onChange(e.target.checked)} />
      Trading enabled (allow placing orders on this account)
    </label>
  );
}
