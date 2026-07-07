"""Per-account app_setting JSON stores: custom signal rules, ETF→underlying link
overrides, symbol journal notes, and last-held prices."""
from __future__ import annotations

import json as _json
import logging

from ..db import SessionLocal, dialect_insert as pg_insert
from ..db.models import AppSetting

log = logging.getLogger(__name__)

_LASTHELD_KEY = "last_held:"  # + account_hash → JSON {SYMBOL: price} (last held price at sell-out)


async def get_last_held(account_hash: str) -> dict:
    async with SessionLocal() as s:
        row = await s.get(AppSetting, _LASTHELD_KEY + account_hash)
    try:
        d = _json.loads(row.value) if row and row.value else {}
    except Exception as e:
        log.warning(f"stored last-held blob for {account_hash[-4:]} is unreadable — treating as empty: {e!r}")
        d = {}
    return d if isinstance(d, dict) else {}


async def set_last_held(account_hash: str, prices: dict) -> None:
    """Merge {SYMBOL: price} for positions just sold out (so a watch row can show the
    last held price). Per account, app_setting JSON — no migration."""
    if not prices:
        return
    cur = await get_last_held(account_hash)
    cur.update({k.upper(): round(float(v), 4) for k, v in prices.items() if v})
    async with SessionLocal() as s:
        await s.execute(
            pg_insert(AppSetting).values(key=_LASTHELD_KEY + account_hash, value=_json.dumps(cur))
            .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": _json.dumps(cur)})
        )
        await s.commit()


_SIGNAL_RULES_KEY = "signal_rules:"  # + account_hash → JSON list of custom signal rules


async def get_signal_rules(account_hash: str) -> list:
    """User-defined EXTRA signal rules (OR'd with the built-in strategy buy/sell marks).
    Each: {id, side, metric, op, value, color, label, enabled}. Evaluated client-side."""
    async with SessionLocal() as s:
        row = await s.get(AppSetting, _SIGNAL_RULES_KEY + account_hash)
    try:
        rules = _json.loads(row.value) if row and row.value else []
    except Exception as e:
        log.warning(f"stored signal-rules blob for {account_hash[-4:]} is unreadable — treating as empty: {e!r}")
        rules = []
    return rules if isinstance(rules, list) else []


async def set_signal_rules(account_hash: str, rules: list) -> dict:
    """Validate + persist the extra signal rules (cap 20; sanitize each field)."""
    clean = []
    for r in (rules or [])[:20]:
        if not isinstance(r, dict):
            continue
        try:
            val = float(r.get("value") or 0)
        except (TypeError, ValueError):
            val = 0.0
        clean.append({
            "id": str(r.get("id") or "")[:40],
            "side": "buy" if r.get("side") == "buy" else "sell",
            "metric": str(r.get("metric") or "")[:40],
            "op": "<=" if r.get("op") == "<=" else ">=",
            "value": round(val, 4),
            "color": str(r.get("color") or "#c9a227")[:16],
            "label": str(r.get("label") or "")[:24],
            "enabled": bool(r.get("enabled", True)),
        })
    async with SessionLocal() as s:
        await s.execute(
            pg_insert(AppSetting).values(key=_SIGNAL_RULES_KEY + account_hash, value=_json.dumps(clean))
            .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": _json.dumps(clean)})
        )
        await s.commit()
    return {"ok": True, "rules": clean}


_ETF_LINKS_KEY = "etf_links:"  # + account_hash → JSON {ETF_SYMBOL: UNDERLYING_SYMBOL} manual overrides


async def get_etf_links(account_hash: str) -> dict:
    """Manual ETF→underlying overrides for this account: {ETF: UNDERLYING}. Authoritative
    over name-based auto-detection (used when the ETF name isn't available or is wrong)."""
    async with SessionLocal() as s:
        row = await s.get(AppSetting, _ETF_LINKS_KEY + account_hash)
    try:
        links = _json.loads(row.value) if row and row.value else {}
    except Exception as e:
        log.warning(f"stored ETF-links blob for {account_hash[-4:]} is unreadable — treating as empty: {e!r}")
        links = {}
    return links if isinstance(links, dict) else {}


async def set_etf_link(account_hash: str, etf: str, underlying: str | None) -> dict:
    """Set (or, with a blank/None/self underlying, clear) one ETF→underlying override."""
    etf = (etf or "").strip().upper()
    if not etf:
        return {"ok": False, "error": "missing ETF symbol"}
    links = await get_etf_links(account_hash)
    und = (underlying or "").strip().upper()
    if und and und != etf:
        links[etf] = und
    else:
        links.pop(etf, None)   # clear the override
    # Sanitize + cap.
    links = {str(k)[:16]: str(v)[:16] for k, v in list(links.items())[:200]}
    async with SessionLocal() as s:
        await s.execute(
            pg_insert(AppSetting).values(key=_ETF_LINKS_KEY + account_hash, value=_json.dumps(links))
            .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": _json.dumps(links)})
        )
        await s.commit()
    return {"ok": True, "links": links}


_NOTES_KEY = "notes:"  # + account_hash → JSON {SYMBOL: text}
_NOTES_MAX_SYMBOLS = 500  # cap the blob; a note is user data, so refuse (don't trim)


async def get_notes(account_hash: str) -> dict:
    async with SessionLocal() as s:
        row = await s.get(AppSetting, _NOTES_KEY + account_hash)
    try:
        notes = _json.loads(row.value) if row and row.value else {}
    except Exception as e:
        log.warning(f"stored notes blob for {account_hash[-4:]} is unreadable — treating as empty: {e!r}")
        notes = {}
    return notes if isinstance(notes, dict) else {}


async def get_note(account_hash: str, symbol: str) -> str:
    return (await get_notes(account_hash)).get(symbol.upper(), "")


async def set_note(account_hash: str, symbol: str, text: str) -> dict:
    """Free-text thesis/journal note for a symbol (per account, app_setting JSON). Empty
    clears it. Capped so a runaway paste can't bloat the row."""
    # The cap is read off the PACKAGE at call time (not this module's global) so
    # `app.ledger._NOTES_MAX_SYMBOLS` stays the single patchable knob it was when
    # ledger was one module.
    from . import _NOTES_MAX_SYMBOLS

    notes = await get_notes(account_hash)
    sym = symbol.upper()
    clean = (text or "").strip()[:2000]
    if clean:
        # Updates and deletes always work; only a NET-NEW symbol past the cap is
        # refused — silently dropping someone's oldest thesis would be data loss.
        if sym not in notes and len(notes) >= _NOTES_MAX_SYMBOLS:
            return {"ok": False,
                    "error": f"note limit reached ({_NOTES_MAX_SYMBOLS} symbols) — clear an old note first"}
        notes[sym] = clean
    else:
        notes.pop(sym, None)
    async with SessionLocal() as s:
        await s.execute(
            pg_insert(AppSetting).values(key=_NOTES_KEY + account_hash, value=_json.dumps(notes))
            .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": _json.dumps(notes)})
        )
        await s.commit()
    return {"ok": True, "note": clean}
