// The Profile tab: one calm place to see who you're trading as and which account is
// active, switch either, and connect a profile — moved out of the cluttered sub-bar
// (field feedback: too much crammed above the table). The sub-bar keeps only a small
// read-only ContextChip that jumps here.
import { useEffect, useState } from "react";
import { AccountPicker } from "./AccountPicker";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { ConnectionStatus } from "./Reauth";
import { API } from "./api";

export function ProfilePanel({ acctKey, onAccountChange }: {
  acctKey: string;
  onAccountChange: (hash: string) => void;
}) {
  return (
    <div style={S.wrap}>
      <p style={S.scope}>
        Choose who you're trading as and which of that login's accounts is active. Orders
        always route to the selected, trading-enabled account.
      </p>

      <Section title="Trading profile"
        info="A profile is one Schwab login (e.g. Christian, Dave). Each keeps its own connection, accounts, and layout. Switching reloads the app under that login.">
        <ProfileSwitcher />
        <p style={S.help}>
          Switching reloads the app with that profile's Schwab login, accounts, and layout.
          A new profile starts disconnected — add it here, then connect it just below.
        </p>
      </Section>

      <Section title="Account"
        info="Every account this profile's Schwab login can see. Pick the one to trade and view; 'All accounts' shows each one's value, day profit, cash, and positions.">
        <AccountPicker value={acctKey} onAccountChange={onAccountChange} />
      </Section>

      <Section title="Schwab connection"
        info="Schwab's refresh token expires every 7 days. Re-authorize the active profile here to keep its live feed and trading working — no terminal needed.">
        <ConnectionStatus />
      </Section>
    </div>
  );
}

function Section({ title, info, children }: { title: string; info?: string; children: React.ReactNode }) {
  return (
    <section style={S.section}>
      <h3 className="section-title" style={S.h3}>
        {title}
        {info && <span style={S.infoIcon} title={info}>(i)</span>}
      </h3>
      {children}
    </section>
  );
}

// Compact, read-only "who + which account" indicator for the sub-bar. Fetches its own
// data so App stays lean; the whole chip is a button that jumps to the Profile tab.
type Prof = { name: string; active: boolean; connected: boolean; status: { authorized: boolean } };
type Acct = { hash: string; mask: string; type: string | null };
export function ContextChip({ acctKey, onOpen }: { acctKey: string; onOpen: () => void }) {
  const [prof, setProf] = useState<Prof | null>(null);
  const [accts, setAccts] = useState<Acct[]>([]);
  const [selHash, setSelHash] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/profiles`).then((r) => r.json())
      .then((d) => { if (Array.isArray(d?.profiles)) setProf(d.profiles.find((p: Prof) => p.active) ?? null); })
      .catch(() => {});
  }, []);
  // Re-read accounts whenever the active account changes so the mask stays in sync.
  useEffect(() => {
    fetch(`${API}/accounts`).then((r) => r.json())
      .then((j) => { setAccts(j.accounts ?? []); setSelHash(j.selected_hash ?? null); })
      .catch(() => {});
  }, [acctKey]);

  const cur = acctKey || selHash || "";
  const acct = accts.find((a) => a.hash === cur);
  const dot = prof
    ? (prof.connected && prof.status?.authorized ? "var(--pos)" : prof.connected ? "var(--warn)" : "var(--text-faint)")
    : "var(--text-faint)";

  return (
    <button className="btn btn-secondary btn-sm" style={S.chip} onClick={onOpen}
      title="Profile & account — click to switch or connect">
      <span style={{ ...S.dot, background: dot }} aria-hidden="true" />
      <span style={S.who}>{prof?.name ?? "Profile"}</span>
      <span style={S.sep} aria-hidden="true">·</span>
      <span style={S.acct}>{acct ? acct.mask : "No account"}</span>
    </button>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 16, maxWidth: 560 },
  scope: { color: "var(--text-dim)", fontSize: "var(--fs-sm)", marginBottom: 8, lineHeight: 1.5 },
  section: { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: 16, marginTop: 12 },
  h3: { margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 },
  infoIcon: { fontSize: "var(--fs-2xs)", color: "var(--accent-quiet)", border: "1px solid #3a4a5a", borderRadius: "var(--r-pill)", padding: "0 5px", cursor: "help", textTransform: "none", letterSpacing: 0 },
  help: { fontSize: "var(--fs-xs)", color: "var(--text-faint)", marginTop: 10, lineHeight: 1.5 },
  // ContextChip
  chip: { display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 260 },
  dot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  who: { fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 },
  sep: { opacity: 0.5 },
  acct: { color: "var(--text-muted)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 110 },
};
