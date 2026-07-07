import { Fragment, useEffect, useState } from "react";
import { usd, pct } from "./App";
import { DASH_COLUMNS, PINNED_DASH, rowSignalChips, tickerRiskColor, RISK_LABEL } from "./columns";
import type { DashCol } from "./columns";
import type { DashboardRow } from "./types";
import type { SignalRule } from "./signals";
import { IconChildArrow, IconBell, IconClose } from "./Icon";

// Column sorting: click a header to sort by it (asc/desc toggle, third click clears
// back to the default order). Persisted per browser. Applied BEFORE nesting, so ETF
// children always travel with their parent. Nulls sink to the bottom; watch rows
// (mostly nulls) naturally follow the held rows.
type SortState = { id: string; dir: 1 | -1 } | null;
const SORT_LS = "dash_sort_v1";

function readSort(): SortState {
  try {
    const raw = localStorage.getItem(SORT_LS);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && typeof s.id === "string" && (s.dir === 1 || s.dir === -1) ? s : null;
  } catch { return null; }
}

function sortRows(rows: DashboardRow[], sort: SortState): DashboardRow[] {
  if (!sort) return rows;
  const val = (r: DashboardRow) => (r as unknown as Record<string, unknown>)[sort.id];
  return [...rows].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;                       // nulls last regardless of direction
    if (vb == null) return -1;
    if (typeof va === "string" || typeof vb === "string") {
      return String(va).localeCompare(String(vb)) * sort.dir;
    }
    return ((va as number) - (vb as number)) * sort.dir;
  });
}

// ETF grouping: order the rows so each linked leveraged ETF sits directly under its
// underlying stock (depth 1), and tell each parent how many children it has. A child
// whose parent isn't in this view stays at top level (depth 0).
type DispRow = { row: DashboardRow; depth: number; parent: DashboardRow | null; childCount: number };
function nestRows(rows: DashboardRow[]): DispRow[] {
  const bySym = new Map(rows.map((r) => [r.symbol, r]));
  const kids = new Map<string, DashboardRow[]>();
  for (const r of rows) {
    const u = r.underlying;
    if (u && u !== r.symbol && bySym.has(u)) {
      const arr = kids.get(u) ?? [];
      arr.push(r);
      kids.set(u, arr);
    }
  }
  const childSyms = new Set<string>();
  for (const arr of kids.values()) arr.forEach((k) => childSyms.add(k.symbol));
  const out: DispRow[] = [];
  for (const r of rows) {
    if (childSyms.has(r.symbol)) continue; // rendered under its parent instead
    const mine = kids.get(r.symbol) ?? [];
    out.push({ row: r, depth: 0, parent: null, childCount: mine.length });
    for (const k of mine) out.push({ row: k, depth: 1, parent: r, childCount: 0 });
  }
  return out;
}

// Column ids whose per-row values are money that's meaningful to SUM in a totals row.
// "signed" = a P/L figure (color + sign it); "plain" = a magnitude (Invested, Value).
// Everything else (prices, %s, per-share basis, counts) is intentionally omitted —
// a sum there is nonsense. Keyed by the row field, which equals the column id.
const MONEY_SUM: Record<string, "signed" | "plain"> = {
  invested: "plain",
  current_value: "plain",
  unrealized: "signed",
  day_change: "signed",
  last_pos_profit: "signed",
  year_profit: "signed",
  log_profit: "signed",
  dividends: "plain",
  total_return: "signed",
};

// Bulk selection state (harvest / buy-the-dip). When present, the table shows a
// checkbox column; only `candidates` are selectable, `checked` are selected.
export type BulkUI = {
  kind: "sell" | "buy" | "exit";
  candidates: Set<string>;
  checked: Set<string>;
  onToggle: (symbol: string) => void;
  allChecked: boolean;
  onToggleAll: () => void;
};

export function DashboardTable({
  rows,
  cols,
  selected,
  onSelect,
  onRemoveTicker,
  onBuyWatch,
  onAlert,
  bulk,
  renderDetail,
  signalRules = [],
  working,
  onShowOrders,
}: {
  rows: DashboardRow[];
  cols: string[];
  selected: string | null;
  onSelect: (symbol: string) => void;
  onRemoveTicker: (symbol: string) => void;
  onBuyWatch: (row: DashboardRow) => void;
  onAlert: (row: DashboardRow) => void;
  bulk?: BulkUI | null;
  renderDetail?: (symbol: string) => React.ReactNode; // drill-down, rendered inline under its row
  signalRules?: SignalRule[];
  working?: Record<string, number>;        // symbol → count of resting orders
  onShowOrders?: (symbol: string) => void; // open the Orders tab filtered to it
}) {
  const defs = cols.map((id) => DASH_COLUMNS[id]).filter(Boolean);
  const colSpan = 1 /* ticker */ + PINNED_DASH.length + defs.length + (bulk ? 1 : 0);
  const cellFor = (c: DashCol, r: DashboardRow) =>
    c.watchNA && r.is_watch ? <span style={{ color: "var(--text-faint)" }}>—</span> : c.render(r);

  // Click-to-sort: asc → desc → back to the default order. Persisted per browser.
  const [sort, setSort] = useState<SortState>(readSort);
  useEffect(() => {
    try {
      if (sort) localStorage.setItem(SORT_LS, JSON.stringify(sort));
      else localStorage.removeItem(SORT_LS);
    } catch { /* private mode */ }
  }, [sort]);
  const clickSort = (id: string) =>
    setSort((s) => (s?.id !== id ? { id, dir: -1 } : s.dir === -1 ? { id, dir: 1 } : null));
  const sortMark = (id: string) => (sort?.id === id ? (sort.dir === -1 ? " ▼" : " ▲") : "");
  const Th = ({ id, label, align }: { id: string; label: string; align?: string }) => (
    <th scope="col" className={align === "left" ? "left" : ""}
      aria-sort={sort?.id === id ? (sort.dir === -1 ? "descending" : "ascending") : undefined}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      title={`Sort by ${label} (click again to flip, third click resets)`}
      onClick={() => clickSort(id)}>
      {label}{sortMark(id)}
    </th>
  );
  const displayRows = sortRows(rows, sort);

  // Totals over HELD positions only (watchlist rows have no position). Shown as a
  // footer band; only summable money columns get a value, the rest stay blank.
  const held = rows.filter((r) => !r.is_watch);
  const totalCell = (id: string, align: DashCol["align"]) => {
    const kind = MONEY_SUM[id];
    if (!kind) return <td key={id} style={{ textAlign: align }} />;
    const vals = held.map((r) => (r as unknown as Record<string, number | null>)[id]).filter((v): v is number => v != null);
    if (!vals.length) return <td key={id} style={{ textAlign: align }}>—</td>;
    const sum = vals.reduce((a, b) => a + b, 0);
    const color = kind === "signed" ? (sum >= 0 ? "var(--pos)" : "var(--neg)") : "var(--text)";
    return (
      <td key={id} style={{ textAlign: align, color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {kind === "signed" && sum > 0 ? "+" : ""}{usd(sum)}
      </td>
    );
  };

  return (
    <div>
      {!bulk && <p style={S.hint}>Click a ticker to open its buy ladder.</p>}
      <div style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              {bulk && (
                <th style={{ width: 34, textAlign: "center" }}>
                  <input type="checkbox" checked={bulk.allChecked} onChange={bulk.onToggleAll}
                    aria-label="Select all candidates" />
                </th>
              )}
              <Th id="symbol" label="Ticker" align="left" />
              {PINNED_DASH.map((c) => <Th key={c.id} id={c.id} label={c.label} align={c.align} />)}
              {defs.map((c) => <Th key={c.id} id={c.id} label={c.label} align={c.align} />)}
            </tr>
          </thead>
          <tbody>
            {/* Bulk mode stays flat (nesting would muddle selection); otherwise nest ETFs. */}
            {(bulk ? displayRows.map((r) => ({ row: r, depth: 0, parent: null, childCount: 0 } as DispRow)) : nestRows(displayRows)).map(({ row: r, depth, parent }) => {
              const isCand = bulk?.candidates.has(r.symbol) ?? false;
              const isChecked = bulk?.checked.has(r.symbol) ?? false;
              const clickable = bulk ? isCand : true; // watch rows now open a (watch-mode) detail too
              const onRowClick = () => {
                if (bulk) { if (isCand) bulk.onToggle(r.symbol); }
                else onSelect(r.symbol);
              };
              const isOpen = !bulk && r.symbol === selected;
              const rowCls = [
                clickable && "rowlink",
                isOpen && "selected",
                bulk && isChecked && "selected",
                r.buy_mark ? "row-buy" : r.sell_mark ? "row-sell" : "",
              ].filter(Boolean).join(" ");
              return (
                <Fragment key={r.symbol}>
                <tr
                  className={rowCls}
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? "button" : undefined}
                  aria-label={clickable ? `${r.symbol} — ${bulk ? "toggle selection" : "open buy ladder"}` : undefined}
                  onClick={onRowClick}
                  onKeyDown={(e) => {
                    if (clickable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(); }
                  }}
                  style={{ opacity: bulk ? (isCand ? 1 : 0.45) : r.is_watch ? 0.85 : 1 }}
                >
                  {bulk && (
                    <td style={{ textAlign: "center" }}>
                      {isCand && (
                        <input type="checkbox" checked={isChecked}
                          onChange={() => bulk.onToggle(r.symbol)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${r.symbol}`} />
                      )}
                    </td>
                  )}
                  <td className="left" style={depth > 0 ? { paddingLeft: 26, boxShadow: "inset 3px 0 0 var(--border-strong)" } : undefined}>
                    <span style={S.tickerLine}>
                      {depth > 0 && <span style={S.childArrow} aria-hidden="true"><IconChildArrow size={13} /></span>}
                      <span style={{ fontWeight: 700, color: tickerRiskColor(r.risk) }} title={r.risk ? RISK_LABEL[r.risk] : undefined}>{r.symbol}</span>
                      {r.has_note && <NoteDot preview={r.note_preview} />}
                      {r.has_rules && <span style={S.rulesDot} title="Uses its own ticker rules (sell target / dip depth) — open to see or edit them" aria-label="custom rules">◆</span>}
                      {(working?.[r.symbol] ?? 0) > 0 && (
                        <button
                          className="tag"
                          style={S.workTag}
                          title={`${working![r.symbol]} resting order${working![r.symbol] === 1 ? "" : "s"} on ${r.symbol} — click to view before placing another`}
                          aria-label={`${working![r.symbol]} working order${working![r.symbol] === 1 ? "" : "s"} on ${r.symbol} — open the Orders tab`}
                          onClick={(e) => { e.stopPropagation(); onShowOrders?.(r.symbol); }}
                        >
                          {working![r.symbol]}
                        </button>
                      )}
                      {rowSignalChips(r, signalRules)}
                      {r.is_watch && (
                        <span className="tag" style={S.watchTag}>
                          watch{r.last_held != null ? ` · last $${r.last_held.toFixed(2)}` : ""}
                        </span>
                      )}
                      {!bulk && (
                        <button
                          className="hover-reveal"
                          style={S.bell}
                          title={`Set a price alert on ${r.symbol}`}
                          aria-label={`Set a price alert on ${r.symbol}`}
                          onClick={(e) => { e.stopPropagation(); onAlert(r); }}
                        >
                          <IconBell size={13} />
                        </button>
                      )}
                      {!bulk && r.is_watch && (
                        <span style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                          {/* Buy only once the watch row is drilled in — so its blue Buy
                              never sits inline next to held rows and reads like a signal. */}
                          {isOpen && <button className="btn btn-buy btn-sm" onClick={() => onBuyWatch(r)}>Buy</button>}
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ marginLeft: 4 }}
                            title="Remove from watchlist"
                            aria-label={`Remove ${r.symbol} from watchlist`}
                            onClick={() => onRemoveTicker(r.symbol)}
                          >
                            <IconClose />
                          </button>
                        </span>
                      )}
                    </span>
                    {r.name && <div style={S.name}>{r.name}</div>}
                    {depth > 0 && parent && parent.pct_of_high != null && (
                      <div style={S.underlyingCtx} title={`Read direction from the underlying, ${parent.symbol}`}>
                        {parent.symbol} at {pct(parent.pct_of_high)} of 52wk high
                      </div>
                    )}
                  </td>
                  {PINNED_DASH.map((c) => (
                    <td key={c.id} style={{ textAlign: c.align }}>{cellFor(c, r)}</td>
                  ))}
                  {defs.map((c) => (
                    <td key={c.id} style={{ textAlign: c.align }}>{cellFor(c, r)}</td>
                  ))}
                </tr>
                {isOpen && renderDetail && (
                  <tr>
                    <td colSpan={colSpan} style={S.drawer}>{renderDetail(r.symbol)}</td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
          {!bulk && held.length > 0 && (
            <tfoot>
              <tr style={S.totalsRow}>
                <td className="left" style={{ fontWeight: 700 }}>
                  Totals <span style={S.totalsSub}>· {held.length} held</span>
                </td>
                {PINNED_DASH.map((c) => totalCell(c.id, c.align))}
                {defs.map((c) => totalCell(c.id, c.align))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// The note dot with a hover popover previewing the saved note (full text on the
// detail page). Custom tooltip (not native title) so it's readable + on-theme.
function NoteDot({ preview }: { preview?: string | null }) {
  const [hover, setHover] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <span style={S.noteDot} aria-label="has note"
        title={preview ? undefined : "Has a saved note — open to read it"}>●</span>
      {hover && preview && (
        <span role="tooltip" style={S.noteTip} onClick={(e) => e.stopPropagation()}>{preview}</span>
      )}
    </span>
  );
}

const S: Record<string, React.CSSProperties> = {
  hint: { color: "var(--text-dim)", fontSize: "var(--fs-xs)", margin: "0 0 10px" },
  noteTip: { position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, width: 260,
    background: "var(--pop)", color: "var(--text)", border: "1px solid var(--border)",
    borderRadius: "var(--r-md)", boxShadow: "var(--shadow-pop)", padding: "8px 10px",
    fontSize: "var(--fs-xs)", fontWeight: 400, lineHeight: 1.45, whiteSpace: "pre-wrap",
    textAlign: "left", cursor: "default" },
  totalsRow: { borderTop: "2px solid var(--border-strong)", background: "var(--panel-2)" },
  totalsSub: { fontWeight: 400, color: "var(--text-faint)", fontSize: "var(--fs-2xs)" },
  // Inline drill-down drawer: full-width cell under the clicked row. Override the
  // table cell's nowrap/padding, share the selected row's recessed background, and
  // add a left accent rail so the panel reads as belonging to the row above.
  drawer: { padding: 0, whiteSpace: "normal", background: "var(--panel-2)", boxShadow: "inset 3px 0 0 var(--accent)" },
  tickerLine: { display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" },
  name: { fontSize: "var(--fs-2xs)", color: "var(--text-dim)", marginTop: 2 },
  watchTag: { color: "var(--accent-quiet)", border: "1px solid #3a4a5a", marginLeft: 2 },
  childArrow: { color: "var(--text-faint)", fontSize: "var(--fs-sm)", marginRight: -2 },
  underlyingCtx: { fontSize: "var(--fs-2xs)", color: "var(--accent-quiet)", marginTop: 2 },
  noteDot: { color: "var(--accent-quiet)", fontSize: 8, cursor: "help", lineHeight: 1 },
  rulesDot: { color: "var(--warn)", fontSize: 8, cursor: "help", lineHeight: 1 },
  // Bare resting-order count — a compact amber badge (hover explains, click opens Orders).
  workTag: { color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid var(--warn-border)",
    marginLeft: 2, cursor: "pointer", font: "inherit", fontSize: "var(--fs-2xs)", fontWeight: 700,
    minWidth: 16, textAlign: "center", borderRadius: "var(--r-pill)", padding: "0 5px" },
  bell: { background: "transparent", border: "none", cursor: "pointer", fontSize: "var(--fs-xs)", padding: 0, verticalAlign: "middle" },
};
