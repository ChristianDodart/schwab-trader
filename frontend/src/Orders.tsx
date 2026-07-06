import { useCallback, useEffect, useRef, useState } from "react";
import { usd } from "./App";
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

export function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
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

  return (
    <section className="panel" style={S.panel}>
      <div style={S.head}>
        <h2 className="page-title">Orders <span style={S.sub}>· last 7 days · selected account · auto-refreshes</span></h2>
        <button className="btn btn-secondary" onClick={() => load()}>↻ Refresh</button>
      </div>
      {loading ? (
        <SkeletonTable rows={5} cols={7} />
      ) : err ? (
        <p style={S.note}>{err} <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => load()}>Retry</button></p>
      ) : orders.length === 0 ? (
        <p style={S.note}>No orders on the selected account in the last 7 days.</p>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="tbl">
            <thead>
              <tr>{["Entered", "Symbol", "Side", "Qty", "Filled", "Type", "Price", "Status", ""].map((h, i) => (
                <th scope="col" key={h || "act"} className={i <= 1 ? "left" : ""}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {orders.map((o) => {
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
                    <td style={{ textAlign: "right" }}>
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
      )}
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  panel: { marginTop: 16, padding: 18 },
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" },
  sub: { fontSize: "var(--fs-sm)", fontWeight: 400, color: "var(--text-dim)" },
  note: { color: "var(--text-dim)", fontSize: "var(--fs-sm)", marginTop: 12 },
};
