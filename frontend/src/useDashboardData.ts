// The dashboard's live read-model, extracted from the App shell so App is layout +
// routing and this owns the data feed. Four independent reads plus one derived health flag:
//
//   - the WebSocket dashboard stream        → data + connected
//   - the /account/margin poll (30s)        → cash + margin (full summary, for the glossary)
//   - the /orders/working-count poll (30s)  → working { count, bySym }
//   - a derived "prices are stale" flag     → pricesStale
//
// READ-ONLY: it never selects an account or touches any UI state. `acctKey` and `view` are
// the refetch triggers the shell already owns (account switch / return to the dashboard),
// and `live` (from useLiveness) is passed in so the stale flag stays a pure function of its
// inputs. Account SELECTION — and the bulk/selection resets a switch also does — stay in
// the shell; this only reacts to the resulting acctKey.
import { useEffect, useRef, useState } from "react";

import { API, wsUrl } from "./api";
import type { Dashboard } from "./types";

// Prices are stale only when we're MEANT to be live but Schwab isn't answering — a pure
// function of the feed mode + liveness so the rule is testable off the hook. A demo feed
// (mode === "demo") isn't meant to be live, so it's never "stale"; an unknown liveness
// (null, still probing) isn't stale either — only an explicit `false` dims the table.
export function pricesAreStale(mode: string | undefined, live: boolean | null): boolean {
  return mode !== "demo" && live === false;
}

type CashInfo = {
  cash: number | null;
  buying_power: number | null;
  margin_buying_power: number | null;
  tradable_funds: number | null;
};

export type DashboardData = {
  data: Dashboard | null;
  connected: boolean;
  cash: CashInfo | null;
  margin: Record<string, number | null> | null;
  working: { count: number; bySym: Record<string, number> };
  pricesStale: boolean;
};

export function useDashboardData(
  acctKey: string,
  view: string,
  live: boolean | null,
): DashboardData {
  const [data, setData] = useState<Dashboard | null>(null);
  const [connected, setConnected] = useState(false);
  const [cash, setCash] = useState<CashInfo | null>(null);
  const [margin, setMargin] = useState<Record<string, number | null> | null>(null);
  const [count, setCount] = useState(0);
  const [bySym, setBySym] = useState<Record<string, number>>({});

  // Blank the dashboard the instant the account changes (a real switch, not the initial
  // resolve from "") so account A's holdings never show under account B until the WS
  // delivers B's data. Mirrors the shell's old commitAccount setData(null).
  const prevAcct = useRef(acctKey);
  useEffect(() => {
    if (prevAcct.current && prevAcct.current !== acctKey) setData(null);
    prevAcct.current = acctKey;
  }, [acctKey]);

  // Live dashboard stream. Guard the socket: a single malformed frame must never wedge the
  // UI or replace good data with garbage — keep the last-good dashboard on any error.
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let disposed = false;   // guards against a post-unmount reconnect (StrictMode / re-mount)
    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(wsUrl("/ws/dashboard"));
      ws.onopen = () => { if (!disposed) setConnected(true); };
      ws.onclose = () => {
        if (disposed) return;   // don't reschedule after cleanup — no zombie loop
        setConnected(false);
        retry = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const parsed = JSON.parse(ev.data);
          if (parsed && Array.isArray(parsed.rows)) setData(parsed as Dashboard);
        } catch {
          /* ignore a bad frame — keep the last-good dashboard */
        }
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      if (ws) { ws.onclose = null; ws.onmessage = null; ws.onopen = null; ws.close(); }
    };
  }, []);

  // Cash + buying power for the header + the full margin summary for the glossary
  // (account-level, live). Refetch on account switch + every 30s.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/account/margin`).then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          const m = j && !j.blocked ? j : null;
          setCash(m ? { cash: m.cash ?? null, buying_power: m.buying_power ?? null, margin_buying_power: m.margin_buying_power ?? null, tradable_funds: m.tradable_funds ?? null } : null);
          setMargin(m);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [acctKey]);

  // Ambient working orders (per selected account): total for the nav badge + per-symbol
  // counts for the dashboard row markers. Refetch on account switch (acctKey) + every 30s —
  // placing/canceling also pokes it via view changes.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/orders/working-count`).then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          setCount(j?.count ?? 0);
          setBySym(j?.by_symbol && typeof j.by_symbol === "object" ? j.by_symbol : {});
        }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [acctKey, view]);

  // When stale, the shell dims the table + explains so a frozen quote isn't mistaken for a
  // real move. (The retired demo feed is a display-only concern that stays in the shell.)
  const pricesStale = pricesAreStale(data?.mode, live);

  return { data, connected, cash, margin, working: { count, bySym }, pricesStale };
}
