import { useEffect, useRef, useState } from "react";
import { AccountPicker } from "./AccountPicker";
import { AuthBanner, LiveStatusPill, useLiveness } from "./AuthBanner";
import { UpdateBanner } from "./UpdateBanner";
import { SectorStrip } from "./SectorStrip";
import type { SignalRule } from "./signals";
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
  const [showHelp, setShowHelp] = useState(false);
  const [symQuery, setSymQuery] = useState("");        // "/" jump-to filter (by ticker)
  const [sectorFilter, setSectorFilter] = useState<string | null>(null); // click a sector chip
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
  const toast = useToast();
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const [workingOrders, setWorkingOrders] = useState(0);
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

  // Keyboard shortcuts: digits 1..N jump to a tab (through the same dirty-settings guard),
  // "?" toggles the help overlay. Ignored while typing in a field or when a modal is open,
  // so it never fights with order tickets, search boxes, or dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      if (e.key === "/" && view === "dashboard") { e.preventDefault(); symInputRef.current?.focus(); return; }
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
                {cashInfo?.cash != null && (
                  <KPI
                    label="Cash"
                    value={usd(cashInfo.cash)}
                    hint={`Buying power ${usd(cashInfo.buying_power)}${cashInfo.margin_buying_power != null ? ` (incl. margin ${usd(cashInfo.margin_buying_power)})` : ""} — settled cash plus available margin. Fluctuates intraday.`}
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

        <UpdateBanner />
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
              <>
                {pricesStale && (
                  <p style={S.staleNote} role="status">
                    ⚠ Prices may be stale — Schwab isn’t responding to live requests. Reconnect under
                    Settings → Schwab connection.
                  </p>
                )}
                <SectorStrip rows={data.rows}
                  activeSector={sectorFilter}
                  onSectorClick={(name) => setSectorFilter((cur) => (cur === name ? null : name))} />
                <div style={S.filterBar}>
                  <input ref={symInputRef} className="field" value={symQuery} placeholder="Jump to ticker  ( / )"
                    aria-label="Filter positions by ticker" style={{ height: 30, width: 190 }}
                    onChange={(e) => setSymQuery(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === "Escape") { setSymQuery(""); e.currentTarget.blur(); } }} />
                  {symQuery && <button className="btn btn-ghost btn-sm" onClick={() => setSymQuery("")}>clear</button>}
                  {(symQuery || sectorFilter) && (
                    <span style={{ color: "var(--text-faint)", fontSize: "var(--fs-xs)" }}>
                      showing {dashRows.length} of {data.rows.length}
                    </span>
                  )}
                  {sectorFilter && (
                    <span style={S.activeFilter}>
                      Sector: <b>{sectorFilter}</b>
                      <button aria-label="Clear sector filter" style={S.filterX} onClick={() => setSectorFilter(null)}>✕</button>
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {paused && <span style={S.pausedChip}>paused · frozen at {pausedSince}</span>}
                    <button className="btn btn-ghost btn-sm" aria-pressed={paused}
                      title={paused ? "Resume live updates" : "Freeze the table so a quote can't shift under you"}
                      onClick={togglePause}>{paused ? "Resume" : "Pause updates"}</button>
                  </span>
                </div>
                <div style={pricesStale ? { opacity: 0.55, transition: "opacity .2s" } : undefined}>
                  <DashboardTable
                    rows={dashRows}
                    cols={dashCols.ids}
                    selected={selected}
                    onSelect={(sym) => setSelected(sym === selected ? null : sym)}
                    onRemoveTicker={removeTicker}
                    onBuyWatch={buyWatch}
                    onAlert={onAlert}
                    bulk={bulk.bulkUI}
                    signalRules={signalRules}
                    renderDetail={(sym) => (
                      <PositionDetail symbol={sym} mode={mode} onClose={() => setSelected(null)} embedded />
                    )}
                  />
                </div>
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
  );
}

// Keyboard-shortcut cheat sheet (toggled with "?"). Reuses the modal overlay styling.
function HelpOverlay({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ...NAV.map((t, i) => [String(i + 1), `Go to ${t.label}`] as [string, string]),
    ["g then d/s/l/o/r", "Jump to a tab (vim-style)"],
    ["/", "Jump to a ticker (dashboard)"],
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
  staleNote: { color: "var(--warn)", fontSize: "var(--fs-sm)", margin: "0 0 10px", lineHeight: 1.45 },
  filterBar: { display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px" },
  activeFilter: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--fs-xs)", color: "var(--text-muted)", background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--r-pill)", padding: "2px 10px" },
  filterX: { background: "transparent", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "var(--fs-xs)", padding: 0 },
  pausedChip: { fontSize: "var(--fs-2xs)", color: "var(--warn)", border: "1px solid var(--warn-border)", borderRadius: "var(--r-pill)", padding: "1px 9px", textTransform: "uppercase", letterSpacing: "0.04em" },
  kbd: { fontFamily: "monospace", fontSize: "var(--fs-xs)", background: "var(--panel-2)", border: "1px solid var(--border-strong)", borderRadius: "var(--r-sm)", padding: "1px 8px", color: "var(--text)", minWidth: 22, textAlign: "center" },
};
