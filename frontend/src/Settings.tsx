// Settings page: composes the self-saving section cards in src/settings/. Each card
// persists its own change (theme, tray, Schwab creds/connection, backups), so this page
// has no page-level Save and is never "dirty".
import { useEffect } from "react";
import { ConnectionStatus } from "./Reauth";
import { Tip } from "./Tip";
import { Appearance } from "./settings/Appearance";
import { Backups } from "./settings/Backups";
import { DataHealth } from "./settings/DataHealth";
import { DesktopSection } from "./settings/DesktopSection";
import { Diagnostics } from "./settings/Diagnostics";
import { SchwabCreds } from "./settings/SchwabCreds";
import { WhatsNew } from "./settings/WhatsNew";

export function Settings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  // Every card self-saves, so this page is never dirty — report clean once for App's guard.
  useEffect(() => { onDirtyChange?.(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card-grid">
      <p style={S.scope}>
        Account settings for the selected account. Your buy/sell rules now live in the
        {" "}<b>Rules</b> tab. Tip: press <kbd style={{ fontFamily: "monospace", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)", padding: "0 5px" }}>?</kbd> anywhere for keyboard shortcuts.
      </p>

      <Section title="Appearance" info="Pick a color theme for the app. Themes change color only — layout, spacing, and motion are identical across all of them, and every theme meets WCAG AA contrast. 'Follow system' tracks your OS light/dark setting; an explicit pick always wins. Your choice is saved on this install and applies before the window even paints.">
        <Appearance />
        {window.desktop?.isDesktop && <DesktopSection />}
      </Section>

      <Section title="Schwab" info="Your Schwab developer app key/secret + callback URL (stored on this install), and the connection to the ACTIVE profile. Re-authorize weekly to keep the live feed and trading working.">
        <SchwabCreds />
        <div style={{ height: 1, background: "var(--border)", margin: "12px 0" }} />
        <ConnectionStatus />
      </Section>

      <Section title="Data health & import" info="The app rebuilds your ladder and realized history from a durable fill ledger: recent trades sync from Schwab automatically, and one Transactions CSV export backfills years of history in a single upload (trades, deposits, and dividends are all routed from the same file). Re-importing is always safe — nothing double-counts.">
        <DataHealth />
      </Section>

      <Section title="Data & backups" info="Your entire trading history lives in one local database file. The app backs it up automatically on startup and daily (keeping the newest 3), using a method that's safe while the app is running. Backups exclude the Schwab connection — after restoring, just reconnect.">
        <Backups />
      </Section>

      <Section title="What's new" info="Patch notes for your current version. The same notes appear in the update banner when a new version is ready.">
        <WhatsNew />
      </Section>

      <Section title="About & diagnostics" info="Build version + a live health snapshot. Use “Copy diagnostics” to paste the whole picture into a support message.">
        <Diagnostics />
      </Section>

    </div>
  );
}

function Section({ title, info, children }: { title: string; info?: string; children: React.ReactNode }) {
  return (
    <section style={S.section}>
      <h3 className="section-title" style={S.h3}>
        {title}
        {info && <Tip text={info}><span style={S.infoIcon}>(i)</span></Tip>}
      </h3>
      {children}
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, alignItems: "start" },
  scope: { color: "var(--text-dim)", fontSize: "var(--fs-sm)", marginBottom: 8, gridColumn: "1 / -1" },
  section: { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", padding: 16, marginTop: 12 },
  h3: { margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 },
  infoIcon: { fontSize: "var(--fs-2xs)", color: "var(--accent-quiet)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-pill)", padding: "0 5px", cursor: "help", textTransform: "none", letterSpacing: 0 },
  actions: { display: "flex", alignItems: "center", gap: 12, marginTop: 16, gridColumn: "1 / -1" },
  savedMsg: { color: "var(--pos)", fontSize: "var(--fs-md)" },
  dirtyMsg: { color: "var(--warn)", fontSize: "var(--fs-sm)", fontWeight: 600 },
  note: { color: "var(--text-faint)", fontSize: "var(--fs-sm)", marginTop: 16 },
};
