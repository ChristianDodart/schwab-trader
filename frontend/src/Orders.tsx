import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "./App";
import { Modal } from "./Modal";
import { SkeletonTable } from "./Skeleton";
import { useToast } from "./Toast";
import type { Order } from "./types";

import { API } from "./api";
const CANCELABLE = new Set([
  "WORKING", "PENDING_ACTIVATION", "QUEUED", "ACCEPTED",
  "AWAITING_PARENT_ORDER", "AWAITING_CONDITION", "AWAITING_MANUAL_REVIEW",
]);

// Status → chip color: green filled, dim terminal (canceled/rejected/expired),
// amber for anything still working/queued.
const statusChip = (s: string): React.CSSProperties => {
  const [bg, fg] =
    s === "FILLED" ? ["var(--pos-bg)", "var(--pos)"]
    : s === "REJECTED" || s === "CANCELED" || s === "EXPIRED" ? ["transparent", "var(--text-faint)"]
    : CANCELABLE.has(s) ? ["var(--warn-bg)", "var(--warn)"]
    : ["var(--panel-2)", "var(--text-dim)"];
  return { background: bg, color: fg, border: s === "REJECTED" || s === "CANCELED" || s === "EXPIRED" ? "1px solid var(--border)" : "none" };
};

export function Orders({ initialFilter }: { initialFilter?: string } = {}) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState(initialFilter ?? "");
  const [editing, setEditing] = useState<Order | null>(null);
  const toast = useToast();
  const seq = useRef(0);

  // silent=true → background refresh (no skeleton flash, no error takeover of the list)
  const load = useCallback((silent = false) => {
    if (!silent) { setLoading(true); setErr(null); }
    const my = ++seq.current;
    fetch(`${API}/orders?days=7`)
      .then((r) => r.json())
      .then((j) => {
        if (seq.current !== my) return;  // drop stale out-of-order response
        if (j?.error) { if (!silent) setErr(j.error); }
        else { setOrders(j.orders || []); setErr(null); }
        setLoading(false);
      })
      .catch(() => { if (seq.current === my && !silent) { setErr("Couldn't load orders — network error."); setLoading(false); } });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 15_000);  // ambient refresh of working orders
    return () => clearInterval(t);
  }, [load]);

  const cancel = (id: string) =>
    fetch(`${API}/orders/${id}`, { method: "DELETE" })
      .then((r) => r.json())
      .then((res) => { if (!res.ok && res.error) toast(res.error); load(true); })
      .catch(() => toast("Couldn't cancel the order — network error"));

  const shown = filter
    ? orders.filter((o) => (o.symbol || "").toUpperCase().includes(filter.toUpperCase()))
    : orders;

  return (
    <section className="panel" style={S.panel}>
      <div style={S.head}>
        <h2 className="page-title">Orders <span style={S.sub}>· last 7 days · selected account · auto-refreshes</span></h2>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <input className="field" style={{ width: 130 }} placeholder="Filter symbol"
            aria-label="Filter orders by symbol" value={filter}
            onChange={(e) => setFilter(e.target.value)} />
          {filter && <button className="btn btn-ghost btn-sm" onClick={() => setFilter("")}>clear</button>}
          <button className="btn btn-secondary" onClick={() => load()}>↻ Refresh</button>
        </span>
      </div>
      {loading ? (
        <SkeletonTable rows={5} cols={7} />
      ) : err ? (
        <p style={S.note}>{err} <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => load()}>Retry</button></p>
      ) : orders.length === 0 ? (
        <p style={S.note}>No orders on the selected account in the last 7 days.</p>
      ) : shown.length === 0 ? (
        <p style={S.note}>No orders match “{filter}” in the last 7 days.</p>
      ) : (
        <>
          {(() => {
            const working = shown.filter((o) => CANCELABLE.has(o.status)).length;
            const filled = shown.filter((o) => o.status === "FILLED").length;
            const other = shown.length - working - filled;
            return (
              <p style={S.summary}>
                <b style={{ color: working ? "var(--warn)" : "var(--text-muted)" }}>{working} working</b>
                <span style={S.dot}>·</span>
                <b style={{ color: "var(--pos)" }}>{filled} filled</b>
                {other > 0 && <><span style={S.dot}>·</span><span style={{ color: "var(--text-dim)" }}>{other} other</span></>}
              </p>
            );
          })()}
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="tbl">
            <thead>
              <tr>{["Entered", "Symbol", "Side", "Qty", "Filled", "Type", "Price", "Status", ""].map((h, i) => (
                <th scope="col" key={h || "act"} className={i <= 1 ? "left" : ""}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {shown.map((o) => {
                const buy = o.side === "BUY";
                return (
                  <tr key={o.order_id}>
                    <td className="left">{o.entered?.replace("T", " ")}</td>
                    <td className="left"><b>{o.symbol}</b></td>
                    <td style={{ textAlign: "right", color: buy ? "var(--pos)" : "var(--neg)" }}>
                      <span aria-hidden="true">{buy ? "▲" : "▼"}</span> {o.side}
                    </td>
                    <td style={{ textAlign: "right" }}>{o.quantity}</td>
                    <td style={{ textAlign: "right" }}>{o.filled}</td>
                    <td style={{ textAlign: "right" }}>{o.type}</td>
                    <td style={{ textAlign: "right" }}>{o.price ? usd(o.price) : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className="pill" style={statusChip(o.status)}>{o.status}</span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {CANCELABLE.has(o.status) && o.type === "LIMIT" && (
                        <button className="btn btn-secondary btn-sm" style={{ marginRight: 6 }}
                          onClick={() => setEditing(o)}>Edit</button>
                      )}
                      {CANCELABLE.has(o.status) && (
                        <button className="btn btn-sell btn-sm" onClick={() => cancel(o.order_id)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
      {editing && (
        <EditOrderModal order={editing} onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load(true); }} />
      )}
    </section>
  );
}

// Modify a WORKING limit order: new price and/or quantity, sent through Schwab's
// native cancel-and-replace (the broker swaps the orders in one operation, so
// there is never a moment with no order resting). Same soft rails as placing —
// a needs_confirm response shows the warning and requires an explicit second click.
function EditOrderModal({ order, onClose, onDone }: {
  order: Order; onClose: () => void; onDone: () => void;
}) {
  const [qty, setQty] = useState(String(order.quantity ?? ""));
  const [price, setPrice] = useState(order.limit_price != null ? String(order.limit_price) : "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok?: boolean; error?: string; detail?: string; needs_confirm?: boolean; warning?: string; order_id?: string; needs_verify?: boolean } | null>(null);
  const toast = useToast();

  const q = parseInt(qty, 10);
  const p = parseFloat(price);
  const valid = q > 0 && p > 0;
  const changed = valid && (q !== order.quantity || p !== order.limit_price);
  const buy = order.side === "BUY";

  const submit = (confirm = false) => {
    setBusy(true);
    fetch(`${API}/orders/${order.order_id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: q, limit_price: p, confirm }),
    })
      .then((r) => r.json())
      .then((res) => {
        setResult(res);
        if (res.ok) {
          toast(res.order_id ? `Order replaced — new order #${res.order_id}` : "Order replaced — verify in the list", "success");
          onDone();
        }
      })
      .catch(() => setResult({ ok: false, error: "network error — check the Orders list before retrying" }))
      .finally(() => setBusy(false));
  };

  return (
    <Modal labelledBy="edit-order-title" onClose={onClose} width={420}>
      <div style={{ padding: 20 }}>
        <div id="edit-order-title" style={ES.title}>
          Edit order · <span style={{ color: buy ? "var(--pos)" : "var(--neg)" }}>{order.side}</span> {order.symbol}
        </div>
        <p style={ES.sub}>
          Working: {order.quantity} @ {order.limit_price != null ? usd(order.limit_price) : "—"}.
          Schwab swaps the old order for the new one in a single operation.
        </p>
        <label style={ES.row}>Quantity
          <input className="field" style={ES.field} type="number" min={1} step={1}
            value={qty} onChange={(e) => { setQty(e.target.value); setResult(null); }} />
        </label>
        <label style={ES.row}>Limit price
          <input className="field" style={ES.field} type="number" min={0.01} step={0.01}
            value={price} onChange={(e) => { setPrice(e.target.value); setResult(null); }} />
        </label>
        {valid && (
          <div style={ES.est}>
            <span>New {buy ? "cost" : "proceeds"}</span>
            <b>{usd(q * p)}</b>
          </div>
        )}
        {result && !result.ok && !result.needs_confirm && (
          <p style={ES.err}>{result.error || result.detail || "replace failed"}</p>
        )}
        {result?.needs_confirm ? (
          <>
            <p style={ES.warn}>⚠ {result.warning}</p>
            <div style={ES.actions}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setResult(null)}>Back</button>
              <button className={buy ? "btn btn-primary" : "btn btn-sell"} style={{ flex: 2 }}
                disabled={busy} onClick={() => submit(true)}>
                {busy ? "Replacing…" : "Replace anyway"}
              </button>
            </div>
          </>
        ) : (
          <div style={ES.actions}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
            <button className={buy ? "btn btn-primary" : "btn btn-sell"} style={{ flex: 2 }}
              disabled={!changed || busy} onClick={() => submit(false)}
              title={valid && !changed ? "Change the price or quantity first" : undefined}>
              {busy ? "Replacing…" : "Review & replace"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

const ES: Record<string, React.CSSProperties> = {
  title: { fontSize: "var(--fs-lg)", fontWeight: 600 },
  sub: { color: "var(--text-dim)", fontSize: "var(--fs-sm)", margin: "6px 0 12px", lineHeight: 1.45 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--fs-sm)", color: "var(--text-muted)", marginTop: 10 },
  field: { width: 140, textAlign: "right" },
  est: { display: "flex", justifyContent: "space-between", fontSize: "var(--fs-md)", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" },
  warn: { color: "var(--warn)", fontSize: "var(--fs-sm)", marginTop: 12, lineHeight: 1.45 },
  err: { color: "var(--neg)", fontSize: "var(--fs-sm)", marginTop: 12 },
  actions: { display: "flex", gap: 10, marginTop: 16 },
};

const S: Record<string, React.CSSProperties> = {
  panel: { marginTop: 16, padding: 18 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  sub: { fontSize: "var(--fs-sm)", fontWeight: 400, color: "var(--text-dim)" },
  note: { color: "var(--text-dim)", fontSize: "var(--fs-sm)", marginTop: 12 },
  summary: { display: "flex", alignItems: "center", gap: 8, fontSize: "var(--fs-sm)", margin: "10px 0 0" },
  dot: { color: "var(--text-faint)" },
};
