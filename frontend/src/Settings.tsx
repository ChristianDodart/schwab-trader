// Settings orchestrator (split in W27-4): owns the account config state + dirty
// tracking and composes the section components that live in src/settings/.
import { useEffect, useState } from "react";
import { ConnectionStatus } from "./Reauth";
import { useToast } from "./Toast";
import { API } from "./api";

import { AccountSection } from "./settings/AccountSection";
import { Appearance } from "./settings/Appearance";
import { Backups } from "./settings/Backups";
import { BenchmarkPicker } from "./settings/BenchmarkPicker";
import { DataHealth } from "./settings/DataHealth";
import { Diagnostics } from "./settings/Diagnostics";
import { FmpKey } from "./settings/FmpKey";
import { SchwabCreds } from "./settings/SchwabCreds";
import { SetupGuideReset } from "./settings/SetupGuideReset";
import { TaxSection } from "./settings/TaxSection";
import { WhatsNew } from "./settings/WhatsNew";

type Config = {
  account_hash: string;
  trading_enabled: boolean;
  tax_filing: string;
  tax_state_rate: number;
};

export function Settings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  const [c, setC] = useState<Config | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetch(`${API}/config`).then((r) => r.json()).then(setC).catch(() => {});
  }, []);

  // Publish dirty state to the parent (App guards tab/account switches on it);
  // clear it on unmount so a stale flag can't block navigation later.
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty]);
  useEffect(() => () => onDirtyChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Warn on browser close/refresh while there are unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!c) return <p style={S.note}>Loading settings…</p>;
  const set = (patch: Partial<Config>) => { setC({ ...c, ...patch }); setSaved(false); setDirty(true); };

  const save = () => {
    fetch(`${API}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trading_enabled: c.trading_enabled,
        tax_filing: c.tax_filing,
        tax_state_rate: c.tax_state_rate,
      }),
    })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => {
        if (!j || j.error) throw new Error("bad response");
        setC(j); setSaved(true); setDirty(false);
      })
      .catch(() => toast("Couldn't save settings — check the values and try again.", "error"));
  };

  return (
    <div style={S.wrap}>
      <p style={S.scope}>
        Account settings for the selected account. Your buy/sell rules now live in the
        {" "}<b>Rules</b> tab. Tip: press <kbd style={{ fontFamily: "monospace", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)", padding: "0 5px" }}>?</kbd> anywhere for keyboard shortcuts.
      </p>

      <Section title="Appearance" info="Pick a color theme for the app. Themes change color only — layout, spacing, and motion are identical across all of them, and every theme meets WCAG AA contrast. 'Follow system' tracks your OS light/dark setting; an explicit pick always wins. Your choice is saved on this install and applies before the window even paints.">
        <Appearance />
      </Section>

      <Section title="Schwab API credentials" info="Your Schwab developer-app key + secret (from developer.schwab.com) and callback URL. Stored on THIS install (overrides .env), so each person/install uses their own app. Set these first, then connect each profile under Schwab connection.">
        <SchwabCreds />
      </Section>

      <Section title="Schwab connection" info="Schwab's refresh token expires every 7 days. Re-authorize the ACTIVE profile here to keep its live feed and trading working — no terminal needed.">
        <ConnectionStatus />
      </Section>

      <Section title="Company data (Financial Modeling Prep)" info="Optional free API key from financialmodelingprep.com. Schwab has no sector/industry/country data, so this auto-tags your tickers — making the Screener's sector-exclusion and country guardrails work automatically. Free tier covers this; the whole-market screener is paywalled.">
        <FmpKey />
      </Section>

      <Section title="Account" info="Controls whether this account may place orders. The managed (LLC) account stays off; enable only the account you actually trade through the API.">
        <AccountSection enabled={c.trading_enabled} onChange={(v) => set({ trading_enabled: v })} />
      </Section>

      <Section title="Taxes" info="Used to estimate taxes on the Ledger. Filing status picks the federal bracket table; state rate is your flat state income-tax rate (day-trade gains are short-term = ordinary income).">
        <TaxSection filing={c.tax_filing} stateRate={c.tax_state_rate} onChange={set} />
      </Section>

      <Section title="Benchmark" info="The buy-and-hold yardstick for the Ledger's 'If it were all …' comparison — what your exact deposits would be worth in this ticker instead of actively traded.">
        <BenchmarkPicker />
      </Section>

      <Section title="Data health & import" info="The app rebuilds your ladder and realized history from a durable fill ledger: recent trades sync from Schwab automatically, and one Transactions CSV export backfills years of history in a single upload (trades, deposits, and dividends are all routed from the same file). Re-importing is always safe — nothing double-counts.">
        <DataHealth />
      </Section>

      <Section title="Data & backups" info="Your entire trading history lives in one local database file. The app backs it up automatically on startup and daily (keeping the newest 14), using a method that's safe while the app is running. Backups exclude the Schwab connection — after restoring, just reconnect.">
        <Backups />
      </Section>

      <Section title="What's new" info="Patch notes for your current version. The same notes appear in the update banner when a new version is ready.">
        <WhatsNew />
      </Section>

      <Section title="Setup guide" info="The step-by-step checklist shown on the dashboard of a fresh install (connect, pick an account, import history, review rules). Bring it back any time.">
        <SetupGuideReset />
      </Section>

      <Section title="About & diagnostics" info="Build version + a live health snapshot. Use “Copy diagnostics” to paste the whole picture into a support message.">
        <Diagnostics />
      </Section>

      <div style={S.actions}>
        <button className="btn btn-primary" onClick={save}>Save settings</button>
        <span aria-live="polite">
          {dirty ? (
            <span style={S.dirtyMsg}>● Unsaved changes</span>
          ) : saved ? (
            <span style={S.savedMsg}>✓ Saved</span>
          ) : null}
        </span>
      </div>
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

const S: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 16, maxWidth: 560 },
  scope: { color: "var(--text-dim)", fontSize: "var(--fs-sm)", marginBottom: 8 },
  section: { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: 16, marginTop: 12 },
  h3: { margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 },
  infoIcon: { fontSize: "var(--fs-2xs)", color: "var(--accent-quiet)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-pill)", padding: "0 5px", cursor: "help", textTransform: "none", letterSpacing: 0 },
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 16 },
  savedMsg: { color: "var(--pos)", fontSize: "var(--fs-md)" },
  dirtyMsg: { color: "var(--warn)", fontSize: "var(--fs-sm)", fontWeight: 600 },
  note: { color: "var(--text-faint)", fontSize: "var(--fs-sm)", marginTop: 16 },
};
