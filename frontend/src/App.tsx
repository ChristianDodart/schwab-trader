import { useEffect, useState } from "react";
import { AccountPicker } from "./AccountPicker";
import { AuthBanner, LiveStatusPill } from "./AuthBanner";
import { BulkGear, BulkReviewModal, useBulk } from "./Bulk";
import { ColumnManager } from "./ColumnManager";
import { ConfirmDialog } from "./Modal";
import { DASH_COLUMNS, DASH_COLUMN_LIST, DEFAULT_DASH_COLS, useColumnPrefs } from "./columns";
import { DashboardTable } from "./DashboardTable";
import { Ledger } from "./Ledger";
import { NotificationsBell } from "./Notifications";
import { Orders } from "./Orders";
import { OrderTicket } from "./OrderTicket";
import { PositionDetail } from "./PositionDetail";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { Screener, MarketHoursBadge } from "./Screener";
import { Settings } from "./Settings";
import { FinancialRules } from "./FinancialRules";
import { SkeletonTable } from "./Skeleton";
import { useToast } from "./Toast";
import type { AlertPrefill, BuyCandidate, Dashboard, DashboardRow, SellCandidate, Suggestion } from "./types";

import { API, wsUrl } from "./api";

const WS_URL = wsUrl("/ws/dashboard");

const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "screen", label: "Screen" },
  { id: "ledger", label: "Ledger" },
  { id: "orders", label: "Orders" },
  { id: "rules", label: "Rules" },
  { id: "settings", label: "Settings" },
];
type View = "dashboard" | "screen" | "ledger" | "orders" | "rules" | "settings";

export function App() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [acctKey, setAcctKey] = useState("");
  const [addSym, setAddSym] = useState("");
  const [watchTicket, setWatchTicket] = useState<Suggestion | null>(null);
  const [alertPrefill, setAlertPrefill] = useState<AlertPrefill | null>(null);
  const [syncing, setSyncing] = useState(false);
  const dashCols = useColumnPrefs("dash.cols.v1", DEFAULT_DASH_COLS, DASH_COLUMN_LIST);
  const toast = useToast();
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const [workingOrders, setWorkingOrders] = useState(0);
  const bulk = useBulk(data?.rows, data?.mode, toast);

  // Ambient working-order count for the nav badge (per selected account). Refetch on
  // account switch (acctKey) + every 60s.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/orders/working-count`).then((r) => r.json())
        .then((j) => { if (alive) setWorkingOrders(j?.count ?? 0); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [acctKey]);

  // Guard tab/account switches when Settings has unsaved edits → custom confirm.
  const guardedNav = (action: () => void) => {
    if (view === "settings" && settingsDirty) setPendingNav(() => action);
    else action();
  };

  // Commit an account switch: persist server-side FIRST, then reset views. Awaiting
  // the select avoids a race where the acctKey-keyed child views remount and fetch
  // before the backend's selected-account has actually changed (stale data).
  const commitAccount = (hash: string) => {
    fetch(`${API}/accounts/select`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hash }),
    })
      .then((r) => { if (!r.ok) throw new Error(); setAcctKey(hash); setData(null); setSelected(null); bulk.cancel(); })
      .catch(() => toast("Couldn't switch account — try again.", "error"));
  };
  // The switch (server select + commit) is deferred through the dirty-Settings
  // guard — so cancelling truly leaves the account (and order routing) unchanged.
  const onAccountChange = (hash: string) => {
    if (hash === acctKey) return;
    guardedNav(() => commitAccount(hash));
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let disposed = false;   // guards against a post-unmount reconnect (StrictMode / re-mount)
    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(WS_URL);
      ws.onopen = () => { if (!disposed) setConnected(true); };
      ws.onclose = () => {
        if (disposed) return;   // don't reschedule after cleanup — no zombie loop
        setConnected(false);
        retry = setTimeout(connect, 1500);
      };
      // Guard the socket: a single malformed frame must never wedge the UI or
      // replace good data with garbage. Keep the last-good dashboard on any error.
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

  const mode = data?.mode;

  // Bulk selection only makes sense on the dashboard — leaving it cancels.
  useEffect(() => { if (view !== "dashboard") bulk.cancel(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const addTicker = () => {
    const sym = addSym.trim().toUpperCase();
    if (!sym) return;
    fetch(`${API}/tickers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: sym }),
    })
      .then((r) => r.json())
      .then((res) => { if (res.ok) setAddSym(""); else toast(res.error || `Couldn't add ${sym}`); })
      .catch(() => toast(`Couldn't add ${sym} — network error`));
  };
  const removeTicker = (sym: string) => {
    fetch(`${API}/tickers/${sym}`, { method: "DELETE" }).catch(() => {});
    toast(`Removed ${sym} from watchlist`, "info", {
      label: "Undo",
      onClick: () =>
        fetch(`${API}/tickers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym }),
        }).catch(() => {}),
    });
  };
  const buyWatch = (row: DashboardRow) =>
    setWatchTicket({ symbol: row.symbol, side: "BUY", order_type: "LIMIT", quantity: 1, limit_price: row.price ?? 0 });
  const onAlert = (row: DashboardRow) =>
    setAlertPrefill({ symbol: row.symbol, price: row.price });
  const syncFromSchwab = () => {
    setSyncing(true);
    fetch(`${API}/account/sync`, { method: "POST" })
      .then((r) => r.json())
      .then((res) => {
        if (res.ok) toast(`Synced from Schwab — ${res.open_lots ?? 0} open lots, ${res.closed ?? 0} closed`, "success");
        else toast(res.error || res.refused || res.skipped || "Sync didn't complete", "info");
      })
      .catch(() => toast("Sync failed — network error"))
      .finally(() => setSyncing(false));
  };

  return (
    <main className="app-main">
      <div className="app-container">
        <header style={S.header}>
          <div style={S.brandZone}>
            <h1 style={S.h1}>Schwab Trader</h1>
            <nav style={S.nav} aria-label="Primary">
              {NAV.map((t) => (
                <button
                  key={t.id}
                  className="navtab"
                  aria-current={view === t.id ? "page" : undefined}
                  onClick={() => guardedNav(() => setView(t.id))}
                >
                  {t.label}
                  {t.id === "orders" && workingOrders > 0 && (
                    <span style={S.navBadge} title={`${workingOrders} working order${workingOrders === 1 ? "" : "s"}`}>{workingOrders}</span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div style={S.rightZone}>
            <div style={S.statusZone}>
              <ConnDot connected={connected} />
              <FeedTag mode={mode} />
              <LiveStatusPill />
              <MarketHoursBadge />
            </div>
            {data && (
              <div style={S.kpiCluster}>
                <KPI label="Invested" value={usd(data.total_invested)} first />
                {data.harvestable != null && (
                  <KPI
                    label="Harvestable"
                    value={usd(data.harvestable)}
                    n={data.harvestable}
                    hint="Profit you could lock in right now by selling every profitable last position — the sum of the green Last Pos P/L values. Equals what 'Sell profitable' would realize."
                    hero
                  />
                )}
              </div>
            )}
            <NotificationsBell
              prefill={alertPrefill}
              onPrefillConsumed={() => setAlertPrefill(null)}
            />
          </div>
        </header>

        <AuthBanner />

        <div style={S.subbar}>
          <ProfileSwitcher />
          <AccountPicker value={acctKey} onAccountChange={onAccountChange} onInit={setAcctKey} />
          {view === "dashboard" && (bulk.kind ? (
            <span style={S.bulkBar}>
              {bulk.loading ? (
                <span style={S.note}>Loading {bulk.kind === "sell" ? "profitable positions" : "dip candidates"}…</span>
              ) : (
                <>
                  <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                    <b>{bulk.selected.length}</b> selected
                    {bulk.kind === "sell" ? (
                      <> · proceeds <b>{usd(bulk.selected.reduce((s, c) => s + ((c as SellCandidate).est_proceeds || 0), 0))}</b>
                        {" · "}profit <b style={{ color: "var(--pos)" }}>+{usd(bulk.selected.reduce((s, c) => s + ((c as SellCandidate).est_profit || 0), 0))}</b></>
                    ) : (
                      <> · cost <b>{usd(bulk.selected.reduce((s, c) => s + ((c as BuyCandidate).est_cost || 0), 0))}</b></>
                    )}
                  </span>
                  <button className="btn btn-secondary" onClick={bulk.cancel}>Cancel</button>
                  <button
                    className={`btn ${bulk.kind === "sell" ? "btn-danger" : "btn-buy"}`}
                    disabled={!bulk.selected.length}
                    onClick={() => bulk.setReview(true)}
                  >
                    Review {bulk.kind === "sell" ? "sells" : "buys"}
                  </button>
                </>
              )}
            </span>
          ) : (
            <>
              <span style={S.addWrap}>
                <input
                  className="field"
                  style={{ width: 120 }}
                  placeholder="Add ticker"
                  aria-label="Add ticker symbol"
                  value={addSym}
                  onChange={(e) => setAddSym(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && addTicker()}
                />
                <button className="btn btn-secondary" onClick={addTicker}>Add</button>
              </span>
              <ColumnManager prefs={dashCols} labelOf={(id) => DASH_COLUMNS[id]?.label ?? id} />
              <button className="btn btn-secondary" onClick={syncFromSchwab} disabled={syncing}
                title="Refresh this account's holdings from Schwab">
                {syncing ? "Syncing…" : "⟳ Sync from Schwab"}
              </button>
              <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <button className="btn btn-secondary" disabled={bulk.sellCount === 0}
                    title="Sell the profitable last position on each holding, at the current price"
                    onClick={() => { setSelected(null); bulk.start("sell"); }}>
                    Sell profitable · {bulk.sellCount}
                  </button>
                  <BulkGear kind="sell" />
                </span>
                <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <button className="btn btn-secondary"
                    title="Buy the next rung on dips — or select any stock (incl. ones you don't hold) to enter"
                    onClick={() => { setSelected(null); bulk.start("buy"); }}>
                    Buy the dip · {bulk.buyCount}
                  </button>
                  <BulkGear kind="buy" />
                </span>
              </span>
            </>
          ))}
        </div>

        {mode === "demo" && (
          <p style={S.note}>
            Not connected to Schwab — showing synthetic quotes, and orders won’t place.
            Reconnect under <b>Settings → Schwab connection</b> to go live.
          </p>
        )}

        {view === "settings" ? (
          <Settings key={acctKey} onDirtyChange={setSettingsDirty} />
        ) : view === "rules" ? (
          <FinancialRules key={acctKey} onDirtyChange={setSettingsDirty} />
        ) : view === "screen" ? (
          <Screener />
        ) : view === "ledger" ? (
          <Ledger key={acctKey} />
        ) : view === "orders" ? (
          <Orders key={acctKey} />
        ) : (
          <>
            {data ? (
              <DashboardTable
                rows={data.rows}
                cols={dashCols.ids}
                selected={selected}
                onSelect={(sym) => setSelected(sym === selected ? null : sym)}
                onRemoveTicker={removeTicker}
                onBuyWatch={buyWatch}
                onAlert={onAlert}
                bulk={bulk.bulkUI}
                renderDetail={(sym) => (
                  <PositionDetail symbol={sym} mode={mode} onClose={() => setSelected(null)} embedded />
                )}
              />
            ) : (
              <SkeletonTable />
            )}
          </>
        )}

        {watchTicket && <OrderTicket suggestion={watchTicket} mode={mode} onClose={() => setWatchTicket(null)} />}

        {bulk.review && bulk.kind && (
          <BulkReviewModal
            kind={bulk.kind}
            items={bulk.selected}
            mode={mode}
            placing={bulk.placing}
            result={bulk.result}
            onConfirm={bulk.confirm}
            onClose={() => { bulk.setReview(false); if (bulk.result) bulk.cancel(); }}
          />
        )}

        {pendingNav && (
          <ConfirmDialog
            title="Discard unsaved changes?"
            message="You have unsaved settings changes. Leaving will discard them."
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            danger
            onConfirm={() => { setSettingsDirty(false); const go = pendingNav; setPendingNav(null); go(); }}
            onCancel={() => setPendingNav(null)}
          />
        )}
      </div>
    </main>
  );
}

function ConnDot({ connected }: { connected: boolean }) {
  // The browser↔app data socket. It's almost always up, and the meaningful "Live"
  // (Schwab API) is LiveStatusPill — so when connected we show NOTHING (no mystery
  // dot). Only surface the exception: a dropped socket needs the user's attention.
  if (connected) return null;
  return <span className="pill" style={{ background: "var(--warn-bg)", color: "var(--warn)" }}>reconnecting…</span>;
}

function FeedTag({ mode }: { mode?: string }) {
  // Live is the expected default — don't announce it. Flag only the exceptions:
  // demo (profile not connected) and starting (feed connecting/reconnecting —
  // e.g. Schwab's overnight maintenance; it retries and goes live by itself).
  if (mode === "demo") {
    return (
      <span className="pill" style={{ background: "var(--warn-bg)", color: "var(--warn)" }} title="Not connected to Schwab — reconnect in Settings">
        Demo — not live
      </span>
    );
  }
  if (mode === "starting") {
    return (
      <span className="pill" style={{ background: "var(--panel-2)", color: "var(--text-muted)" }} title="Connecting to Schwab's quote stream — retries automatically (prices resume when it connects)">
        Feed connecting…
      </span>
    );
  }
  if (mode === "reauth") {
    return (
      <span className="pill" style={{ background: "var(--warn-bg)", color: "var(--warn)" }} title="Schwab rejected the token — the quote stream can't connect. Reconnect under Settings.">
        Feed offline — reconnect
      </span>
    );
  }
  return null;
}

function KPI({ label, value, n, hero, first, hint }: { label: string; value: string; n?: number | null; hero?: boolean; first?: boolean; hint?: string }) {
  const color = n == null || n === 0 ? "var(--text)" : n > 0 ? "var(--pos)" : "var(--neg)";
  return (
    <div style={{ ...S.kpi, ...(first ? { borderLeft: "none" } : null), ...(hint ? { cursor: "help" } : null) }} title={hint}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...(hero ? S.kpiHero : S.kpiVal), color }}>
        {n != null && n !== 0 && <span aria-hidden="true" style={{ fontSize: "0.68em", marginRight: 3 }}>{n > 0 ? "▲" : "▼"}</span>}
        {value}
      </div>
    </div>
  );
}

export const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(2)}%`;

const S: Record<string, React.CSSProperties> = {
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, rowGap: 12, flexWrap: "wrap" },
  brandZone: { display: "flex", alignItems: "center", gap: 14, minWidth: 0 },
  h1: { fontSize: "var(--fs-xl)", fontWeight: 700, margin: 0, letterSpacing: "-0.01em", whiteSpace: "nowrap" },
  nav: { display: "flex", gap: 4 },
  navBadge: { marginLeft: 6, background: "var(--warn)", color: "#1a1a1a", fontSize: "var(--fs-2xs)", fontWeight: 700, borderRadius: "var(--r-pill)", padding: "0 6px", lineHeight: 1.6 },
  rightZone: { display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", justifyContent: "flex-end" },
  statusZone: { display: "flex", alignItems: "center", gap: 10 },
  statusItem: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--fs-xs)", color: "var(--text-dim)", whiteSpace: "nowrap" },
  dot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  kpiCluster: { display: "flex", alignItems: "stretch", border: "1px solid var(--border)", borderRadius: "var(--r-md)", overflow: "hidden" },
  kpi: { padding: "3px 14px", borderLeft: "1px solid var(--border-hairline)" },
  kpiLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)" },
  kpiVal: { fontSize: "var(--fs-lg)", fontWeight: 600, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center" },
  kpiHero: { fontSize: "var(--fs-2xl)", fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", lineHeight: 1.1 },
  subbar: { display: "flex", alignItems: "center", gap: 16, marginTop: 18, flexWrap: "wrap" },
  bulkBar: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  addWrap: { display: "flex", gap: 6, alignItems: "center" },
  note: { color: "var(--text-muted)", fontSize: "var(--fs-md)", marginTop: 16 },
};
