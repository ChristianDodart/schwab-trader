import { useEffect, useState } from "react";
import { usd } from "./App";
import { Modal } from "./Modal";

type Account = {
  hash: string;
  mask: string;
  type: string | null;
  liquidation_value: number | null;
  cash: number | null;
  positions_count: number | null;
  day_profit: number | null;
  invested: number | null;
  tradable: boolean;
};

import { API } from "./api";

// CONTROLLED: the selected account is driven by `value` (App's acctKey). choose()
// only REQUESTS a change via onAccountChange — App owns the server select + commit,
// so a guarded/cancelled switch (unsaved Settings) never desyncs the real account.
export function AccountPicker({ value, onAccountChange, onInit }: { value?: string | null; onAccountChange?: (hash: string) => void; onInit?: (hash: string) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [initial, setInitial] = useState<string | null>(null);
  const [rollup, setRollup] = useState(false);

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
      {accounts.length > 1 && (
        <button className="btn btn-ghost btn-sm" onClick={() => setRollup(true)}
          title="Value, day profit, cash, and positions for every account on this profile — combined">
          All accounts
        </button>
      )}
      {rollup && (
        <AccountsRollup
          onClose={() => setRollup(false)}
          onPick={(hash) => { setRollup(false); if (hash !== cur) onAccountChange?.(hash); }}
          selected={cur}
        />
      )}
    </div>
  );
}

// Read-only overview of every account the profile's token can see: one card per
// account + a combined-totals band. Fetches fresh on open (the mount fetch above
// can be minutes old). Clicking a card switches to that account.
function AccountsRollup({ onClose, onPick, selected }: {
  onClose: () => void; onPick: (hash: string) => void; selected: string;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/accounts`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.error) setErr(j.error);
        else setAccounts(j.accounts ?? []);
      })
      .catch(() => setErr("Couldn't load accounts — network error."));
  }, []);

  const sum = (f: (a: Account) => number | null) =>
    (accounts ?? []).reduce((t, a) => t + (f(a) ?? 0), 0);
  const totalValue = sum((a) => a.liquidation_value);
  const totalDay = sum((a) => a.day_profit);
  const totalCash = sum((a) => a.cash);
  const totalPos = sum((a) => a.positions_count);

  return (
    <Modal labelledBy="rollup-title" onClose={onClose} width={560}>
      <div style={{ padding: 20 }}>
        <div id="rollup-title" style={RS.title}>All accounts</div>
        <p style={RS.sub}>Every account on this profile, straight from Schwab. Click one to switch to it.</p>
        {err ? (
          <p style={{ color: "var(--neg)", fontSize: "var(--fs-sm)" }}>{err}</p>
        ) : !accounts ? (
          <p style={RS.sub}>Loading…</p>
        ) : (
          <>
            <div style={RS.totals}>
              <Tot label="Combined value" value={usd(totalValue)} />
              <Tot label="Day profit" value={`${totalDay > 0 ? "+" : ""}${usd(totalDay)}`}
                color={totalDay > 0 ? "var(--pos)" : totalDay < 0 ? "var(--neg)" : undefined} />
              <Tot label="Cash" value={usd(totalCash)} />
              <Tot label="Positions" value={String(totalPos)} />
            </div>
            <div style={RS.cards}>
              {accounts.map((a) => (
                <button key={a.hash} className="panel" style={{ ...RS.card, ...(a.hash === selected ? RS.cardActive : null) }}
                  onClick={() => onPick(a.hash)}
                  title={a.hash === selected ? "This is the selected account" : `Switch to ${a.mask}`}>
                  <div style={RS.cardHead}>
                    <b>{a.mask}</b>
                    <span style={RS.cardType}>{a.type ?? "?"}{a.tradable ? "" : " · restricted"}</span>
                    {a.hash === selected && <span className="tag" style={RS.activeTag}>selected</span>}
                  </div>
                  <div style={RS.cardRow}><span>Value</span><b>{usd(a.liquidation_value)}</b></div>
                  <div style={RS.cardRow}><span>Day profit</span>
                    <b style={{ color: (a.day_profit ?? 0) > 0 ? "var(--pos)" : (a.day_profit ?? 0) < 0 ? "var(--neg)" : undefined }}>
                      {a.day_profit != null ? `${a.day_profit > 0 ? "+" : ""}${usd(a.day_profit)}` : "—"}
                    </b>
                  </div>
                  <div style={RS.cardRow}><span>Cash</span><b>{usd(a.cash)}</b></div>
                  <div style={RS.cardRow}><span>Positions</span><b>{a.positions_count ?? "—"}</b></div>
                </button>
              ))}
            </div>
            <p style={RS.note}>Read-only overview — orders always go to the selected, trading-enabled account.</p>
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

function Tot({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={RS.tot}>
      <div style={RS.totLabel}>{label}</div>
      <div style={{ ...RS.totValue, color }}>{value}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", alignItems: "center", gap: 8 },
  label: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-faint)" },
  meta: { fontSize: "var(--fs-xs)", color: "var(--text-faint)" },
};

const RS: Record<string, React.CSSProperties> = {
  title: { fontSize: "var(--fs-lg)", fontWeight: 600 },
  sub: { color: "var(--text-dim)", fontSize: "var(--fs-sm)", margin: "6px 0 12px", lineHeight: 1.45 },
  totals: { display: "flex", gap: 18, padding: "10px 12px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", marginBottom: 12, flexWrap: "wrap" },
  tot: { minWidth: 90 },
  totLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-faint)" },
  totValue: { fontSize: "var(--fs-md)", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 },
  card: { textAlign: "left", padding: "12px 14px", cursor: "pointer", font: "inherit", color: "inherit", display: "flex", flexDirection: "column", gap: 5 },
  cardActive: { borderColor: "var(--accent)" },
  cardHead: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 },
  cardType: { fontSize: "var(--fs-xs)", color: "var(--text-dim)" },
  activeTag: { color: "var(--accent-quiet)", border: "1px solid var(--border-strong)", marginLeft: "auto" },
  cardRow: { display: "flex", justifyContent: "space-between", fontSize: "var(--fs-sm)", color: "var(--text-muted)" },
  note: { fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginTop: 10 },
};
