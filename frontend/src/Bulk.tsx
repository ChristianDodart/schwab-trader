import { useEffect, useRef, useState } from "react";
import { usd } from "./App";
import { Modal } from "./Modal";
import type { BulkUI } from "./DashboardTable";
import type { BulkPrefs, BulkResult, BuyCandidate, DashboardRow, ExitCandidate, SellCandidate } from "./types";

import { API } from "./api";
import { IconSettings, IconClose, IconWarning } from "./Icon";
type Kind = "sell" | "buy" | "exit";
type AnyCandidate = SellCandidate | BuyCandidate | ExitCandidate;
const PLAN_PATH: Record<Kind, string> = { sell: "sell-plan", buy: "buy-plan", exit: "exit-plan" };
type Push = (msg: string, kind?: "error" | "success" | "info") => void;
// An editable row in the review modal (shares + limit price are user-adjustable).
type EditRow = { symbol: string; lot_id?: number; is_new?: boolean; shares: number; price: number; buy_price?: number; limit_price: number };

// Orchestrates the two bulk flows (harvest profitable last positions / buy the
// dip): counts, plan fetch, checkbox selection, review, and placement.
export function useBulk(rows: DashboardRow[] | undefined, mode: string | undefined, toast: Push) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [plan, setPlan] = useState<AnyCandidate[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [buyingPower, setBuyingPower] = useState<number | null>(null); // advisory (buy plan only)

  // Counts come free from the dashboard rows the client already has.
  const held = (rows || []).filter((r) => !r.is_watch);
  const sellCount = held.filter((r) => (r.last_pos_profit ?? 0) > 0).length;
  const buyCount = held.filter((r) => r.buy_mark).length;
  const exitCount = held.length; // "get me out" applies to every open position

  const cancel = () => { setKind(null); setPlan([]); setChecked(new Set()); setReview(false); setResult(null); };

  const start = (k: Kind) => {
    setLoading(true); setKind(k); setPlan([]); setResult(null); setReview(false); setChecked(new Set()); setBuyingPower(null);
    const emptyMsg: Record<Kind, string> = {
      sell: "No profitable last positions to harvest right now.",
      buy: "No stocks available to buy right now.",
      exit: "No open positions to exit.",
    };
    fetch(`${API}/bulk/${PLAN_PATH[k]}`)
      .then((r) => r.json())
      .then((d) => {
        setBuyingPower(typeof d.buying_power === "number" ? d.buying_power : null);
        const cands: AnyCandidate[] = d.candidates || [];
        if (!cands.length) {
          // Nothing selectable at all — don't strand the user in an empty mode.
          cancel();
          toast(d.note || emptyMsg[k], "info");
          return;
        }
        setPlan(cands);
        // Pre-check only the qualifying candidates; the rest stay selectable.
        setChecked(new Set(cands.filter((c) => c.qualifies).map((c) => c.symbol)));
      })
      .catch(() => { cancel(); toast(`Couldn't load the ${k} plan — network error`); })
      .finally(() => setLoading(false));
  };
  const toggle = (sym: string) =>
    setChecked((s) => { const n = new Set(s); n.has(sym) ? n.delete(sym) : n.add(sym); return n; });
  const allChecked = plan.length > 0 && plan.every((c) => checked.has(c.symbol));
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(plan.map((c) => c.symbol)));

  const selected = plan.filter((c) => checked.has(c.symbol));

  const confirm = (orderType: string, items: EditRow[]) => {
    if (!kind || !items.length) return;
    setPlacing(true);
    const body = kind === "sell"
      ? { items: items.map((i) => ({ lot_id: i.lot_id, symbol: i.symbol, shares: i.shares, limit_price: i.limit_price })), order_type: orderType, confirm: true }
      : kind === "exit"
      ? { items: items.map((i) => ({ symbol: i.symbol, shares: i.shares, limit_price: i.limit_price })), confirm: true }
      : { items: items.map((i) => ({ symbol: i.symbol, shares: i.shares, limit_price: i.limit_price })), order_type: orderType, confirm: true };
    fetch(`${API}/bulk/${kind}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((res: BulkResult) => {
        setResult(res);
        const okN = res.placed ?? 0;
        if (okN) { toast(`Placed ${okN} ${kind} order${okN > 1 ? "s" : ""}`, "success"); fetch(`${API}/account/sync`, { method: "POST" }).catch(() => {}); }
        if (okN < (res.count ?? 0)) toast(`${(res.count ?? 0) - okN} order(s) didn't place — see the summary`, "error");
      })
      .catch(() => toast("Bulk placement failed — network error"))
      .finally(() => setPlacing(false));
  };

  const bulkUI: BulkUI | null = kind
    ? { kind, candidates: new Set(plan.map((c) => c.symbol)), checked, onToggle: toggle, allChecked, onToggleAll: toggleAll }
    : null;

  return { kind, loading, start, cancel, bulkUI, sellCount, buyCount, exitCount, selected, review, setReview, confirm, placing, result, mode, buyingPower };
}

// Gear next to each bulk button: configure the auto-select threshold. Thresholds
// only drive the DEFAULT checkboxes — every candidate stays selectable.
export function BulkGear({ kind, revealClass }: { kind: Kind; revealClass?: string }) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<BulkPrefs | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`${API}/bulk/prefs`).then((r) => r.json()).then(setPrefs).catch(() => {});
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const field = kind === "sell" ? "sell_min_gain_pct" : kind === "buy" ? "buy_dip_pct" : "exit_offset_pct";
  const val = prefs ? (prefs as unknown as Record<string, number>)[field] ?? 0 : 0;
  const isExit = kind === "exit";
  const save = (v: number) => {
    // Exit offset may be negative (price below last buy → fills sooner); the others clamp >= 0.
    const n = isExit ? Math.max(-25, Math.min(25, v || 0)) : Math.max(0, v || 0);
    setPrefs((p) => (p ? { ...p, [field]: n } : p));
    fetch(`${API}/bulk/prefs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: n }),
    }).catch(() => {});
  };
  const title = kind === "sell" ? "Sell — auto-select" : kind === "buy" ? "Buy — auto-select" : "Exit — limit price";
  const rowLabel = kind === "sell" ? "Gain at least" : kind === "buy" ? "Dip at least" : "Offset from last price";
  const help = kind === "sell"
    ? "Pre-checks profitable last positions whose gain is at least this. All profitable positions stay selectable."
    : kind === "buy"
    ? "Pre-checks held positions that dropped at least this far below the last buy. New positions are never auto-checked but are always selectable."
    : "The GTC limit sits this far off each position's last-buy price. 0% = at the last price; negative fills sooner. Nothing is pre-selected.";

  return (
    <span style={{ position: "relative", display: "inline-block" }} ref={wrapRef}>
      <button className={`btn btn-secondary btn-sm${revealClass ? " " + revealClass : ""}`} aria-label={`Configure ${kind} settings`}
        aria-expanded={open} title="Configure" onClick={() => setOpen((o) => !o)}><IconSettings /></button>
      {open && (
        <div style={S.gearPop} role="dialog" aria-label={`${kind} settings`}>
          <div style={S.gearTitle}>{title}</div>
          <label style={S.gearRow}>
            <span>{rowLabel}</span>
            <input className="field" type="number" min={isExit ? -25 : 0} max={isExit ? 25 : undefined} step="0.5" style={{ width: 68, textAlign: "right" }}
              value={prefs ? val : ""} onChange={(e) => save(Number(e.target.value))} />
            <span style={{ color: "var(--text-dim)" }}>%</span>
          </label>
          <p style={S.gearHelp}>{help}</p>
        </div>
      )}
    </span>
  );
}

export function BulkReviewModal({
  kind, items, mode, placing, result, onConfirm, onClose, buyingPower,
}: {
  kind: Kind;
  items: AnyCandidate[];
  mode?: string;
  placing: boolean;
  result: BulkResult | null;
  onConfirm: (orderType: string, rows: EditRow[]) => void;
  onClose: () => void;
  buyingPower?: number | null; // advisory: flag when selected buy total exceeds it
}) {
  const isDemo = mode === "demo";
  const isSell = kind === "sell";
  const isExit = kind === "exit";
  const [orderType, setOrderType] = useState<"LIMIT" | "MARKET">("LIMIT");
  const [session, setSession] = useState<string | null>(null);
  const [rows, setRows] = useState<EditRow[]>(() =>
    items.map((c) => ({
      symbol: c.symbol, lot_id: (c as SellCandidate).lot_id, is_new: (c as BuyCandidate).is_new,
      shares: c.shares, price: (c as SellCandidate).price ?? c.limit_price,
      buy_price: (c as SellCandidate).buy_price, limit_price: c.limit_price,
    })),
  );

  // Extended-hours: Schwab allows limit only. On a fetch failure default to
  // "unknown" (→ market allowed but the user is warned by the estimate note).
  useEffect(() => {
    let alive = true;
    fetch(`${API}/market-hours`).then((r) => r.json())
      .then((s) => alive && setSession(s.session ?? "unknown")).catch(() => alive && setSession("unknown"));
    return () => { alive = false; };
  }, []);
  // Market only during REGULAR hours — outside them (extended, closed, or unknown)
  // a market order fills at an unknown gap/open price, so force the price-protected
  // LIMIT (matches the single order ticket's philosophy).
  const marketDisabled = session !== null && session !== "regular";
  useEffect(() => { if (marketDisabled && orderType === "MARKET") setOrderType("LIMIT"); }, [marketDisabled, orderType]);

  const isLimit = orderType === "LIMIT";
  const effPrice = (r: EditRow) => (isLimit ? r.limit_price : r.price);
  const update = (i: number, patch: Partial<EditRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const totalCost = rows.reduce((s, r) => s + r.shares * effPrice(r), 0);
  const totalProceeds = totalCost;
  const totalProfit = rows.reduce((s, r) => s + (effPrice(r) - (r.buy_price ?? 0)) * r.shares, 0);
  const typeDesc = isLimit
    ? isSell
      ? "Limit — sells at your price or better; a sudden drop rests instead of filling at a loss (cancel anytime in Orders)."
      : "Limit — buys at your price or better; rests if the market is above it."
    : "Market — fills immediately at whatever the market gives; no price guarantee.";
  const modalTitle = isSell ? "Harvest profits" : isExit ? "Get me out" : "Buy the dip";
  const innerTitle = isSell ? "Harvest profitable last positions"
    : isExit ? "Exit positions — good-till-canceled limit at your last-buy price" : "Bulk buy — review and adjust";

  return (
    <Modal key={result ? "result" : "form"} title={modalTitle} onClose={onClose} width={520}>
      {isDemo && <div style={S.demoStrip}>Not connected to Schwab — orders won’t place. Reconnect in Settings.</div>}
      <div style={{ padding: 16 }}>
        {!result ? (
          <>
            <div style={S.title}>{innerTitle}</div>
            {!isExit && (
              <div style={S.typeRow}>
                <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-dim)" }}>Order type</span>
                <span role="group" aria-label="Order type" style={{ display: "flex", gap: 6 }}>
                  <button className="btn btn-sm" style={seg(isLimit)} aria-pressed={isLimit}
                    title={isSell ? "Sells at your price or better; rests if the market moves away" : "Buys at your price or better; rests if the market is above it"}
                    onClick={() => setOrderType("LIMIT")}>Limit</button>
                  <button className="btn btn-sm" style={seg(!isLimit)} aria-pressed={!isLimit} disabled={marketDisabled}
                    title={marketDisabled ? "Market is only available during regular market hours" : "Fills immediately at the current price; no price guarantee"}
                    onClick={() => setOrderType("MARKET")}>Market</button>
                </span>
              </div>
            )}
            <p style={S.typeDesc}>
              {isExit
                ? "Good-till-canceled limit SELL of each full position at its last-buy price (adjust per row). A limit fills at your price or BETTER, so it never sells below it — it rests until filled. Cancel anytime in Orders."
                : `${typeDesc}${marketDisabled ? " Market is available only during regular market hours." : ""}`}
            </p>
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col" className="left">Symbol</th>
                    <th scope="col">Shares</th>
                    <th scope="col">{isLimit ? "Limit" : "~ Price"}</th>
                    <th scope="col">{isSell || isExit ? "Est. proceeds" : "Est. cost"}</th>
                    {isSell && <th scope="col">Est. profit</th>}
                    <th scope="col" aria-label="remove"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const bandWarn = !isSell && !isExit && isLimit && r.price > 0 && Math.abs(r.limit_price / r.price - 1) > 0.25;
                    const profit = (effPrice(r) - (r.buy_price ?? 0)) * r.shares;
                    return (
                      <tr key={r.lot_id ?? r.symbol}>
                        <td className="left"><b>{r.symbol}</b>{r.is_new && <span style={S.newTag}>new</span>}</td>
                        <td style={{ textAlign: "right" }}>
                          <input className="field" type="number" min={1} step={1} value={r.shares}
                            aria-label={`${r.symbol} shares`} style={S.numIn}
                            onChange={(e) => update(i, { shares: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {isLimit ? (
                            <input className="field" type="number" min={0.01} step="0.01" value={r.limit_price}
                              aria-label={`${r.symbol} limit price`}
                              title={bandWarn ? "More than 25% from the market — will be rejected" : undefined}
                              style={{ ...S.numIn, ...(bandWarn ? { borderColor: "var(--warn)", color: "var(--warn)" } : null) }}
                              onChange={(e) => update(i, { limit_price: Number(e.target.value) || 0 })} />
                          ) : (
                            <span style={{ color: "var(--text-dim)" }}>~ {usd(r.price)}</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>{usd(r.shares * effPrice(r))}</td>
                        {isSell && (
                          <td style={{ textAlign: "right", color: profit >= 0 ? "var(--pos)" : "var(--neg)" }}>
                            {profit >= 0 ? "+" : ""}{usd(profit)}
                          </td>
                        )}
                        <td style={{ textAlign: "right" }}>
                          <button className="btn btn-ghost btn-sm" aria-label={`Remove ${r.symbol}`} title="Remove" onClick={() => removeRow(i)}><IconClose /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr><td colSpan={isSell ? 6 : 5} style={{ textAlign: "center", color: "var(--text-dim)", padding: "12px 0" }}>All rows removed — nothing to place.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={S.totals}>
              {isSell
                ? <>Total proceeds <b>{usd(totalProceeds)}</b> · profit <b style={{ color: totalProfit >= 0 ? "var(--pos)" : "var(--neg)" }}>{totalProfit >= 0 ? "+" : ""}{usd(totalProfit)}</b></>
                : isExit
                ? <>Total proceeds if filled <b>{usd(totalProceeds)}</b> · <b>{rows.length}</b> position{rows.length !== 1 ? "s" : ""}</>
                : <>Total cost <b>{usd(totalCost)}</b>{buyingPower != null && <> · buying power <b>{usd(buyingPower)}</b></>}</>}
            </div>
            {/* Advisory only — never blocks; the broker enforces margin/settlement. */}
            {!isSell && buyingPower != null && totalCost > buyingPower && (
              <p style={S.warnNote}>
                <IconWarning /> Selected total exceeds available buying power ({usd(buyingPower)}) — advisory only; the
                broker enforces margin.
              </p>
            )}
            <p style={S.note}>
              {isSell
                ? "Edit shares or price per row, or remove any. A limit sells at your price or better — a sudden drop rests instead of filling at a loss. Check the Orders tab after placing."
                : isExit
                ? "Edit shares or price per row, or remove any. These rest as good-till-canceled limit sells until filled — the aim is to get out, not to hit a profit. Cancel any of them in the Orders tab."
                : "Edit shares or price per row, or remove any. Check the Orders tab after placing."}
            </p>
            <div style={S.actions}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>Back</button>
              <button
                className={`btn ${isDemo ? "btn-secondary" : isSell || isExit ? "btn-danger" : "btn-buy"}`}
                style={{ flex: 2 }}
                disabled={placing || !rows.length || rows.some((r) => r.shares < 1 || (isLimit && !(r.limit_price > 0)))}
                onClick={() => onConfirm(orderType, rows)}
              >
                {(() => {
                  const verb = isExit ? "exit" : isSell ? "sell" : "buy";
                  const n = rows.length;
                  const plural = n !== 1 ? "s" : "";
                  if (placing) return "Placing…";
                  const act = isDemo ? "Simulate" : isExit ? "Exit" : "Place";
                  return isExit ? `${act} ${n} position${plural}` : `${act} ${n} ${verb}${plural}`;
                })()}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={S.title}>Placed {result.placed} of {result.count}.</div>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {result.results.map((r, i) => (
                <div key={i} style={S.resultRow}>
                  <b style={{ minWidth: 56 }}>{r.symbol ?? `#${r.lot_id}`}</b>
                  {r.ok
                    ? <span style={{ color: "var(--pos)" }}>✓ sent{r.order_id ? ` · #${r.order_id}` : ""}</span>
                    : <span style={{ color: "var(--neg)" }}>{r.error || "failed"}</span>}
                </div>
              ))}
            </div>
            <div style={S.actions}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// Segmented toggle: active = accent (a control), never the profit-green.
const seg = (active: boolean): React.CSSProperties => ({
  background: active ? "var(--accent)" : "var(--panel-2)",
  color: active ? "#fff" : "var(--text-muted)",
  borderColor: active ? "var(--accent)" : "var(--border-strong)",
});

const S: Record<string, React.CSSProperties> = {
  liveStrip: { background: "var(--danger-bg)", borderBottom: "1px solid var(--danger)", color: "#f6b7cc", fontSize: "var(--fs-xs)", fontWeight: 700, letterSpacing: "0.03em", padding: "8px 16px", borderTopLeftRadius: "var(--r-lg)", borderTopRightRadius: "var(--r-lg)" },
  typeRow: { display: "flex", alignItems: "center", gap: 10, marginTop: 12 },
  typeDesc: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", margin: "6px 0 0", lineHeight: 1.45 },
  numIn: { width: 78, textAlign: "right", padding: "3px 6px", fontSize: "var(--fs-sm)" },
  newTag: { fontSize: 10, textTransform: "uppercase", color: "var(--accent-quiet)", border: "1px solid #3a4a5a", borderRadius: "var(--r-sm)", padding: "0 5px", marginLeft: 6 },
  gearPop: { position: "absolute", top: "calc(100% + 6px)", right: 0, width: 240, background: "var(--pop)", border: "1px solid var(--border)", borderRadius: "var(--r-lg)", boxShadow: "var(--shadow-pop)", zIndex: "var(--z-popover)" as unknown as number, padding: 12 },
  gearTitle: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-dim)", marginBottom: 10 },
  gearRow: { display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-sm)", color: "var(--text-muted)" },
  gearHelp: { fontSize: "var(--fs-2xs)", color: "var(--text-dim)", margin: "8px 0 0", lineHeight: 1.4 },
  demoStrip: { background: "var(--panel-2)", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: "var(--fs-xs)", fontWeight: 600, padding: "8px 16px", borderTopLeftRadius: "var(--r-lg)", borderTopRightRadius: "var(--r-lg)" },
  title: { fontSize: "var(--fs-md)", fontWeight: 600 },
  totals: { marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: "var(--fs-sm)", color: "var(--text-muted)" },
  note: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", margin: "10px 0 0", lineHeight: 1.45 },
  warnNote: { fontSize: "var(--fs-xs)", color: "var(--warn)", margin: "8px 0 0", lineHeight: 1.45 },
  actions: { display: "flex", gap: 10, marginTop: 16 },
  resultRow: { display: "flex", gap: 10, alignItems: "center", fontSize: "var(--fs-sm)" },
};
