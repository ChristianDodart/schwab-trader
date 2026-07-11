"""Configuration endpoints: per-account config + strategy, UI prefs, phone
notifications, signal rules, per-symbol rule overrides, and ETF links."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from .. import accounts as accounts_svc
from .. import config_store
from .. import ledger as ledger_svc
from .. import notifications as notifications_svc
from .. import phone as phone_svc
from .. import profiles as profiles_svc
from ..main import strategy
from ._shared import _selected

router = APIRouter()


@router.get("/api/notif-prefs")
async def get_notif_prefs() -> dict:
    """Notification delivery prefs (global): mute, per-category channel toggles, muted symbols."""
    return await notifications_svc.get_notif_prefs()


class NotifPrefsBody(BaseModel):
    muted: bool | None = None
    categories: dict | None = None
    muted_symbols: list[str] | None = None


@router.post("/api/notif-prefs")
async def set_notif_prefs(body: NotifPrefsBody) -> dict:
    return await notifications_svc.set_notif_prefs(body.model_dump(exclude_none=True))


@router.get("/api/strategy/validate")
async def validate_strategy() -> dict:
    """Advisory sanity checks on the SELECTED account's strategy config (never blocks)."""
    from ..strategy import validate as strategy_validate

    cfg = await config_store.get_strategy(await _selected())
    return {"findings": strategy_validate.check(cfg.to_mapping())}


@router.get("/api/strategy")
async def get_strategy() -> dict:
    """Expose the loaded (malleable) strategy config to the UI."""
    return {
        "sizing_tiers": [t.__dict__ for t in strategy.sizing_tiers],
        "max_rungs": strategy.max_rungs,
        "ladder_drops": [d.__dict__ for d in strategy.ladder_drops],
        "sell": strategy.sell.__dict__,
        "guardrails": strategy.guardrails,
        "universe": strategy.universe,
    }


class PhoneNotifyBody(BaseModel):
    channel: str | None = None       # "off" | "ntfy" | "email"
    ntfy_url: str | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_pass: str | None = None     # blank = keep the stored one
    smtp_from: str | None = None
    smtp_to: str | None = None
    smtp_tls: bool | None = None
    cat_alerts: bool | None = None
    cat_triggers: bool | None = None
    cat_fills: bool | None = None


@router.get("/api/phone-notify")
async def get_phone_notify() -> dict:
    """Phone-notification config, secret-free (never returns the SMTP password)."""
    return await phone_svc.status()


@router.post("/api/phone-notify")
async def set_phone_notify(body: PhoneNotifyBody) -> dict:
    """Save the optional phone channel (ntfy topic or SMTP; password Fernet-encrypted)."""
    return await phone_svc.set_config(body.model_dump(exclude_none=True))


@router.post("/api/phone-notify/test")
async def test_phone_notify() -> dict:
    """Send a test message on the current config and report success/failure."""
    return await phone_svc.send_test()


class ConfigBody(BaseModel):
    trading_enabled: bool | None = None
    tax_filing: str | None = None
    tax_state_rate: float | None = None
    strategy: dict | None = None
    # Ledger predictive inputs — nullable (can be cleared). We use model_fields_set
    # below so an OMITTED field is left as-is while an explicit null clears it.
    year_end_goal: float | None = None
    other_annual_income: float | None = None


@router.get("/api/config")
async def get_config() -> dict:
    """Per-account config (strategy + trading-enable + tax) for the selected account."""
    return await config_store.get_config(await _selected())


@router.post("/api/config")
async def post_config(body: ConfigBody) -> dict:
    # Only forward the nullable ledger fields when the caller actually included them,
    # so a partial POST (e.g. just the goal from the ledger) doesn't wipe the other.
    extra = {}
    fs = body.model_fields_set
    if "year_end_goal" in fs:
        extra["year_end_goal"] = body.year_end_goal
    if "other_annual_income" in fs:
        extra["other_annual_income"] = body.other_annual_income
    return await config_store.set_config(
        await _selected(),
        trading_enabled=body.trading_enabled, tax_filing=body.tax_filing,
        tax_state_rate=body.tax_state_rate, strategy=body.strategy, **extra,
    )


class PrefBody(BaseModel):
    value: Any = None


@router.get("/api/prefs/{key}")
async def get_pref(key: str) -> dict:
    """Per-PROFILE UI preference (e.g. column layouts), JSON-decoded. Scoped to the
    active profile so each profile keeps its own layout; persists in the DB."""
    raw = await accounts_svc.get_setting(profiles_svc.pkey(f"uipref:{key}"))
    try:
        return {"key": key, "value": json.loads(raw) if raw else None}
    except (ValueError, TypeError):
        return {"key": key, "value": None}


@router.post("/api/prefs/{key}")
async def set_pref(key: str, body: PrefBody) -> dict:
    await accounts_svc.set_setting(profiles_svc.pkey(f"uipref:{key}"), json.dumps(body.value))
    return {"ok": True}


@router.get("/api/signal-rules")
async def get_signal_rules() -> dict:
    """User-defined extra signal rules for the selected account."""
    return {"rules": await ledger_svc.get_signal_rules(await _selected())}


class SignalRulesBody(BaseModel):
    rules: list


@router.put("/api/signal-rules")
async def set_signal_rules(body: SignalRulesBody) -> dict:
    """Replace the extra signal rules for the selected account."""
    return await ledger_svc.set_signal_rules(await _selected(), body.rules)


@router.get("/api/symbol-rules")
async def get_symbol_rules() -> dict:
    """Per-ticker overrides of the global strategy (sell target / dip depth)."""
    return {"rules": await config_store.get_symbol_overrides(await _selected())}


class SymbolRuleBody(BaseModel):
    symbol: str
    sell_mode: str | None = None    # "dollar_gain" | "pct_above"
    sell_value: float | None = None  # $ or FRACTION (0.05 = 5%)
    dip_scale: float | None = None   # 0.1–3.0; 1.0/None = global depth
    clear: bool = False


@router.post("/api/symbol-rules")
async def set_symbol_rule(body: SymbolRuleBody) -> dict:
    """Set (or clear) one ticker's rule override. Signals, buy triggers, sell targets,
    the detail ladder and projections all follow it immediately."""
    ov = None if body.clear else {"sell_mode": body.sell_mode, "sell_value": body.sell_value,
                                  "dip_scale": body.dip_scale}
    res = await config_store.set_symbol_override(await _selected(), body.symbol, ov)
    from .. import dashboard as dashboard_svc
    dashboard_svc.invalidate_dashboard_cache()
    return res


@router.get("/api/etf-links")
async def get_etf_links() -> dict:
    """Manual ETF→underlying overrides for the selected account: {ETF: UNDERLYING}."""
    return {"links": await ledger_svc.get_etf_links(await _selected())}


class EtfLinkBody(BaseModel):
    etf: str
    underlying: str | None = None


@router.post("/api/etf-link")
async def set_etf_link(body: EtfLinkBody) -> dict:
    """Set (blank underlying clears) one ETF→underlying grouping override."""
    return await ledger_svc.set_etf_link(await _selected(), body.etf, body.underlying)
