import { Fragment } from "react";
import { usd } from "./App";
import { DASH_COLUMNS, PINNED_DASH, rowSignalChips } from "./columns";
import type { DashCol } from "./columns";
import type { DashboardRow } from "./types";

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
  kind: "sell" | "buy";
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
}) {
  const defs = cols.map((id) => DASH_COLUMNS[id]).filter(Boolean);
  const colSpan = 1 /* ticker */ + PINNED_DASH.length + defs.length + (bulk ? 1 : 0);
  const cellFor = (c: DashCol, r: DashboardRow) =>
    c.watchNA && r.is_watch ? <span style={{ color: "var(--text-faint)" }}>—</span> : c.render(r);

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
              <th scope="col" className="left">Ticker</th>
              {PINNED_DASH.map((c) => <th scope="col" key={c.id} className={c.align === "left" ? "left" : ""}>{c.label}</th>)}
              {defs.map((c) => (
                <th scope="col" key={c.id} className={c.align === "left" ? "left" : ""}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isCand = bulk?.candidates.has(r.symbol) ?? false;
              const isChecked = bulk?.checked.has(r.symbol) ?? false;
              const clickable = bulk ? isCand : !r.is_watch;
              const onRowClick = () => {
                if (bulk) { if (isCand) bulk.onToggle(r.symbol); }
                else if (!r.is_watch) onSelect(r.symbol);
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
                  <td className="left">
                    <span style={S.tickerLine}>
                      <span style={{ fontWeight: 700 }}>{r.symbol}</span>
                      {rowSignalChips(r)}
                      {r.is_watch && <span className="tag" style={S.watchTag}>watch</span>}
                      {!bulk && (
                        <button
                          className="hover-reveal"
                          style={S.bell}
                          title={`Set a price alert on ${r.symbol}`}
                          aria-label={`Set a price alert on ${r.symbol}`}
                          onClick={(e) => { e.stopPropagation(); onAlert(r); }}
                        >
                          🔔
                        </button>
                      )}
                      {!bulk && r.is_watch && (
                        <span style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                          <button className="btn btn-buy btn-sm" onClick={() => onBuyWatch(r)}>Buy</button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ marginLeft: 4 }}
                            title="Remove from watchlist"
                            aria-label={`Remove ${r.symbol} from watchlist`}
                            onClick={() => onRemoveTicker(r.symbol)}
                          >
                            ✕
                          </button>
                        </span>
                      )}
                    </span>
                    {r.name && <div style={S.name}>{r.name}</div>}
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

const S: Record<string, React.CSSProperties> = {
  hint: { color: "var(--text-dim)", fontSize: "var(--fs-xs)", margin: "0 0 10px" },
  totalsRow: { borderTop: "2px solid var(--border-strong)", background: "var(--panel-2)" },
  totalsSub: { fontWeight: 400, color: "var(--text-faint)", fontSize: "var(--fs-2xs)" },
  // Inline drill-down drawer: full-width cell under the clicked row. Override the
  // table cell's nowrap/padding, share the selected row's recessed background, and
  // add a left accent rail so the panel reads as belonging to the row above.
  drawer: { padding: 0, whiteSpace: "normal", background: "var(--panel-2)", boxShadow: "inset 3px 0 0 var(--accent)" },
  tickerLine: { display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" },
  name: { fontSize: "var(--fs-2xs)", color: "var(--text-dim)", marginTop: 2 },
  watchTag: { color: "var(--accent-quiet)", border: "1px solid #3a4a5a", marginLeft: 2 },
  bell: { background: "transparent", border: "none", cursor: "pointer", fontSize: "var(--fs-xs)", padding: 0, verticalAlign: "middle" },
};
