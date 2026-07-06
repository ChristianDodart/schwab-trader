"""Per-account configuration: strategy (full LIFO config), trading enablement,
and tax settings. Strategy is stored as JSON per account; NULL => YAML defaults.
Auto-creates a row on first access (MARGIN accounts default to trading-enabled).
"""
from __future__ import annotations

import json

from .db import SessionLocal
from .db.models import AccountConfig
from .strategy import StrategyConfig

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
    except Exception:
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
