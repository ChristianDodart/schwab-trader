import { Fragment, useEffect, useState } from "react";
import { pct } from "./App";
import { DASH_COLUMNS, PINNED_DASH, ESSENTIAL_DASH_IDS, rowSignalChips, tickerRiskColor, RISK_LABEL, ProvenanceLegend, CalcMark } from "./columns";
import type { DashCol } from "./columns";
import type { DashboardRow } from "./types";
import type { SignalRule } from "./signals";
import { IconChildArrow, IconBell, IconClose, IconChevronRight, IconChevronLeft, IconEye } from "./Icon";

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
  simple = false,
  folded = true,
  onToggleFold,
  tickerAdder,
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
  simple?: boolean;                        // decluttered view: only Price pinned, no ƒ marks / legend
  folded?: boolean;                        // are the extra (foldable) columns collapsed?
  onToggleFold?: () => void;               // flip the fold (owned by the parent so Reset can re-collapse)
  tickerAdder?: { value: string; onChange: (v: string) => void; onSubmit: () => void }; // inline add-ticker box in the Ticker header
}) {
  const defs = cols.map((id) => DASH_COLUMNS[id]).filter(Boolean);
  // Simple mode pins only Price (drops the always-on Last Pos P/L) for a 4-column grid.
  const pinned = simple ? PINNED_DASH.filter((c) => c.id === "price") : PINNED_DASH;

  // Column folding: the essential columns always show; the rest roll in/out inline via
  // a chevron sitting in the header exactly where the next column would appear (right
  // arrow to reveal, left arrow to collapse). Default folded so the resting table stays
  // lean. Simple mode disables folding — its short column set is all essential.
  const essIds = new Set(ESSENTIAL_DASH_IDS);
  const essDefs = simple ? defs : defs.filter((c) => essIds.has(c.id));
  const foldDefs = simple ? [] : defs.filter((c) => !essIds.has(c.id));
  const showFoldToggle = !simple && foldDefs.length > 0;
  const colSpan = 1 /* ticker */ + pinned.length + defs.length + (bulk ? 1 : 0) + (showFoldToggle ? 1 : 0);
  const toggleFold = () => onToggleFold?.();
  // The chevron header cell (rendered after the fold columns so it hugs the right edge:
  // when folded the fold columns are 0-width, so it lands right after the essentials).
  const FoldToggleTh = () => (
    <th className="foldtoggle" style={S.foldToggleTh}>
      <button className="btn btn-ghost btn-sm" style={S.foldToggleBtn} aria-expanded={!folded}
        aria-label={folded ? `Show ${foldDefs.length} more column${foldDefs.length === 1 ? "" : "s"}` : "Hide the extra columns"}
        title={folded ? `Show ${foldDefs.length} more column${foldDefs.length === 1 ? "" : "s"}` : "Hide the extra columns"}
        onClick={toggleFold}>
        {folded ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
      </button>
    </th>
  );
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
  const Th = ({ id, label, align, prov, fold }: { id: string; label: string; align?: string; prov?: DashCol["prov"]; fold?: boolean }) => {
    const computed = prov == null;   // undefined = app-calculated → ƒ mark on the header
    const cls = [align === "left" ? "left" : "", fold ? "foldcol" + (folded ? " folded" : "") : ""].filter(Boolean).join(" ");
    const inner = <>{label}{computed && !simple && <CalcMark />}{sortMark(id)}</>;
    return (
      <th scope="col" className={cls || undefined}
        aria-sort={sort?.id === id ? (sort.dir === -1 ? "descending" : "ascending") : undefined}
        style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
        title={(prov === "schwab" ? "Provided by Schwab. " : "")
          + `Sort by ${label} (click again to flip, third click resets)`}
        onClick={() => clickSort(id)}>
        {fold ? <span className="foldwrap">{inner}</span> : inner}
      </th>
    );
  };
  const displayRows = sortRows(rows, sort);

  return (
    <div>
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
              {tickerAdder && !bulk ? (
                <th scope="col" className="left" style={{ verticalAlign: "middle" }}>
                  <input className="field" style={S.tickerAdd} placeholder="+ Add ticker"
                    aria-label="Add ticker symbol — press Enter to add"
                    title="Type a symbol and press Enter to add it to your watchlist"
                    value={tickerAdder.value}
                    onChange={(e) => tickerAdder.onChange(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === "Enter") tickerAdder.onSubmit(); }}
                    onClick={(e) => e.stopPropagation()} />
                </th>
              ) : (
                <Th id="symbol" label="Ticker" align="left" prov="text" />
              )}
              {pinned.map((c) => <Th key={c.id} id={c.id} label={c.label} align={c.align} prov={c.prov} />)}
              {essDefs.map((c) => <Th key={c.id} id={c.id} label={c.label} align={c.align} prov={c.prov} />)}
              {foldDefs.map((c) => <Th key={c.id} id={c.id} label={c.label} align={c.align} prov={c.prov} fold />)}
              {showFoldToggle && <FoldToggleTh />}
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
                      {depth > 0 && parent && parent.pct_of_high != null && (
                        <span style={S.underlyingChip}
                          title={`Read direction from the underlying — ${parent.symbol} is at ${pct(parent.pct_of_high)} of its 52-week high`}>
                          {parent.symbol} {Math.round(parent.pct_of_high * 100)}%
                        </span>
                      )}
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
                        <span style={S.watchEye} aria-label="On your watchlist"
                          title={r.last_held != null ? `On your watchlist — last sold at $${r.last_held.toFixed(2)}` : "On your watchlist"}>
                          <IconEye size={13} />
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
                    {isOpen && r.name && <div style={S.name}>{r.name}</div>}
                  </td>
                  {pinned.map((c) => (
                    <td key={c.id} style={{ textAlign: c.align }}>{cellFor(c, r)}</td>
                  ))}
                  {essDefs.map((c) => (
                    <td key={c.id} style={{ textAlign: c.align }}>{cellFor(c, r)}</td>
                  ))}
                  {foldDefs.map((c) => (
                    <td key={c.id} className={"foldcol" + (folded ? " folded" : "")} style={{ textAlign: c.align }}>
                      <span className="foldwrap">{cellFor(c, r)}</span>
                    </td>
                  ))}
                  {showFoldToggle && <td className="foldtoggle" />}
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
        </table>
      </div>
      {!simple && <ProvenanceLegend />}
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
  // Fold chevron column: narrow, centered, and non-sortable (a plain handle, not a header).
  foldToggleTh: { width: 34, padding: "4px 4px", textAlign: "center", cursor: "default" },
  foldToggleBtn: { padding: "2px 6px", minHeight: 24, color: "var(--text-dim)" },
  // Inline add-ticker box that replaces the "Ticker" header word (normal case, not the
  // uppercase header styling); the rest of the header cells stay as text.
  tickerAdd: { width: 150, maxWidth: "100%", height: 28, textTransform: "none", letterSpacing: 0,
    fontWeight: 400, fontSize: "var(--fs-sm)" },
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
  // Watchlist: a quiet eye glyph (replaces the old "WATCH · LAST $X" text). The
  // last-sold price moves to the Price cell where it can be compared to the live price.
  watchEye: { display: "inline-flex", alignItems: "center", color: "var(--text-faint)", cursor: "help" },
  childArrow: { color: "var(--text-faint)", fontSize: "var(--fs-sm)", marginRight: -2 },
  // ETF underlying context: a compact chip (parent + its % of 52wk high) inline in the
  // ticker cell, replacing the old full-sentence line under the row.
  underlyingChip: { fontSize: "var(--fs-2xs)", color: "var(--text-faint)", background: "var(--panel-2)",
    border: "1px solid var(--border)", borderRadius: "var(--r-sm)", padding: "0 6px", lineHeight: 1.6,
    whiteSpace: "nowrap", cursor: "help", fontVariantNumeric: "tabular-nums" },
  noteDot: { color: "var(--accent-quiet)", fontSize: 8, cursor: "help", lineHeight: 1 },
  rulesDot: { color: "var(--warn)", fontSize: 8, cursor: "help", lineHeight: 1 },
  // Bare resting-order count — a compact amber badge (hover explains, click opens Orders).
  workTag: { color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid var(--warn-border)",
    marginLeft: 2, cursor: "pointer", font: "inherit", fontSize: "var(--fs-2xs)", fontWeight: 700,
    minWidth: 16, textAlign: "center", borderRadius: "var(--r-pill)", padding: "0 5px" },
  bell: { background: "transparent", border: "none", cursor: "pointer", fontSize: "var(--fs-xs)", padding: 0, verticalAlign: "middle" },
};
