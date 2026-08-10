import { useEffect, useState } from "react";
import { usd, pct } from "./format";
import { API } from "./api";
import { IconWarning } from "./Icon";

// ============================================================================
// Method tab — read-only risk lenses over your ladder method and current book.
// ADVISORY ONLY: nothing here places orders or says what to buy/sell. It makes the
// tail the ladder walks into visible (true single-name exposure, downside stress,
// names that have fallen past the plan, and whether the fixed $ tiers fit your edge).
// ============================================================================

type ConcRow = { key: string; symbols: string[]; value: number; pct: number; over_cap: boolean; hidden: boolean };
type Scenario = { drop: number; value: number; unrealized: number };
type StressPos = { symbol: string; lots_deep: number; over_depth: boolean; invested: number; value_now: number; unrealized_now: number; scenarios: Scenario[] };
type Break = { symbol: string; lots_deep: number; reasons: { code: string; text: string; value: number }[] };
type Kelly = { enough: boolean; trades: number; min_trades?: number; win_rate?: number; payoff_ratio?: number; kelly_fraction?: number; half_kelly_fraction?: number; kelly_dollars?: number; half_kelly_dollars?: number; current_tiers?: number[]; account_value?: number };
type Analysis = {
  as_of: string; held_count: number;
  concentration: { cap: number; rows: ConcRow[] };
  stress: { drops: number[]; positions: StressPos[]; portfolio: { invested: number; value_now: number; scenarios: Scenario[] } };
  thesis_breaks: Break[];
  kelly: Kelly;
};

const S: Record<string, React.CSSProperties> = {
  wrap: { display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 },
  card: { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px" },
  h: { margin: "0 0 4px", fontSize: "var(--fs-md)", fontWeight: 700 },
  sub: { margin: "0 0 12px", color: "var(--text-dim)", fontSize: "var(--fs-sm)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-sm)" },
  th: { textAlign: "right", padding: "4px 8px", color: "var(--text-dim)", fontWeight: 600, borderBottom: "1px solid var(--border)" },
  thL: { textAlign: "left", padding: "4px 8px", color: "var(--text-dim)", fontWeight: 600, borderBottom: "1px solid var(--border)" },
  td: { textAlign: "right", padding: "4px 8px", borderBottom: "1px solid var(--border-faint)" },
  tdL: { textAlign: "left", padding: "4px 8px", borderBottom: "1px solid var(--border-faint)" },
  badge: { fontSize: "var(--fs-2xs)", padding: "1px 6px", borderRadius: 6, marginLeft: 6, background: "var(--warn-bg)", color: "var(--warn)" },
  note: { color: "var(--text-faint)", fontSize: "var(--fs-2xs)", marginTop: 10 },
};

const neg = (n: number): React.CSSProperties => ({ color: n < 0 ? "var(--neg)" : n > 0 ? "var(--pos)" : "var(--text-dim)" });
const dropLabel = (d: number) => `−${Math.round(d * 100)}%`;

export function Method() {
  const [a, setA] = useState<Analysis | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/strategy-analysis`)
      .then((r) => r.json())
      .then((j) => { if (alive) setA(j as Analysis); })
      .catch(() => { if (alive) setErr("Couldn't load method analysis."); });
    return () => { alive = false; };
  }, []);

  if (err) return <p style={{ color: "var(--neg)" }}>{err}</p>;
  if (!a) return <p style={{ color: "var(--text-dim)" }}>Analyzing your book…</p>;
  if (a.held_count === 0)
    return <p style={{ color: "var(--text-dim)" }}>No open positions to analyze yet. The Method tab lenses your live book — come back once you're holding something.</p>;

  const cap = a.concentration.cap;
  const capDollars = a.kelly.enough ? (a.kelly.account_value ?? 0) * cap : null;

  return (
    <div style={S.wrap}>
      <p style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)", margin: 0 }}>
        Read-only risk lenses on your ladder method and current book, as of {a.as_of}. <b>Advisory only</b> —
        nothing here places an order or tells you what to buy or sell.
      </p>

      {/* 1) Concentration by true underlying */}
      <section style={S.card}>
        <h3 style={S.h}>Concentration by underlying</h3>
        <p style={S.sub}>
          A stock and any leveraged/inverse ETFs tied to it are one bet. Rolled up, here's your true
          single-name exposure vs the {pct(cap)} cap. A “hidden” flag means the combined position breaches
          the cap even though no single ticker does.
        </p>
        <table style={S.table}>
          <thead><tr>
            <th style={S.thL}>Underlying</th><th style={S.thL}>Tickers</th>
            <th style={S.th}>Exposure</th><th style={S.th}>% of book</th>
          </tr></thead>
          <tbody>
            {a.concentration.rows.map((r) => (
              <tr key={r.key}>
                <td style={S.tdL}><b>{r.key}</b></td>
                <td style={S.tdL}>{r.symbols.join(", ")}</td>
                <td style={S.td}>{usd(r.value)}</td>
                <td style={{ ...S.td, ...(r.over_cap ? { color: "var(--warn)", fontWeight: 700 } : {}) }}>
                  {pct(r.pct)}
                  {r.over_cap && <span style={S.badge}>{r.hidden ? "hidden — over cap combined" : "over cap"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 2) Downside / ladder-depth stress */}
      <section style={S.card}>
        <h3 style={S.h}>Downside stress</h3>
        <p style={S.sub}>
          What a further drop does to the book — the tail the “add more as it falls” ladder walks into.
          Unrealized shown at each drop from today's prices.
        </p>
        <table style={S.table}>
          <thead><tr>
            <th style={S.thL}>Symbol</th><th style={S.th}>Lots</th><th style={S.th}>Value now</th>
            {a.stress.drops.map((d) => <th key={d} style={S.th}>{dropLabel(d)}</th>)}
          </tr></thead>
          <tbody>
            <tr>
              <td style={S.tdL}><b>Whole book</b></td>
              <td style={S.td}>—</td>
              <td style={S.td}><b>{usd(a.stress.portfolio.value_now)}</b></td>
              {a.stress.portfolio.scenarios.map((sc) => (
                <td key={sc.drop} style={{ ...S.td, ...neg(sc.unrealized) }}>{usd(sc.unrealized)}</td>
              ))}
            </tr>
            {a.stress.positions.map((p) => (
              <tr key={p.symbol}>
                <td style={S.tdL}>{p.symbol}</td>
                <td style={{ ...S.td, ...(p.over_depth ? { color: "var(--warn)", fontWeight: 700 } : {}) }}>
                  {p.lots_deep}{p.over_depth && <span style={S.badge}>deep</span>}
                </td>
                <td style={S.td}>{usd(p.value_now)}</td>
                {p.scenarios.map((sc) => (
                  <td key={sc.drop} style={{ ...S.td, ...neg(sc.unrealized) }}>{usd(sc.unrealized)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p style={S.note}>“Lots” is how many rungs deep you are; “deep” flags names past your ~6-lot target.</p>
      </section>

      {/* 3) Thesis-break flags */}
      <section style={S.card}>
        <h3 style={S.h}>Thesis-break watch</h3>
        <p style={S.sub}>
          Names behaving like a broken thesis the ladder would just keep buying. These are warnings to
          <i> look</i>, not sell signals — the method has no stop, so this is where you'd decide to stop adding.
        </p>
        {a.thesis_breaks.length === 0 ? (
          <p style={{ color: "var(--pos)", fontSize: "var(--fs-sm)", margin: 0 }}>Nothing tripping the checks — no name is deep underwater, stale, or past the ladder.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--fs-sm)" }}>
            {a.thesis_breaks.map((b) => (
              <li key={b.symbol} style={{ marginBottom: 6 }}>
                <b style={{ color: "var(--warn)" }}><IconWarning size={12} /> {b.symbol}</b>
                <span style={{ color: "var(--text-faint)" }}> · {b.lots_deep} lots</span>
                <span style={{ color: "var(--text-dim)" }}> — {b.reasons.map((r) => r.text).join("; ")}.</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4) Sizing sanity check (Kelly reference) */}
      <section style={S.card}>
        <h3 style={S.h}>Sizing check</h3>
        <p style={S.sub}>
          A reference from your own realized record — not advice. The Kelly criterion turns your win rate and
          average win/loss into a fraction of the book to risk per name. Half-Kelly is the usual practical cap.
        </p>
        {!a.kelly.enough ? (
          <p style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)", margin: 0 }}>
            Need {a.kelly.min_trades} closed trades for a stable read — you have {a.kelly.trades}.
          </p>
        ) : (
          <>
            <table style={S.table}>
              <tbody>
                <tr><td style={S.tdL}>Win rate</td><td style={S.td}>{pct(a.kelly.win_rate!)}</td></tr>
                <tr><td style={S.tdL}>Payoff (avg win ÷ avg loss)</td><td style={S.td}>{a.kelly.payoff_ratio}×</td></tr>
                <tr><td style={S.tdL}>Kelly / half-Kelly per name</td><td style={S.td}>{pct(a.kelly.kelly_fraction!)} / {pct(a.kelly.half_kelly_fraction!)}</td></tr>
                <tr><td style={S.tdL}>Half-Kelly dollars per name</td><td style={S.td}><b>{usd(a.kelly.half_kelly_dollars!)}</b></td></tr>
                <tr><td style={S.tdL}>Your single-name cap ({pct(cap)} of book)</td><td style={S.td}>{capDollars != null ? usd(capDollars) : "—"}</td></tr>
                <tr><td style={S.tdL}>Your sizing tiers (per lot)</td><td style={S.td}>{(a.kelly.current_tiers ?? []).map((t) => usd(t)).join(" / ")}</td></tr>
              </tbody>
            </table>
            <p style={S.note}>
              {a.kelly.kelly_fraction === 0
                ? "Your realized record shows no positive edge yet, so Kelly implies minimal sizing — treat current sizes as speculative until the record turns."
                : capDollars != null && a.kelly.half_kelly_dollars! < capDollars
                  ? "Your 5% cap lets a fully-laddered name exceed what half-Kelly would risk — the ladder can commit more per name than your edge supports. Worth knowing."
                  : "Your cap sits within half-Kelly — sizing looks conservative relative to your realized edge."}
              {" "}Book value used as the base: {usd(a.kelly.account_value ?? 0)}.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
