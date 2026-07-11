import { Fragment, useEffect, useState } from "react";
import { DASH_COLUMNS, rowSignalChips, tickerRiskColor, RISK_LABEL, ProvenanceLegend, CalcMark } from "./columns";
import type { DashCol } from "./columns";
import type { DashboardRow } from "./types";
import type { SignalRule } from "./signals";
import { useFillFlash } from "./anim";
import { Tip } from "./Tip";
import { IconChildArrow, IconBell, IconClose, IconChevronRight, IconChevronLeft } from "./Icon";

// A sortable column header with a single hover tooltip (provenance + sort hint) that
// portals out of the table's scroll box. Top-level + stable so its tooltip state isn't
// reset by the table's 2s data refreshes.
function HeaderCell({
  id, label, align, prov, fold, collapsed, simple, sort, onSort,
}: {
  id: string; label: string; align?: string; prov?: DashCol["prov"]; fold?: boolean;
  collapsed: boolean; simple: boolean; sort: SortState; onSort: (id: string) => void;
}) {
  const computed = prov == null; // undefined = app-calculated → ƒ mark on the header
  const cls = [align === "left" ? "left" : "", fold ? "foldcol" + (collapsed ? " folded" : "") : ""].filter(Boolean).join(" ");
  const mark = sort?.id === id ? (sort.dir === -1 ? " ▼" : " ▲") : "";
  const inner = <>{label}{computed && !simple && <CalcMark />}{mark}</>;
  // One hover target for the header — explains the SORT action only (ƒ provenance is
  // explained once by the legend, not repeated on every hover).
  const tip = <Tip text={`Sort by ${label} — click to flip, third click resets`} focusable={false}>{inner}</Tip>;
  return (
    <th scope="col" className={cls || undefined}
      aria-sort={sort?.id === id ? (sort.dir === -1 ? "descending" : "ascending") : undefined}
      style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
      onClick={() => onSort(id)}>
      {fold ? <span className="foldwrap">{tip}</span> : tip}
    </th>
  );
}

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

// ---- ETF-aware default ordering --------------------------------------------
// An ETF child nests under its underlying for context, but you may hold the ETF while
// only WATCHING the underlying. So a parent+children GROUP counts as a holding if you
// hold the parent OR any child — it shouldn't get buried in the watchlist just because
// its underlying is watch-only. The group's placement uses the held member's P/L.
function buildKids(rows: DashboardRow[]) {
  const bySym = new Map(rows.map((r) => [r.symbol, r]));
  const kidsOf = new Map<string, DashboardRow[]>();
  const childSyms = new Set<string>();
  for (const r of rows) {
    const u = r.underlying;
    if (u && u !== r.symbol && bySym.has(u)) {
      const arr = kidsOf.get(u);
      if (arr) arr.push(r); else kidsOf.set(u, [r]);
      childSyms.add(r.symbol);
    }
  }
  return { bySym, kidsOf, childSyms };
}
// Effective status of a top-level group: watch only if the parent AND every child are
// watch; otherwise it's a holding, placed by the held member's (largest) P/L.
function groupStatus(parent: DashboardRow, children: DashboardRow[]): { watch: boolean; pl: number } {
  if (!parent.is_watch) return { watch: false, pl: parent.last_pos_profit ?? 0 };
  const held = children.filter((k) => !k.is_watch);
  if (held.length) {
    const primary = held.reduce((m, k) =>
      (Math.abs(k.last_pos_profit ?? 0) > Math.abs(m.last_pos_profit ?? 0) ? k : m));
    return { watch: false, pl: primary.last_pos_profit ?? 0 };
  }
  return { watch: true, pl: 0 };
}
// Sort rows so top-level GROUPS rank by effective status: profits first (biggest gain
// descending), then losses (biggest loss first), then watchlist groups alphabetical.
// Children inherit their parent's rank so they stay adjacent; nestRows regroups after.
export function defaultOrder(rows: DashboardRow[]): DashboardRow[] {
  const { bySym, kidsOf } = buildKids(rows);
  const rankOf = (r: DashboardRow) => {
    const parent = (r.underlying && r.underlying !== r.symbol && bySym.get(r.underlying)) || r;
    const g = groupStatus(parent, kidsOf.get(parent.symbol) ?? []);
    return { watch: g.watch, pl: g.pl, sym: parent.symbol };
  };
  const cmp = (a: { watch: boolean; pl: number; sym: string }, b: { watch: boolean; pl: number; sym: string }) => {
    if (a.watch !== b.watch) return a.watch ? 1 : -1;   // watch groups sink to the bottom
    if (a.watch) return a.sym.localeCompare(b.sym);      // watchlist: alphabetical
    const ga = a.pl > 0 ? 0 : a.pl < 0 ? 1 : 2;          // 0 profit · 1 loss · 2 flat
    const gb = b.pl > 0 ? 0 : b.pl < 0 ? 1 : 2;
    if (ga !== gb) return ga - gb;
    if (ga === 0) return b.pl - a.pl;                    // profits: highest first
    if (ga === 1) return a.pl - b.pl;                    // losses: biggest loss first
    return 0;
  };
  return [...rows].sort((a, b) => cmp(rankOf(a), rankOf(b)));
}
// Top-level symbols that are watchlist GROUPS (nothing held) — for the "Watchlist" divider.
export function watchGroupSet(rows: DashboardRow[]): Set<string> {
  const { kidsOf, childSyms } = buildKids(rows);
  const set = new Set<string>();
  for (const r of rows) {
    if (childSyms.has(r.symbol)) continue;               // only top-level parents
    if (groupStatus(r, kidsOf.get(r.symbol) ?? []).watch) set.add(r.symbol);
  }
  return set;
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
  foldedCols,
  collapsed = true,
  onToggleCollapse,
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
  simple?: boolean;                        // decluttered view: holdings + a fixed compact set
  foldedCols?: Set<string>;                // which columns hide behind the chevron (membership)
  collapsed?: boolean;                     // are the folded columns currently rolled up?
  onToggleCollapse?: () => void;           // flip the collapse (owned by the parent so Reset can re-collapse)
  tickerAdder?: { value: string; onChange: (v: string) => void; onSubmit: () => void }; // inline add-ticker box in the Ticker header
}) {
  const defs = cols.map((id) => DASH_COLUMNS[id]).filter(Boolean);

  // Column folding: the user chooses (in the Columns manager) which columns are folded
  // behind the chevron. Folded columns roll in/out inline via a chevron in the header.
  // Simple mode never folds — its short set is always shown.
  const isFolded = (id: string) => !simple && !!foldedCols?.has(id);
  const shownDefs = defs.filter((c) => !isFolded(c.id));
  const foldDefs = defs.filter((c) => isFolded(c.id));
  const showFoldToggle = !simple && foldDefs.length > 0;
  const colSpan = 1 /* ticker */ + defs.length + (bulk ? 1 : 0) + (showFoldToggle ? 1 : 0);
  const toggleFold = () => onToggleCollapse?.();
  // The chevron header cell (rendered after the fold columns so it hugs the right edge:
  // when folded the fold columns are 0-width, so it lands right after the essentials).
  const FoldToggleTh = () => (
    <th className="foldtoggle" style={S.foldToggleTh}>
      <button className="btn btn-ghost btn-sm" style={S.foldToggleBtn} aria-expanded={!collapsed}
        aria-label={collapsed ? `Show ${foldDefs.length} more column${foldDefs.length === 1 ? "" : "s"}` : "Hide the extra columns"}
        title={collapsed ? `Show ${foldDefs.length} more column${foldDefs.length === 1 ? "" : "s"}` : "Hide the extra columns"}
        onClick={toggleFold}>
        {collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
      </button>
    </th>
  );
  // Empty (no "—") for a watch row's position-only columns.
  const cellFor = (c: DashCol, r: DashboardRow) => (c.watchNA && r.is_watch ? null : c.render(r));

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
  // Shared header props — HeaderCell is a stable top-level component (so its tooltip
  // state survives the 2s data refreshes; an in-render component would remount each tick).
  const hProps = { collapsed, simple, sort, onSort: clickSort };
  // Flash a row when its POSITION changes (a fill) — not on the 2s price ticks.
  const fillDir = useFillFlash(rows);
  const displayRows = sort ? sortRows(rows, sort) : defaultOrder(rows);
  // Bulk mode stays flat (nesting would muddle selection); otherwise nest ETFs.
  const dispRows = bulk
    ? displayRows.map((r) => ({ row: r, depth: 0, parent: null, childCount: 0 } as DispRow))
    : nestRows(displayRows);
  // In the default (unsorted) view, watchlist GROUPS (nothing held in them) sit at the
  // bottom — mark where that group starts so a subtle "Watchlist" divider separates it
  // from holdings. A held ETF under a watch-only underlying counts as a holding.
  const watchGroups = (!bulk && !sort) ? watchGroupSet(rows) : null;
  const firstWatchIdx = watchGroups
    ? dispRows.findIndex((d) => d.depth === 0 && watchGroups.has(d.row.symbol))
    : -1;

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
                <HeaderCell id="symbol" label="Ticker" align="left" prov="text" {...hProps} />
              )}
              {shownDefs.map((c) => <HeaderCell key={c.id} id={c.id} label={c.label} align={c.align} prov={c.prov} {...hProps} />)}
              {foldDefs.map((c) => <HeaderCell key={c.id} id={c.id} label={c.label} align={c.align} prov={c.prov} fold {...hProps} />)}
              {showFoldToggle && <FoldToggleTh />}
            </tr>
          </thead>
          <tbody>
            {dispRows.map(({ row: r, depth }, rowIdx) => {
              const isCand = bulk?.candidates.has(r.symbol) ?? false;
              const isChecked = bulk?.checked.has(r.symbol) ?? false;
              const clickable = bulk ? isCand : true; // watch rows now open a (watch-mode) detail too
              const onRowClick = () => {
                if (bulk) { if (isCand) bulk.onToggle(r.symbol); }
                else onSelect(r.symbol);
              };
              const isOpen = !bulk && r.symbol === selected;
              const flash = bulk ? undefined : fillDir(r.symbol); // "buy" (shares up) | "sell" (down)
              const rowCls = [
                clickable && "rowlink",
                isOpen && "selected",
                bulk && isChecked && "selected",
                r.buy_mark ? "row-buy" : r.sell_mark ? "row-sell" : "",
                flash && "row-flash",
              ].filter(Boolean).join(" ");
              return (
                <Fragment key={r.symbol}>
                {rowIdx === firstWatchIdx && firstWatchIdx > 0 && (
                  <tr aria-hidden="true">
                    <td colSpan={colSpan} style={S.watchDivider}>Watchlist</td>
                  </tr>
                )}
                <tr
                  className={rowCls}
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? "button" : undefined}
                  aria-label={clickable ? `${r.symbol} — ${bulk ? "toggle selection" : "open buy ladder"}` : undefined}
                  onClick={onRowClick}
                  onKeyDown={(e) => {
                    if (clickable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onRowClick(); }
                  }}
                  style={{
                    opacity: bulk ? (isCand ? 1 : 0.45) : r.is_watch ? 0.85 : 1,
                    ...(flash ? { ["--flash-tint" as string]: flash === "buy" ? "var(--pos-bg)" : "var(--neg-bg)" } : null),
                  } as React.CSSProperties}
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
                        // marginLeft:auto pushes these to the RIGHT edge of the ticker cell,
                        // so the remove-X lines up vertically across every watch row.
                        <span style={{ whiteSpace: "nowrap", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}
                          onClick={(e) => e.stopPropagation()}>
                          {/* Buy only once the watch row is drilled in — so its blue Buy
                              never sits inline next to held rows and reads like a signal. */}
                          {isOpen && <button className="btn btn-buy btn-sm" onClick={() => onBuyWatch(r)}>Buy</button>}
                          <button
                            className="btn btn-ghost btn-sm"
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
                  {shownDefs.map((c) => (
                    <td key={c.id} style={{ textAlign: c.align }}>{cellFor(c, r)}</td>
                  ))}
                  {foldDefs.map((c) => (
                    <td key={c.id} className={"foldcol" + (collapsed ? " folded" : "")} style={{ textAlign: c.align }}>
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
  // Subtle section header between held positions and the watchlist group.
  // Separate the watchlist from holdings with a noticeable gap (extra top space on the
  // label cell) rather than a highlight band.
  watchDivider: { padding: "34px 12px 6px", fontSize: "var(--fs-2xs)", textTransform: "uppercase",
    letterSpacing: "0.07em", color: "var(--text-dim)", fontWeight: 600 },
  childArrow: { color: "var(--text-faint)", fontSize: "var(--fs-sm)", marginRight: -2 },
  noteDot: { color: "var(--accent-quiet)", fontSize: 8, cursor: "help", lineHeight: 1 },
  rulesDot: { color: "var(--warn)", fontSize: 8, cursor: "help", lineHeight: 1 },
  // Bare resting-order count — a compact amber badge (hover explains, click opens Orders).
  workTag: { color: "var(--warn)", background: "var(--warn-bg)", border: "1px solid var(--warn-border)",
    marginLeft: 2, cursor: "pointer", font: "inherit", fontSize: "var(--fs-2xs)", fontWeight: 700,
    minWidth: 16, textAlign: "center", borderRadius: "var(--r-pill)", padding: "0 5px" },
  bell: { background: "transparent", border: "none", cursor: "pointer", fontSize: "var(--fs-xs)", padding: 0, verticalAlign: "middle" },
};
