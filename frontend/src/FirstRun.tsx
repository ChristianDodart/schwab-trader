import { useCallback, useEffect, useState } from "react";
import { ReauthButton } from "./Reauth";
import { API } from "./api";

// First-run setup guide: a fresh install lands in an empty demo dashboard with no
// hint of what to do — this card walks a new user (the "my dad" persona) through
// the four steps to a fully working app, checking each off from LIVE state:
//   1. Connect Schwab        (auth/status: authorized + not expired)
//   2. Choose your account   (an account selected + trading enabled)
//   3. Import your history   (fill ledger has rows — the one-file CSV import)
//   4. Review your rules     (strategy customized, or explicitly accepted defaults)
// Hidden once everything is done or when dismissed (localStorage); Settings can
// bring it back. Polls gently while visible so steps tick off as you complete them.

const DISMISS_KEY = "firstrun_dismissed_v1";
const RULES_OK_KEY = "firstrun_rules_ok_v1";

type Steps = {
  connected: boolean;
  account: boolean;
  history: boolean;
  rules: boolean;
};

export function firstRunDismissed(): boolean {
  try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

export function resetFirstRun(): void {
  try { localStorage.removeItem(DISMISS_KEY); localStorage.removeItem(RULES_OK_KEY); } catch { /* ignore */ }
}

export function FirstRun({ nav }: { nav: (view: string) => void }) {
  const [steps, setSteps] = useState<Steps | null>(null);
  const [gone, setGone] = useState(firstRunDismissed());

  const load = useCallback(() => {
    Promise.all([
      fetch(`${API}/auth/status`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/accounts`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/config`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/data/health`).then((r) => r.json()).catch(() => null),
    ]).then(([auth, acc, cfg, health]) => {
      let rulesOk = false;
      try { rulesOk = localStorage.getItem(RULES_OK_KEY) === "1"; } catch { /* ignore */ }
      setSteps({
        connected: !!(auth?.authorized && !auth?.expired),
        account: !!(acc?.selected_hash && cfg?.trading_enabled),
        history: (health?.fill_ledger?.total ?? 0) > 0,
        rules: rulesOk || cfg?.strategy_is_default === false,
      });
    });
  }, []);

  useEffect(() => {
    if (gone) return;
    load();
    const t = setInterval(load, 30_000);   // steps tick off as the user completes them
    return () => clearInterval(t);
  }, [load, gone]);

  if (gone || !steps) return null;
  const all = steps.connected && steps.account && steps.history && steps.rules;
  if (all) return null;   // everything done — the guide retires itself

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setGone(true);
  };
  const acceptDefaults = () => {
    try { localStorage.setItem(RULES_OK_KEY, "1"); } catch { /* ignore */ }
    setSteps((s) => (s ? { ...s, rules: true } : s));
  };

  const done = [steps.connected, steps.account, steps.history, steps.rules].filter(Boolean).length;

  return (
    <section className="panel" style={S.card} aria-label="Setup guide">
      <div style={S.head}>
        <div>
          <div style={S.title}>Set up Schwab Trader</div>
          <div style={S.sub}>{done} of 4 done — each step is one click, and nothing here places a trade.</div>
        </div>
        <button className="btn btn-ghost btn-sm" title="Hide this guide (Settings can bring it back)" onClick={dismiss}>dismiss</button>
      </div>

      <ol style={S.list}>
        <Step n={1} done={steps.connected} title="Connect Schwab"
          desc="Sign in once — the app then pulls your live positions, prices, and recent trades automatically.">
          {!steps.connected && <ReauthButton label="Connect Schwab" onComplete={load} />}
        </Step>
        <Step n={2} done={steps.account} title="Choose your trading account"
          desc="Pick the account on the Profile tab, then turn on 'Trading enabled' under Settings — orders are off until you do.">
          {!steps.account && <button className="btn btn-secondary btn-sm" onClick={() => nav("profile")}>Open Profile</button>}
        </Step>
        <Step n={3} done={steps.history} title="Import your history"
          desc="One CSV brings in years of trades, deposits, and dividends (Schwab.com: Accounts, History, Export). Re-importing is always safe.">
          {!steps.history && <button className="btn btn-secondary btn-sm" onClick={() => nav("settings")}>Import CSV</button>}
        </Step>
        <Step n={4} done={steps.rules} title="Review your rules"
          desc="The ladder ships with sensible defaults (buy deeper dips, sell at +$50 per lot). Keep them or tune them under Rules.">
          {!steps.rules && (
            <span style={{ display: "inline-flex", gap: 6 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => nav("rules")}>See the rules</button>
              <button className="btn btn-ghost btn-sm" onClick={acceptDefaults}>Defaults are fine</button>
            </span>
          )}
        </Step>
      </ol>
    </section>
  );
}

function Step({ n, done, title, desc, children }: {
  n: number; done: boolean; title: string; desc: string; children?: React.ReactNode;
}) {
  return (
    <li style={S.step}>
      <span style={{ ...S.badge, ...(done ? S.badgeDone : null) }} aria-hidden="true">{done ? "✓" : n}</span>
      <div style={{ flex: 1 }}>
        <div style={{ ...S.stepTitle, ...(done ? { color: "var(--text-dim)", textDecoration: "line-through" } : null) }}>{title}</div>
        {!done && <div style={S.stepDesc}>{desc}</div>}
      </div>
      {!done && <span style={{ flexShrink: 0 }}>{children}</span>}
    </li>
  );
}

const S: Record<string, React.CSSProperties> = {
  card: { padding: "16px 18px", margin: "14px 0", borderColor: "var(--accent)" },
  head: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 },
  title: { fontSize: "var(--fs-lg)", fontWeight: 700 },
  sub: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", marginTop: 2 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 },
  step: { display: "flex", alignItems: "center", gap: 12 },
  badge: { width: 22, height: 22, minWidth: 22, borderRadius: "50%", display: "inline-flex", alignItems: "center",
    justifyContent: "center", fontSize: "var(--fs-xs)", fontWeight: 700, color: "var(--text-muted)",
    border: "1px solid var(--border-strong)" },
  badgeDone: { color: "#0b0e13", background: "var(--pos)", borderColor: "var(--pos)" },
  stepTitle: { fontSize: "var(--fs-md)", fontWeight: 600 },
  stepDesc: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", marginTop: 2, lineHeight: 1.45 },
};
