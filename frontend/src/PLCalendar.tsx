import { useEffect, useMemo, useState } from "react";
import { usd } from "./App";
import { Panel, moneyColor } from "./LedgerUI";
import type { LedgerActivity as Activity } from "./types";
import { API } from "./api";
import { IconChevronLeft, IconChevronRight } from "./Icon";

// Month-grid heatmap of realized profit per day (W26-1). Data is the same
// day-grain activity the table uses; each cell's tint scales with that day's
// profit relative to the month's biggest day. Click a traded day to jump to
// the Trades journal filtered to it.

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DayCell = { iso: string; profit: number; bought: number; sold: number; sells: number };

const pad = (n: number) => String(n).padStart(2, "0");

export function PLCalendar({ onDayClick }: { onDayClick?: (iso: string) => void }) {
  const now = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() }); // m 0-based
  const [days, setDays] = useState<Record<string, DayCell> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const first = `${ym.y}-${pad(ym.m + 1)}-01`;
  const lastDay = new Date(ym.y, ym.m + 1, 0).getDate();
  const last = `${ym.y}-${pad(ym.m + 1)}-${pad(lastDay)}`;

  useEffect(() => {
    let alive = true;
    setDays(null);
    fetch(`${API}/ledger/activity?grain=day&start=${first}&end=${last}`)
      .then((r) => r.json())
      .then((j: Activity) => {
        if (!alive) return;
        const map: Record<string, DayCell> = {};
        for (const r of j.rows ?? []) {
          map[r.period] = { iso: r.period, profit: r.profit, bought: r.bought, sold: r.sold, sells: r.sell_count };
        }
        setDays(map);
        setErr(null);
      })
      .catch(() => { if (alive) setErr("Couldn't load the month — network error."); });
    return () => { alive = false; };
  }, [first, last]);

  // Monday-first grid: leading blanks for the 1st's weekday, then every day of the month.
  const cells = useMemo(() => {
    const lead = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7; // Mon=0 … Sun=6
    const list: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= lastDay; d++) list.push(`${ym.y}-${pad(ym.m + 1)}-${pad(d)}`);
    return list;
  }, [ym, lastDay]);

  const maxAbs = Math.max(1, ...Object.values(days ?? {}).map((c) => Math.abs(c.profit)));
  const monthTotal = Object.values(days ?? {}).reduce((t, c) => t + c.profit, 0);
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const shift = (delta: number) =>
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const atCurrentMonth = ym.y === now.getFullYear() && ym.m === now.getMonth();

  return (
    <Panel
      title="Profit calendar"
      right={
        <span style={C.nav}>
          <span style={{ ...C.monthTotal, color: moneyColor(monthTotal) }}>
            {monthTotal !== 0 ? `${monthTotal > 0 ? "+" : ""}${usd(Math.round(monthTotal))}` : ""}
          </span>
          <button className="btn btn-secondary btn-sm" aria-label="Previous month" onClick={() => shift(-1)}><IconChevronLeft /></button>
          <b style={C.monthLabel}>{MONTHS[ym.m]} {ym.y}</b>
          <button className="btn btn-secondary btn-sm" aria-label="Next month" onClick={() => shift(1)}
            disabled={atCurrentMonth} title={atCurrentMonth ? "Already at the current month" : undefined}><IconChevronRight /></button>
        </span>
      }
    >
      {err ? (
        <p style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>{err}</p>
      ) : (
        <div style={C.grid} role="grid" aria-label={`Realized profit by day, ${MONTHS[ym.m]} ${ym.y}`}>
          {DOW.map((d) => <div key={d} style={C.dow}>{d}</div>)}
          {cells.map((iso, i) => {
            if (!iso) return <div key={`b${i}`} />;
            const c = days?.[iso];
            const p = c?.profit ?? 0;
            const traded = !!c && (c.sells > 0 || c.bought > 0 || p !== 0);
            const alpha = c ? Math.min(0.85, 0.12 + 0.73 * (Math.abs(p) / maxAbs)) : 0;
            // Alpha tints of the live theme's --pos / --neg (color-mix keeps it themeable).
            const pct = (alpha * 100).toFixed(0);
            const bg = !c || p === 0 ? "var(--panel-2)"
              : p > 0 ? `color-mix(in srgb, var(--pos) ${pct}%, transparent)`
              : `color-mix(in srgb, var(--neg) ${pct}%, transparent)`;
            const tip = c
              ? `${iso} — profit ${p > 0 ? "+" : ""}${usd(p)} · bought ${usd(c.bought)} · sold ${usd(c.sold)}`
              : `${iso} — no recorded trades`;
            const clickable = traded && !!onDayClick;
            return (
              <button
                key={iso}
                style={{ ...C.cell, background: bg,
                  outline: iso === todayIso ? "1px solid var(--accent)" : undefined,
                  cursor: clickable ? "pointer" : "default" }}
                title={clickable ? `${tip} — click for that day's trades` : tip}
                aria-label={tip}
                onClick={() => clickable && onDayClick!(iso)}
                tabIndex={clickable ? 0 : -1}
              >
                <span style={C.dayNum}>{Number(iso.slice(8))}</span>
                {c && p !== 0 && (
                  <span style={C.amt}>{p > 0 ? "+" : "−"}{Math.abs(p) >= 1000 ? `${(Math.abs(p) / 1000).toFixed(1)}k` : Math.abs(p).toFixed(0)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <p style={C.fine}>Realized profit booked per day. Deeper green or red = a bigger day for this month. Click a traded day to see its closed trades.</p>
    </Panel>
  );
}

const C: Record<string, React.CSSProperties> = {
  nav: { display: "inline-flex", alignItems: "center", gap: 8 },
  monthLabel: { fontSize: "var(--fs-sm)", minWidth: 110, textAlign: "center" },
  monthTotal: { fontSize: "var(--fs-sm)", fontWeight: 700, fontVariantNumeric: "tabular-nums", marginRight: 4 },
  grid: { display: "grid", gridTemplateColumns: "repeat(7, minmax(34px, 1fr))", gap: 4, maxWidth: 560 },
  dow: { fontSize: "var(--fs-2xs)", color: "var(--text-faint)", textAlign: "center", textTransform: "uppercase", letterSpacing: 0.5 },
  cell: { position: "relative", aspectRatio: "1.15", border: "1px solid var(--border)", borderRadius: "var(--r-sm)",
    display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between",
    padding: "3px 5px", font: "inherit", color: "var(--text)", minHeight: 40 },
  dayNum: { fontSize: "var(--fs-2xs)", color: "var(--text-dim)", lineHeight: 1 },
  amt: { fontSize: "var(--fs-2xs)", fontWeight: 700, fontVariantNumeric: "tabular-nums", alignSelf: "flex-end", lineHeight: 1 },
  fine: { fontSize: "var(--fs-xs)", color: "var(--text-faint)", margin: "10px 0 0" },
};
