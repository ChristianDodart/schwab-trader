"""Per-account configuration: strategy (full LIFO config), trading enablement,
tax settings, and PER-SYMBOL rule overrides. Strategy is stored as JSON per
account; NULL => YAML defaults. Auto-creates a row on first access.
"""
from __future__ import annotations

import json
import logging
from dataclasses import replace as _dc_replace

from .db import SessionLocal, dialect_insert as _insert
from .db.models import AccountConfig, AppSetting
from .strategy import StrategyConfig
from .strategy.config import SellConfig

log = logging.getLogger(__name__)

_DEFAULTS = StrategyConfig.load()


async def _ensure(account_hash: str) -> AccountConfig:
    # New accounts are born trading-DISABLED — trading is an explicit per-account
    # opt-in via the Settings toggle (never auto-enabled by account type).
    async with SessionLocal() as s:
        row = await s.get(AccountConfig, account_hash)
        if row is None:
            # Atomic seed: two concurrent callers (get_config + trading_enabled on the
            # same tick) would otherwise both INSERT the same PK → IntegrityError.
            from .db import dialect_insert
            await s.execute(
                dialect_insert(AccountConfig).values(account_hash=account_hash)
                .on_conflict_do_nothing(index_elements=[AccountConfig.account_hash])
            )
            await s.commit()
            row = await s.get(AccountConfig, account_hash)
        return row


# Cache the PARSED strategy per account, keyed by the raw strategy_json string. The
# DB row is still read every call (so external edits take effect), but the JSON parse
# + StrategyConfig build (run ~1x/sec in the dashboard/position hot paths) is skipped
# when the stored JSON is unchanged.
_parsed_cache: dict[str, tuple[str | None, StrategyConfig]] = {}


async def get_strategy(account_hash: str | None) -> StrategyConfig:
    if not account_hash:
        return _DEFAULTS
    row = await _ensure(account_hash)
    if not row.strategy_json:
        return _DEFAULTS
    cached = _parsed_cache.get(account_hash)
    if cached and cached[0] == row.strategy_json:
        return cached[1]
    try:
        cfg = StrategyConfig.from_mapping(json.loads(row.strategy_json))
    except Exception as e:
        log.warning(f"stored strategy JSON for {account_hash[-4:]} is unreadable — using defaults: {e!r}")
        return _DEFAULTS
    _parsed_cache[account_hash] = (row.strategy_json, cfg)
    return cfg


async def trading_enabled(account_hash: str | None) -> bool:
    if not account_hash:
        return False
    return bool((await _ensure(account_hash)).trading_enabled)


def _no_account_config() -> dict:
    return {
        "account_hash": "", "trading_enabled": False, "tax_filing": "single",
        "tax_state_rate": 0.045, "year_end_goal": None, "other_annual_income": None,
        "strategy": _DEFAULTS.to_mapping(), "strategy_is_default": True,
    }


async def get_config(account_hash: str) -> dict:
    if not account_hash:  # no account selected -> don't create a junk "" row
        return _no_account_config()
    row = await _ensure(account_hash)
    strat = await get_strategy(account_hash)
    return {
        "account_hash": account_hash,
        "trading_enabled": row.trading_enabled,
        "tax_filing": row.tax_filing,
        "tax_state_rate": float(row.tax_state_rate),
        "year_end_goal": float(row.year_end_goal) if row.year_end_goal is not None else None,
        "other_annual_income": float(row.other_annual_income) if row.other_annual_income is not None else None,
        "strategy": strat.to_mapping(),
        "strategy_is_default": row.strategy_json is None,
    }


# --- Per-symbol rule overrides -----------------------------------------------
# A ticker can override the GLOBAL strategy's sell target and/or its dip depth —
# "Disney wants smaller percentages than a 2x ETF". Stored per account in
# app_setting JSON (no migration): {SYM: {sell_mode, sell_value, dip_scale}}.
#   sell_mode  : "dollar_gain" | "pct_above"; sell_value in $ or FRACTION (0.05 = 5%)
#   dip_scale  : multiplies every ladder drop_pct (0.5 = half-depth dips), 0.1–3.0
# Everything downstream (buy triggers, sell marks, detail ladder, projections,
# strategy-trigger notifications) flows through apply_symbol_override().

_SYMBOL_RULES_KEY = "symbol_rules:"   # + account_hash


def _sanitize_override(ov: dict) -> dict | None:
    out: dict = {}
    mode = ov.get("sell_mode")
    try:
        val = float(ov.get("sell_value") or 0)
    except (TypeError, ValueError):
        val = 0.0
    if mode in ("dollar_gain", "pct_above") and val > 0:
        out["sell_mode"] = mode
        out["sell_value"] = round(val, 6)
    try:
        scale = float(ov.get("dip_scale") or 0)
    except (TypeError, ValueError):
        scale = 0.0
    if scale > 0 and abs(scale - 1.0) > 1e-9:
        out["dip_scale"] = max(0.1, min(3.0, round(scale, 4)))
    return out or None


def apply_symbol_override(cfg: StrategyConfig, ov: dict | None) -> StrategyConfig:
    """Pure: the EFFECTIVE strategy for one symbol — the global config with this
    symbol's overrides applied. No override (or an empty one) returns cfg as-is."""
    if not ov:
        return cfg
    out = cfg
    mode = ov.get("sell_mode")
    val = ov.get("sell_value")
    if mode in ("dollar_gain", "pct_above") and val:
        out = _dc_replace(out, sell=SellConfig(
            default_mode=mode,
            dollar_gain=float(val) if mode == "dollar_gain" else cfg.sell.dollar_gain,
            pct_above=float(val) if mode == "pct_above" else cfg.sell.pct_above,
        ))
    scale = ov.get("dip_scale")
    if scale and float(scale) > 0:
        s = max(0.1, min(3.0, float(scale)))
        out = _dc_replace(out, ladder_drops=tuple(
            _dc_replace(d, drop_pct=round(d.drop_pct * s, 6)) for d in cfg.ladder_drops
        ))
    return out


async def get_symbol_overrides(account_hash: str) -> dict:
    """{SYMBOL: override} for the account. Empty when none set."""
    if not account_hash:
        return {}
    async with SessionLocal() as s:
        row = await s.get(AppSetting, _SYMBOL_RULES_KEY + account_hash)
    try:
        data = json.loads(row.value) if row and row.value else {}
    except Exception as e:
        log.warning(f"stored symbol-override JSON for {account_hash[-4:]} is unreadable — ignoring: {e!r}")
        data = {}
    return data if isinstance(data, dict) else {}


async def set_symbol_override(account_hash: str, symbol: str, ov: dict | None) -> dict:
    """Set (or clear, with None/empty) one symbol's override. Returns all overrides."""
    symbol = (symbol or "").strip().upper()
    if not account_hash or not symbol:
        return {"ok": False, "error": "missing account or symbol"}
    rules = await get_symbol_overrides(account_hash)
    clean = _sanitize_override(ov or {})
    if clean:
        rules[symbol] = clean
    else:
        rules.pop(symbol, None)
    rules = {str(k)[:16]: v for k, v in list(rules.items())[:200]}
    payload = json.dumps(rules)
    async with SessionLocal() as s:
        await s.execute(
            _insert(AppSetting).values(key=_SYMBOL_RULES_KEY + account_hash, value=payload)
            .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": payload})
        )
        await s.commit()
    return {"ok": True, "rules": rules}


# Sentinel so callers can explicitly CLEAR a nullable field (set it to None) vs.
# "don't touch it" (omit the kwarg). None means clear; _UNSET means leave as-is.
_UNSET = object()


async def set_config(account_hash: str, *, trading_enabled=None, tax_filing=None,
                     tax_state_rate=None, strategy=None,
                     year_end_goal=_UNSET, other_annual_income=_UNSET) -> dict:
    if not account_hash:
        return _no_account_config()
    await _ensure(account_hash)
    async with SessionLocal() as s:
        row = await s.get(AccountConfig, account_hash)
        if trading_enabled is not None:
            row.trading_enabled = bool(trading_enabled)
        if tax_filing is not None:
            row.tax_filing = tax_filing
        if tax_state_rate is not None:
            row.tax_state_rate = tax_state_rate
        if year_end_goal is not _UNSET:
            row.year_end_goal = year_end_goal  # may be a float or None (clear)
        if other_annual_income is not _UNSET:
            row.other_annual_income = other_annual_income
        if strategy is not None:
            # validate it parses before saving
            StrategyConfig.from_mapping(strategy)
            row.strategy_json = json.dumps(strategy)
        await s.commit()
    return await get_config(account_hash)
