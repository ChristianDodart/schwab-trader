import { useEffect, useState } from "react";
import { usd } from "./App";

type Account = {
  hash: string;
  mask: string;
  type: string | null;
  liquidation_value: number | null;
  cash: number | null;
  positions_count: number | null;
  tradable: boolean;
};

import { API } from "./api";

// CONTROLLED: the selected account is driven by `value` (App's acctKey). choose()
// only REQUESTS a change via onAccountChange — App owns the server select + commit,
// so a guarded/cancelled switch (unsaved Settings) never desyncs the real account.
export function AccountPicker({ value, onAccountChange, onInit }: { value?: string | null; onAccountChange?: (hash: string) => void; onInit?: (hash: string) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [initial, setInitial] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/accounts`)
      .then((r) => r.json())
      .then((j) => {
        setAccounts(j.accounts ?? []);
        setInitial(j.selected_hash ?? null);
        // Startup: the server already has this account selected — just sync App's
        // state via onInit. Do NOT route through onAccountChange, which would fire a
        // redundant /accounts/select POST and wipe the freshly-loaded dashboard.
        if (j.selected_hash) onInit?.(j.selected_hash);
      })
      .catch(() => {});
  }, []);

  if (accounts.length === 0) return null;
  const cur = value ?? initial ?? "";
  const active = accounts.find((a) => a.hash === cur);

  return (
    <div style={S.wrap}>
      <span style={S.label}>Account</span>
      <select className="field" value={cur} onChange={(e) => onAccountChange?.(e.target.value)}>
        {accounts.map((a) => (
          <option key={a.hash} value={a.hash}>
            {a.mask} · {a.type ?? "?"}{a.tradable ? "" : " (restricted)"}
          </option>
        ))}
      </select>
      {active && (
        <span style={S.meta}>
          {usd(active.liquidation_value)} · {active.positions_count ?? 0} positions
        </span>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", alignItems: "center", gap: 8 },
  label: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-faint)" },
  meta: { fontSize: "var(--fs-xs)", color: "var(--text-faint)" },
};
