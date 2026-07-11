import { useEffect, useRef, useState } from "react";
import { ProfilePanel, ContextChip } from "./ProfilePanel";
import { AuthBanner, LiveStatusPill, useLiveness } from "./AuthBanner";
import { FirstRun } from "./FirstRun";
import { ReauthButton } from "./Reauth";
import { UpdateBanner } from "./UpdateBanner";
import { SectorStrip } from "./SectorStrip";
import { matchesRule, type SignalRule } from "./signals";
import { BulkGear, BulkReviewModal, useBulk } from "./Bulk";
import { ColumnManager } from "./ColumnManager";
import { ConfirmDialog } from "./Modal";
import { DASH_COLUMNS, DASH_COLUMN_LIST, DEFAULT_DASH_COLS, useColumnPrefs } from "./columns";
import { KpiPicker, useKpiPrefs, visibleKpis } from "./kpis";
import { DashboardTable } from "./DashboardTable";
import { tickerRiskColor } from "./columns";
import { Ledger } from "./Ledger";
import { NotificationsBell, NotificationsProvider, NotificationsTab } from "./Notifications";
import { Orders } from "./Orders";
import { OrderTicket } from "./OrderTicket";
import { PositionDetail } from "./PositionDetail";
import { Screener, MarketHoursBadge } from "./Screener";
import { Settings } from "./Settings";
import { FinancialRules } from "./FinancialRules";
import { SkeletonTable } from "./Skeleton";
import { useToast } from "./Toast";
import type { AlertPrefill, BuyCandidate, Dashboard, DashboardRow, ExitCandidate, SellCandidate, Suggestion } from "./types";

import { API, wsUrl } from "./api";
import { IconRefresh, IconWarning, IconClose, IconSearch } from "./Icon";

const WS_URL = wsUrl("/ws/dashboard");

const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "screen", label: "Screen" },
  { id: "ledger", label: "Ledger" },
  { id: "orders", label: "Orders" },
  { id: "rules", label: "Rules" },
  { id: "notifications", label: "Notifications" },
  { id: "profile", label: "Profile" },
  { id: "settings", label: "Settings" },
];
type View = "dashboard" | "screen" | "ledger" | "orders" | "rules" | "notifications" | "profile" | "settings";

export function App() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [showHelp, setShowHelp] = useState(false);
  const [symQuery, setSymQuery] = useState("");        // Ctrl+F find-bar filter (by ticker)
  const [findOpen, setFindOpen] = useState(false);     // browser-style find bar (hidden until Ctrl+F)
  const [sectorFilter, setSectorFilter] = useState<string | null>(null); // click a sector chip
  const [dashSub, setDashSub] = useState<"all" | "todo" | "top">("all");
  const symInputRef = useRef<HTMLInputElement>(null);
  const gPending = useRef(false); // "g" prefix for vim-style tab jumps (g then d/s/l/o/r)
  const [cashInfo, setCashInfo] = useState<{ cash: number | null; buying_power: number | null; margin_buying_power: number | null } | null>(null);
  const [signalRules, setSignalRules] = useState<SignalRule[]>([]);
  const [paused, setPaused] = useState(false); // freeze live dashboard updates
  const [pausedSince, setPausedSince] = useState<string>("");
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  const togglePause = () => setPaused((v) => {
    const next = !v;
    if (next) setPausedSince(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    return next;
  });
  const [acctKey, setAcctKey] = useState("");
  const [addSym, setAddSym] = useState("");
  const [watchTicket, setWatchTicket] = useState<Suggestion | null>(null);
  const [alertPrefill, setAlertPrefill] = useState<AlertPrefill | null>(null);
  const [syncing, setSyncing] = useState(false);
  const dashCols = useColumnPrefs("dash.cols.v1", DEFAULT_DASH_COLS, DASH_COLUMN_LIST);
  // Simple mode: a decluttered dashboard for casual use — holdings only, four essential
  // columns, no sector bar / bulk tools / toolbar / ƒ marks. Opt-in, persisted per device.
  const [simple, setSimple] = useState<boolean>(() => {
    try { return localStorage.getItem("dash.simple.v1") === "1"; } catch { return false; }
  });
  const toggleSimple = () => setSimple((s) => {
    const n = !s;
    try { localStorage.setItem("dash.simple.v1", n ? "1" : "0"); } catch { /* private mode */ }
    return n;
  });
  const kpiPrefs = useKpiPrefs();
  const toast = useToast();
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const [workingOrders, setWorkingOrders] = useState(0);
  const [workingBySym, setWorkingBySym] = useState<Record<string, number>>({});
  const [ordersFilter, setOrdersFilter] = useState<string | null>(null);
  const bulk = useBulk(data?.rows, data?.mode, toast);
  const live = useLiveness();
  // Prices are stale only when we're MEANT to be live (not demo) but Schwab isn't
  // answering — then dim the table + explain, so a frozen quote isn't mistaken for a real move.
  const pricesStale = data?.mode !== "demo" && live === false;
  // Dashboard table rows after the "/" ticker filter and any clicked sector filter.
  // SectorStrip + bulk keep using the FULL row set (whole-portfolio views).
  const dashRows = (data?.rows ?? []).filter((r) =>
    (!symQuery || r.symbol.toUpperCase().includes(symQuery)) &&
    (!sectorFilter || (r.sector || "Untagged") === sectorFilter));
  // To-Do: held positions meeting a BUY or SELL signal (built-in mark OR a custom rule).
  const todoRows = (data?.rows ?? []).filter((r) =>
    !r.is_watch && (r.buy_mark || r.sell_mark || signalRules.some((rule) => matchesRule(rule, r))));
  // Simple mode shows real holdings only (no watchlist rows) and a fixed essentials
  // column set. Ticker + Price are always rendered; these are the extra columns.
  const holdingsRows = (data?.rows ?? []).filter((r) => !r.is_watch);
  const SIMPLE_COLS = ["unrealized", "current_value"];

  // One-time "you just updated" toast: compare the running version to the last one we saw.
  // Only fires when it actually changed (not on a fresh install), then records the new one.
  useEffect(() => {
    fetch(`${API}/version`).then((r) => r.json()).then((j) => {
      const v = j?.version;
      if (!v) return;
      const key = "app.lastSeenVersion";
      let prev: string | null = null;
      try { prev = localStorage.getItem(key); } catch { /* private mode */ }
      if (prev && prev !== v) toast(`Updated to v${v} — see what's new under Settings.`, "success");
      try { localStorage.setItem(key, v); } catch { /* private mode */ }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Custom signal rules (per account). Refetch on account switch + whenever we return to the
  // dashboard, so edits made in Settings show up without a full reload.
  useEffect(() => {
    let alive = true;
    fetch(`${API}/signal-rules`).then((r) => r.json())
      .then((j) => { if (alive && Array.isArray(j?.rules)) setSignalRules(j.rules); }).catch(() => {});
    return () => { alive = false; };
  }, [acctKey, view]);

  // Cash + buying power for the header (account-level, live). Refetch on account switch + 30s.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/account/margin`).then((r) => r.json())
        .then((j) => { if (alive) setCashInfo(j && !j.blocked ? { cash: j.cash ?? null, buying_power: j.buying_power ?? null, margin_buying_power: j.margin_buying_power ?? null } : null); })
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [acctKey]);

  // Ambient working orders (per selected account): total for the nav badge +
  // per-symbol counts for the dashboard row markers. Refetch on account switch
  // (acctKey) + every 30s — placing/canceling also pokes it via view changes.
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/orders/working-count`).then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          setWorkingOrders(j?.count ?? 0);
          setWorkingBySym(j?.by_symbol && typeof j.by_symbol === "object" ? j.by_symbol : {});
        }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, [acctKey, view]);

  // Guard tab/account switches when Settings has unsaved edits → custom confirm.
  const guardedNav = (action: () => void) => {
    if (view === "settings" && settingsDirty) setPendingNav(() => action);
    else action();
  };

  // Keyboard shortcuts: digits 1..N jump to a tab (through the same dirty-settings guard),
  // "?" toggles the help overlay. Ignored while typing in a field or when a modal is open,
  // so it never fights with order tickets, search boxes, or dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Browser-style find: Ctrl/Cmd+F opens the hidden ticker find bar on the dashboard
      // (works from anywhere, even mid-typing, exactly like a browser's find). Handled
      // before the modifier bail-out below so the app owns it instead of the OS.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "f" || e.key === "F")) {
        if (view === "dashboard" && !simple && dashSub === "all" && !document.querySelector(".modal-overlay")) {
          e.preventDefault();
          setFindOpen(true);
          setTimeout(() => symInputRef.current?.focus(), 0);
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.key === "Escape" && showHelp) { setShowHelp(false); return; }
      if (document.querySelector(".modal-overlay")) return; // don't reach behind a modal
      // vim-style: "g" then a tab's first letter (g d/s/l/o/r). Consume the letter here.
      if (gPending.current) {
        gPending.current = false;
        const t = NAV.find((n) => n.id[0] === e.key.toLowerCase());
        if (t) { e.preventDefault(); guardedNav(() => setView(t.id)); return; }
      }
      if (e.key === "g") { gPending.current = true; setTimeout(() => { gPending.current = false; }, 900); return; }
      if (e.key === "?") { e.preventDefault(); setShowHelp((v) => !v); return; }
      if (/^[1-9]$/.test(e.key)) {
        const t = NAV[Number(e.key) - 1];
        if (t) { e.preventDefault(); guardedNav(() => setView(t.id)); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // re-bound each render so the guard sees current view/settingsDirty

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

  // Account init lives in the shell now (was in AccountPicker): sync acctKey to the
  // server's already-selected account on startup, so the dashboard works even though
  // the account picker itself moved to the Profile tab (mounted only when viewed).
  // This just mirrors state — no /accounts/select POST — so it never disturbs the feed.
  useEffect(() => {
    fetch(`${API}/accounts`).then((r) => r.json())
      .then((j) => { if (j?.selected_hash) setAcctKey(j.selected_hash); })
      .catch(() => {});
  }, []);

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
        if (disposed || pausedRef.current) return; // paused → keep the frozen snapshot
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
  useEffect(() => { if (view !== "dashboard") { bulk.cancel(); setFindOpen(false); } }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const onAlert = (row: DashboardRow) => {
    setAlertPrefill({ symbol: row.symbol, price: row.price });
    setView("notifications");   // the alert form lives on the Notifications tab now
  };
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
    <NotificationsProvider>
    <main className="app-main">
      <div className="app-container">
        <header style={S.header}>
          {/* Left cluster: brand + live status + KPI glance + alerts (moved from the
              right per the layout request). Nav tabs now sit on the right. */}
          <div style={S.brandZone}>
            <h1 style={S.h1}>Schwab Trader</h1>
            <div style={S.statusZone}>
              <ConnDot connected={connected} />
              <FeedTag mode={mode} />
              <LiveStatusPill />
              <MarketHoursBadge />
            </div>
            {data && (() => {
              const kpis = visibleKpis(kpiPrefs.ids, data, cashInfo);
              return (
                <div style={S.kpiZone}>
                  {kpis.length > 0 && (
                    <div style={S.kpiCluster}>
                      {kpis.map((k, i) => (
                        <KPI key={k.id} label={k.label} value={k.value} n={k.n} color={k.color}
                          first={i === 0} hint={k.hint} />
                      ))}
                    </div>
                  )}
                  {/* Gear lives OUTSIDE the cluster — the cluster clips its rounded corners
                      with overflow:hidden, which would also clip the picker popover. */}
                  <KpiPicker ids={kpiPrefs.ids} toggle={kpiPrefs.toggle} reset={kpiPrefs.reset} />
                </div>
              );
            })()}
            <NotificationsBell onOpen={() => guardedNav(() => setView("notifications"))} />
          </div>

          <nav style={S.nav} aria-label="Primary">
            {NAV.map((t) => (
              <button
                key={t.id}
                className="navtab"
                aria-current={view === t.id ? "page" : undefined}
                onClick={() => guardedNav(() => { if (t.id === "orders") setOrdersFilter(null); setView(t.id); })}
              >
                {t.label}
                {t.id === "orders" && workingOrders > 0 && (
                  <span style={S.navBadge} title={`${workingOrders} working order${workingOrders === 1 ? "" : "s"}`}>{workingOrders}</span>
                )}
              </button>
            ))}
          </nav>
        </header>

        <UpdateBanner />
        <AuthBanner />

        {/* Browser-style find bar: hidden until Ctrl/Cmd+F, floats at the top-right,
            filters the dashboard by ticker, and closes on Esc — just like a browser. */}
        {findOpen && view === "dashboard" && !simple && dashSub === "all" && (
          <div style={S.findBar} role="search" aria-label="Find ticker">
            <span style={{ display: "inline-flex", color: "var(--text-dim)" }} aria-hidden="true"><IconSearch size={15} /></span>
            <input ref={symInputRef} value={symQuery} placeholder="Find ticker…" aria-label="Find ticker"
              style={S.findInput}
              onChange={(e) => setSymQuery(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); setSymQuery(""); setFindOpen(false); }
              }} />
            <span style={S.findCount}>
              {symQuery
                ? `${dashRows.length} match${dashRows.length === 1 ? "" : "es"}`
                : `${data?.rows.length ?? 0} tickers`}
            </span>
            <button className="btn btn-ghost btn-sm" aria-label="Close find (Esc)" title="Close (Esc)"
              onClick={() => { setSymQuery(""); setFindOpen(false); }}><IconClose /></button>
          </div>
        )}

        {view === "dashboard" && <FirstRun nav={(v) => guardedNav(() => setView(v as View))} />}

        <div style={S.subbar}>
          <ContextChip acctKey={acctKey} onOpen={() => guardedNav(() => setView("profile"))} />
          {view === "dashboard" && (bulk.kind ? (
            <span style={S.bulkBar}>
              {bulk.loading ? (
                <span style={S.note}>Loading {bulk.kind === "sell" ? "profitable positions" : bulk.kind === "exit" ? "open positions" : "dip candidates"}…</span>
              ) : (
                <>
                  <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-muted)" }}>
                    <b>{bulk.selected.length}</b> selected
                    {bulk.kind === "sell" ? (
                      <> · proceeds <b>{usd(bulk.selected.reduce((s, c) => s + ((c as SellCandidate).est_proceeds || 0), 0))}</b>
                        {" · "}profit <b style={{ color: "var(--pos)" }}>+{usd(bulk.selected.reduce((s, c) => s + ((c as SellCandidate).est_profit || 0), 0))}</b></>
                    ) : bulk.kind === "exit" ? (
                      <> · proceeds if filled <b>{usd(bulk.selected.reduce((s, c) => s + ((c as ExitCandidate).est_proceeds || 0), 0))}</b></>
                    ) : (
                      <> · cost <b>{usd(bulk.selected.reduce((s, c) => s + ((c as BuyCandidate).est_cost || 0), 0))}</b></>
                    )}
                  </span>
                  <button className="btn btn-secondary" onClick={bulk.cancel}>Cancel</button>
                  <button
                    className={`btn ${bulk.kind === "buy" ? "btn-buy" : "btn-danger"}`}
                    disabled={!bulk.selected.length}
                    onClick={() => bulk.setReview(true)}
                  >
                    Review {bulk.kind === "sell" ? "sells" : bulk.kind === "exit" ? "exits" : "buys"}
                  </button>
                </>
              )}
            </span>
          ) : (
            <>
              {/* Add ticker + Columns moved down next to the table (see the filter bar);
                  the subbar keeps account-level actions only. */}
              <button className="btn btn-secondary" onClick={syncFromSchwab} disabled={syncing}
                title="Refresh this account's holdings from Schwab">
                {syncing ? "Syncing…" : <><IconRefresh /> Sync from Schwab</>}
              </button>
              <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
                <button className={`btn btn-sm ${simple ? "btn-primary" : "btn-secondary"}`} aria-pressed={simple}
                  title={simple ? "Switch back to the full advanced view" : "Simplify the dashboard — your holdings and the essentials only"}
                  onClick={toggleSimple}>{simple ? "Simple ✓" : "Simple view"}</button>
                {!simple && <>
                <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <button className="btn btn-secondary"
                    title="Bulk buy: the next rung on dips — or select any stock (incl. ones you don't hold) to enter"
                    onClick={() => { setSelected(null); bulk.start("buy"); }}>
                    Bulk Buy · {bulk.buyCount}
                  </button>
                  <BulkGear kind="buy" />
                </span>
                <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <button className="btn btn-secondary" disabled={bulk.sellCount === 0}
                    title="Bulk sell: harvest the profitable last position on each holding, at the current price"
                    onClick={() => { setSelected(null); bulk.start("sell"); }}>
                    Bulk Sell · {bulk.sellCount}
                  </button>
                  <BulkGear kind="sell" />
                </span>
                <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <button className="btn btn-secondary" disabled={bulk.exitCount === 0}
                    title="Bulk exit ('get me out'): a good-till-canceled limit sell of each full position at its last-buy price"
                    onClick={() => { setSelected(null); bulk.start("exit"); }}>
                    Bulk Exit · {bulk.exitCount}
                  </button>
                  <BulkGear kind="exit" />
                </span>
                </>}
              </span>
            </>
          ))}
        </div>

        {mode === "demo" && (
          <div style={S.demoChip} role="status">
            <span className="tag" style={S.demoTag}>DEMO</span>
            <span style={{ flex: 1 }}>
              The numbers below are synthetic — orders won't place. Connect Schwab to see your real account.
            </span>
            <ReauthButton label="Connect Schwab" style={S.demoBtn} />
          </div>
        )}

        {view === "settings" ? (
          <Settings key={acctKey} onDirtyChange={setSettingsDirty} />
        ) : view === "profile" ? (
          <ProfilePanel acctKey={acctKey} onAccountChange={onAccountChange} />
        ) : view === "rules" ? (
          <FinancialRules key={acctKey} onDirtyChange={setSettingsDirty} />
        ) : view === "notifications" ? (
          <NotificationsTab prefill={alertPrefill} onPrefillConsumed={() => setAlertPrefill(null)} />
        ) : view === "screen" ? (
          <Screener />
        ) : view === "ledger" ? (
          <>
            {data && <SectorStrip rows={data.rows} />}
            <Ledger key={acctKey} />
          </>
        ) : view === "orders" ? (
          <Orders key={`${acctKey}:${ordersFilter ?? ""}`} initialFilter={ordersFilter ?? undefined} />
        ) : (
          <>
            {data ? (
              <>
                {pricesStale && (
                  <p style={S.staleNote} role="status">
                    <IconWarning /> Prices may be stale — Schwab isn’t responding to live requests. Reconnect under
                    Settings → Schwab connection.
                  </p>
                )}
                {!simple && (
                  <div style={S.dashSubtabs} role="tablist" aria-label="Dashboard views">
                    {([["all", "All"], ["todo", "To-Do"], ["top", "Top 10"]] as const).map(([k, label]) => (
                      <button key={k} role="tab" aria-selected={dashSub === k} className="btn btn-sm"
                        style={dashSub === k ? S.subActive : S.subIdle} onClick={() => setDashSub(k)}>
                        {label}{k === "todo" && todoRows.length ? ` · ${todoRows.length}` : ""}
                      </button>
                    ))}
                  </div>
                )}
                {dashSub === "top" && !simple ? (
                  <Top10 rows={data.rows} onSelect={(sym) => setSelected(sym === selected ? null : sym)} />
                ) : (
                  <>
                    {!simple && dashSub === "all" && (
                      <>
                        <SectorStrip rows={data.rows}
                          activeSector={sectorFilter}
                          onSectorClick={(name) => setSectorFilter((cur) => (cur === name ? null : name))} />
                        <div style={S.filterBar}>
                          {(symQuery || sectorFilter) && (
                            <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)" }}>
                              showing {dashRows.length} of {data.rows.length}
                              {symQuery && <> · <b style={{ color: "var(--text-muted)" }}>“{symQuery}”</b></>}
                            </span>
                          )}
                          {sectorFilter && (
                            <span style={S.activeFilter}>
                              Sector: <b>{sectorFilter}</b>
                              <button aria-label="Clear sector filter" style={S.filterX} onClick={() => setSectorFilter(null)}><IconClose /></button>
                            </span>
                          )}
                          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span style={S.addWrap}>
                              <input
                                className="field"
                                style={{ width: 110, height: 30 }}
                                placeholder="Add ticker"
                                aria-label="Add ticker symbol"
                                value={addSym}
                                onChange={(e) => setAddSym(e.target.value.toUpperCase())}
                                onKeyDown={(e) => e.key === "Enter" && addTicker()}
                              />
                              <button className="btn btn-secondary btn-sm" onClick={addTicker}>Add</button>
                            </span>
                            <ColumnManager prefs={dashCols} labelOf={(id) => DASH_COLUMNS[id]?.label ?? id} />
                            {paused && <span style={S.pausedChip}>paused · frozen at {pausedSince}</span>}
                            <button className="btn btn-ghost btn-sm" aria-pressed={paused}
                              title={paused ? "Resume live updates" : "Freeze the table so a quote can't shift under you"}
                              onClick={togglePause}>{paused ? "Resume" : "Pause updates"}</button>
                          </span>
                        </div>
                      </>
                    )}
                    {!simple && dashSub === "todo" && (
                      <p style={S.note}>
                        {todoRows.length
                          ? `${todoRows.length} position${todoRows.length === 1 ? "" : "s"} meeting a buy or sell signal right now.`
                          : "Nothing meets a buy or sell signal right now — you're all caught up."}
                      </p>
                    )}
                    <div style={pricesStale ? { opacity: 0.55, transition: "opacity .2s" } : undefined}>
                      <DashboardTable
                        rows={simple ? holdingsRows : (dashSub === "todo" ? todoRows : dashRows)}
                        cols={simple ? SIMPLE_COLS : dashCols.ids}
                        simple={simple}
                        selected={selected}
                        onSelect={(sym) => setSelected(sym === selected ? null : sym)}
                        onRemoveTicker={removeTicker}
                        onBuyWatch={buyWatch}
                        onAlert={onAlert}
                        bulk={bulk.bulkUI}
                        signalRules={signalRules}
                        working={workingBySym}
                        onShowOrders={(sym) => { setOrdersFilter(sym); guardedNav(() => setView("orders")); }}
                        renderDetail={(sym) => (
                          <PositionDetail symbol={sym} mode={mode} onClose={() => setSelected(null)} embedded />
                        )}
                      />
                    </div>
                  </>
                )}
              </>
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
            buyingPower={bulk.buyingPower}
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

        {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}
      </div>
    </main>
    </NotificationsProvider>
  );
}

// Keyboard-shortcut cheat sheet (toggled with "?"). Reuses the modal overlay styling.
function HelpOverlay({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ...NAV.map((t, i) => [String(i + 1), `Go to ${t.label}`] as [string, string]),
    ["g then d/s/l/o/r", "Jump to a tab (vim-style)"],
    ["Ctrl/Cmd + F", "Find a ticker (dashboard)"],
    ["?", "Show / hide this help"],
    ["Esc", "Close dialogs"],
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()} style={{ padding: 20, maxWidth: 380 }}>
        <div style={{ fontSize: "var(--fs-lg)", fontWeight: 600, marginBottom: 12 }}>Keyboard shortcuts</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map(([k, label]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "var(--fs-sm)" }}>
              <span style={{ color: "var(--text-muted)" }}>{label}</span>
              <kbd style={S.kbd}>{k}</kbd>
            </div>
          ))}
        </div>
        <p style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)", marginTop: 14 }}>
          Shortcuts are ignored while you're typing in a field or a dialog is open.
        </p>
        <button className="btn btn-secondary" style={{ marginTop: 14, width: "100%" }} onClick={onClose}>Close</button>
      </div>
    </div>
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

function KPI({ label, value, n, color, first, hint }: { label: string; value: string; n?: number | null; color?: string; first?: boolean; hint?: string }) {
  // `color` (explicit) wins; otherwise derive from the sign of `n` (▲/▼ signed metric).
  const c = color ?? (n == null || n === 0 ? "var(--text)" : n > 0 ? "var(--pos)" : "var(--neg)");
  return (
    <div style={{ ...S.kpi, ...(first ? { borderLeft: "none" } : null), ...(hint ? { cursor: "help" } : null) }} title={hint}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiVal, color: c }}>
        {n != null && n !== 0 && <span aria-hidden="true" style={{ fontSize: "0.68em", marginRight: 3 }}>{n > 0 ? "▲" : "▼"}</span>}
        {value}
      </div>
    </div>
  );
}

// Top 10 — quick glance at the day's most actionable names. Two lists from the held rows:
// deepest dips (lowest LILO %, i.e. most below the last buy → buy-worthy) and biggest
// last-position gains (profit ÷ cost → sell-worthy). Both clickable to drill in.
function Top10({ rows, onSelect }: { rows: DashboardRow[]; onSelect: (s: string) => void }) {
  const held = rows.filter((r) => !r.is_watch);
  const dips = held
    .filter((r) => r.lilo_pct != null)
    .sort((a, b) => (a.lilo_pct as number) - (b.lilo_pct as number))
    .slice(0, 10);
  const gainPct = (r: DashboardRow) =>
    r.last_pos_profit != null && r.last_pos_cost ? (r.last_pos_profit / r.last_pos_cost) * 100 : null;
  const gainers = held
    .filter((r) => gainPct(r) != null)
    .sort((a, b) => (gainPct(b) as number) - (gainPct(a) as number))
    .slice(0, 10);

  const Sym = ({ r }: { r: DashboardRow }) => (
    <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px", fontWeight: 700, color: tickerRiskColor(r.risk) }}
      onClick={() => onSelect(r.symbol)}>{r.symbol}</button>
  );

  return (
    <div style={S.top10grid}>
      <section className="panel" style={{ padding: 14 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: "var(--fs-md)" }}>Top dips — buy-worthy</h3>
        {dips.length ? (
          <table className="tbl">
            <thead><tr><th style={{ textAlign: "left" }}>Ticker</th><th style={{ textAlign: "right" }}>Price</th><th style={{ textAlign: "right" }}>LILO</th></tr></thead>
            <tbody>
              {dips.map((r) => (
                <tr key={r.symbol}>
                  <td><Sym r={r} /></td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{usd(r.price)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-muted)" }}>{pct(r.lilo_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p style={S.note}>No priced positions yet.</p>}
      </section>
      <section className="panel" style={{ padding: 14 }}>
        <h3 style={{ margin: "0 0 8px", fontSize: "var(--fs-md)" }}>Top gainers — sell-worthy</h3>
        {gainers.length ? (
          <table className="tbl">
            <thead><tr><th style={{ textAlign: "left" }}>Ticker</th><th style={{ textAlign: "right" }}>Price</th><th style={{ textAlign: "right" }}>Last-pos gain</th></tr></thead>
            <tbody>
              {gainers.map((r) => {
                const g = gainPct(r) as number;
                return (
                  <tr key={r.symbol}>
                    <td><Sym r={r} /></td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{usd(r.price)}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", color: g >= 0 ? "var(--pos)" : "var(--neg)" }}>
                      {g >= 0 ? "+" : ""}{g.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p style={S.note}>No priced positions yet.</p>}
      </section>
    </div>
  );
}

export const usd = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${(n * 100).toFixed(2)}%`;

const S: Record<string, React.CSSProperties> = {
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, rowGap: 12, flexWrap: "wrap" },
  brandZone: { display: "flex", alignItems: "center", gap: 14, minWidth: 0, flexWrap: "wrap", rowGap: 10 },
  h1: { fontSize: "var(--fs-xl)", fontWeight: 700, margin: 0, letterSpacing: "-0.01em", whiteSpace: "nowrap" },
  nav: { display: "flex", gap: 4 },
  navBadge: { marginLeft: 6, background: "var(--warn)", color: "#1a1a1a", fontSize: "var(--fs-2xs)", fontWeight: 700, borderRadius: "var(--r-pill)", padding: "0 6px", lineHeight: 1.6 },
  rightZone: { display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", justifyContent: "flex-end" },
  statusZone: { display: "flex", alignItems: "center", gap: 10 },
  statusItem: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--fs-xs)", color: "var(--text-dim)", whiteSpace: "nowrap" },
  dot: { width: 7, height: 7, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  kpiZone: { display: "flex", alignItems: "center", gap: 2 },
  kpiCluster: { display: "flex", alignItems: "stretch", border: "1px solid var(--border)", borderRadius: "var(--r-md)", overflow: "hidden" },
  kpi: { padding: "3px 14px", borderLeft: "1px solid var(--border-hairline)" },
  kpiLabel: { fontSize: "var(--fs-2xs)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)" },
  kpiVal: { fontSize: "var(--fs-lg)", fontWeight: 600, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center" },
  kpiHero: { fontSize: "var(--fs-2xl)", fontWeight: 700, fontVariantNumeric: "tabular-nums", display: "flex", alignItems: "center", lineHeight: 1.1 },
  subbar: { display: "flex", alignItems: "center", gap: 16, marginTop: 18, flexWrap: "wrap" },
  // Floating browser-style find bar (Ctrl/Cmd+F). Fixed top-right, above content.
  findBar: { position: "fixed", top: 14, right: 18, zIndex: 60,
    display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 12px",
    background: "var(--pop)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-md)",
    boxShadow: "var(--shadow-pop)" },
  findInput: { border: "none", background: "transparent", color: "var(--text)", font: "inherit",
    fontSize: "var(--fs-sm)", outline: "none", width: 170, height: 26 },
  findCount: { fontSize: "var(--fs-2xs)", color: "var(--text-faint)", whiteSpace: "nowrap", minWidth: 62, textAlign: "right" },
  bulkBar: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  addWrap: { display: "flex", gap: 6, alignItems: "center" },
  note: { color: "var(--text-muted)", fontSize: "var(--fs-md)", marginTop: 16 },
  demoChip: { display: "flex", alignItems: "center", gap: 10, margin: "12px 0 2px", padding: "8px 12px",
    background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-md)",
    color: "var(--text-muted)", fontSize: "var(--fs-sm)" },
  demoTag: { color: "var(--warn)", border: "1px solid var(--warn-border)", fontWeight: 700, letterSpacing: "0.05em" },
  demoBtn: { flexShrink: 0 },
  staleNote: { color: "var(--warn)", fontSize: "var(--fs-sm)", margin: "0 0 10px", lineHeight: 1.45 },
  filterBar: { display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px", flexWrap: "wrap" },
  activeFilter: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", color: "var(--text-muted)", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: "2px 10px" },
  filterX: { background: "transparent", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "var(--fs-xs)", padding: 0 },
  pausedChip: { fontSize: "var(--fs-2xs)", color: "var(--warn)", border: "1px solid var(--warn-border)", borderRadius: "var(--r-pill)", padding: "1px 9px", textTransform: "uppercase", letterSpacing: "0.04em" },
  dashSubtabs: { display: "inline-flex", gap: 4, margin: "0 0 14px", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: 3 },
  subActive: { border: "none", background: "var(--accent)", color: "#0b0e13", fontWeight: 700, borderRadius: "var(--r-pill)" },
  subIdle: { border: "none", background: "transparent", color: "var(--text-muted)", borderRadius: "var(--r-pill)" },
  top10grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 },
  kbd: { fontFamily: "monospace", fontSize: "var(--fs-xs)", background: "var(--panel-2)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)", padding: "1px 8px", color: "var(--text)", minWidth: 22, textAlign: "center" },
};
