"""Live quote pipe: Schwab streamer -> in-memory hub -> browser websockets.

If no Schwab token is present yet, this runs in DEMO mode (synthetic random-walk
quotes) so the websocket -> browser pipe is verifiable before you authorize.
Once token.json exists, it streams real level-one equity quotes.
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
from datetime import datetime, timezone

from . import auth
from ..config import settings
from .auth import get_client

log = logging.getLogger(__name__)


def _is_auth_error(e: Exception) -> bool:
    """A stream failure that means the TOKEN is bad (vs a transient network/maintenance
    drop) — so we can flip liveness to 'not live' immediately instead of masking it."""
    s = repr(e).lower()
    return any(k in s for k in ("oauth", "unsupported_token_type", "unauthor", "401", "invalid_grant", "reauth"))


class QuoteHub:
    """Fan-out of quote dicts to any number of subscribed websocket clients."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self.mode: str = "starting"
        self.latest: dict[str, dict] = {}  # symbol -> last quote

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def publish(self, quote: dict) -> None:
        # MERGE into the last-known quote rather than replace it. Schwab's level-one
        # stream sends PARTIAL updates (only changed fields), so a tick that omits
        # LAST_PRICE arrives here as last=None. Replacing would blank the price (and
        # 52-wk high, etc.) until the next trade prints — the "flicker to —" bug.
        # Keeping the last known value for any field a partial update omits means
        # the numbers stay on screen and just update in place.
        sym = quote.get("symbol")
        if not sym:
            return
        prev = self.latest.get(sym)
        if prev is None:
            merged = dict(quote)
        else:
            merged = dict(prev)
            for k, v in quote.items():
                if v is not None or k not in merged:
                    merged[k] = v
        self.latest[sym] = merged
        for q in list(self._subscribers):
            try:
                q.put_nowait(merged)
            except asyncio.QueueFull:
                pass  # slow client; drop the tick


hub = QuoteHub()

_stream = None                 # live schwab StreamClient (for dynamic subscribe)
_demo_prices: dict[str, float] = {}  # demo mode's mutable symbol set

# ACCT_ACTIVITY is used only as a low-latency POKE to re-sync fills from REST
# (its MESSAGE_DATA schema is undocumented + the stream can drop) — never as the
# authoritative source. The handler runs inside the quote loop, so it must NOT
# block: it just drops a token on this queue for run_activity_resync() to drain.
_activity_q: asyncio.Queue = asyncio.Queue(maxsize=1000)


def _activity_handler(msg: dict) -> None:
    try:
        _activity_q.put_nowait(True)
    except asyncio.QueueFull:
        pass  # a resync is already pending; this poke is redundant


def poke_resync() -> None:
    """Trigger the fill re-sync loop NOW — call after WE place/cancel an order so the
    rebuild doesn't wait for Schwab's ACCT_ACTIVITY stream poke (which can lag or drop)."""
    try:
        _activity_q.put_nowait(True)
    except asyncio.QueueFull:
        pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _held_symbols() -> list[str]:
    """Symbols to stream: held + watchlist tickers (DB) ∪ active-alert symbols
    ∪ the .env watchlist. (Alert symbols must stream or the alert never fires.)"""
    from sqlalchemy import select

    from ..db import SessionLocal
    from ..db.models import PriceAlert, Ticker

    symbols = set(settings.watchlist_symbols)
    try:
        async with SessionLocal() as s:
            rows = await s.execute(select(Ticker.symbol))
            symbols.update(r[0] for r in rows)
            alert_rows = await s.execute(
                select(PriceAlert.symbol).where(PriceAlert.active.is_(True))
            )
            symbols.update(r[0] for r in alert_rows)
    except Exception as e:
        log.warning(f"could not load symbols from DB: {e!r}")
    return sorted(symbols)


async def subscribe(symbol: str) -> bool:
    """Add a symbol to the LIVE quote feed (dynamic). Best-effort: on failure the
    symbol is still persisted and gets subscribed on the next restart."""
    symbol = symbol.upper()
    if hub.mode == "demo":
        _demo_prices.setdefault(symbol, random.uniform(10, 120))
        return True
    if _stream is not None:
        try:
            await _stream.level_one_equity_add([symbol])
            return True
        except Exception as e:
            log.warning(f"dynamic add failed for {symbol}: {e!r}")
    return False


async def _demo_stream(symbols: list[str]) -> None:
    """Synthetic quotes so the UI is verifiable before OAuth."""
    hub.mode = "demo"
    _demo_prices.update({s: random.uniform(10, 120) for s in symbols})
    while True:
        for sym in list(_demo_prices):
            px = max(0.5, _demo_prices[sym] * (1 + random.uniform(-0.004, 0.004)))
            _demo_prices[sym] = px
            hub.publish({"symbol": sym, "last": round(px, 4), "source": "demo", "ts": _now()})
        await asyncio.sleep(1.0)


def _normalize(symbol: str, content: dict) -> dict:
    """Map a schwab-py level-one equity message to our quote shape."""
    def g(*keys):
        for k in keys:
            if k in content and content[k] is not None:
                return content[k]
        return None

    return {
        "symbol": symbol,
        "last": g("LAST_PRICE", "MARK", "3"),
        "netChange": g("NET_CHANGE"),
        "dayHigh": g("HIGH_PRICE"),
        "dayLow": g("LOW_PRICE"),
        "yearHigh": g("HIGH_PRICE_52_WEEK"),
        "yearLow": g("LOW_PRICE_52_WEEK"),
        "bid": g("BID_PRICE"),
        "ask": g("ASK_PRICE"),
        "source": "schwab",
        "ts": _now(),
    }


async def _schwab_stream(client, symbols: list[str]) -> None:
    global _stream
    from schwab.streaming import StreamClient

    stream = StreamClient(client)
    await stream.login()
    hub.mode = "schwab"
    auth.note_stream_live()  # login succeeded → the token is provably good right now
    _stream = stream  # expose for dynamic subscribe()

    def handler(msg: dict) -> None:
        for item in msg.get("content", []):
            sym = item.get("key")
            if sym:
                hub.publish(_normalize(sym, item))

    stream.add_level_one_equity_handler(handler)
    await stream.level_one_equity_subs(symbols)

    # Subscribe to account activity as a fill re-sync trigger. Best-effort: if it
    # fails, quotes must still flow, so never let it propagate out of here.
    try:
        stream.add_account_activity_handler(_activity_handler)
        await stream.account_activity_sub()
        log.info("subscribed to ACCT_ACTIVITY (fill re-sync trigger)")
    except Exception as e:
        log.warning(f"account-activity subscribe failed (quotes unaffected): {e!r}")

    try:
        while True:
            await stream.handle_message()
    finally:
        _stream = None


async def run_quote_stream() -> None:
    """Entry point started on app startup. Picks real or demo mode.

    With NO client (profile not connected), run synthetic DEMO quotes — nothing can
    place orders anyway. With a client, NEVER fall into synthetic demo: the account
    is live and demo would publish random-walk prices into hub.latest, which the
    dashboard AND bulk plans read as 'current price'. Instead retry the real stream
    with capped exponential backoff — this also self-heals transient failures like
    Schwab's overnight maintenance window (login rejected -> reconnects when it
    ends) and mid-day websocket drops."""
    symbols = await _held_symbols()
    client = None
    try:
        client = get_client()
    except Exception as e:  # malformed/expired token, etc.
        log.warning(f"could not load Schwab client: {e!r}")

    if client is None:
        log.info("no Schwab token -> DEMO mode. "
                 "Connect a profile in Settings for live data.")
        await _demo_stream(symbols)
        return

    backoff = 5.0
    while True:
        started = time.monotonic()
        try:
            await _schwab_stream(client, symbols)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            if _is_auth_error(e):
                auth.note_stream_auth_error()  # token is bad — reflect it in the banner now
                hub.mode = "reauth"            # stop showing "connecting…" forever; it's rejected
            log.warning(f"Schwab stream error ({e!r}); reconnecting in {backoff:.0f}s")
        if time.monotonic() - started > 120:
            backoff = 5.0  # it ran healthily for a while — treat the next drop as fresh
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, 60.0)
        # Re-resolve for the next attempt: the token may have been refreshed or
        # re-authorized (get_client returns the current cached client), and the
        # watch/held set may have changed while we were down.
        try:
            client = get_client() or client
        except Exception:
            log.debug("client re-resolve failed; keeping previous client", exc_info=True)
        symbols = await _held_symbols()


async def run_activity_resync() -> None:
    """Drain account-activity pokes: debounce a burst, then re-sync the trading
    account's fills from REST → rebuild its lots. REST is the source of truth;
    this just makes the rebuild near-real-time. Started in main.py lifespan."""
    while True:
        try:
            await _activity_q.get()
            await asyncio.sleep(3.0)  # debounce burst + let REST begin to settle
            while not _activity_q.empty():
                _activity_q.get_nowait()

            from .. import accounts as accounts_svc
            from .. import rebuild as rebuild_svc

            target = await accounts_svc.get_trading_account()
            if not target:
                continue  # no trading-enabled account selected → nothing to sync
            # Two passes: ACCT_ACTIVITY can arrive before the fill is visible in the
            # REST orders endpoint, so re-sync once more after a short delay. The
            # rebuild is idempotent, so a redundant second pass is harmless.
            await rebuild_svc.resync_account(target)
            await asyncio.sleep(4.0)
            await rebuild_svc.resync_account(target)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # never let one bad poke kill the loop
            log.warning(f"[resync] failed: {e!r}")
            try:
                _activity_q.put_nowait(True)  # re-arm so the trigger isn't lost
            except asyncio.QueueFull:
                pass
            await asyncio.sleep(3.0)
