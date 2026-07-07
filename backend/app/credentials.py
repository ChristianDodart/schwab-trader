"""Per-install Schwab API credentials — the developer-app client_id / secret /
callback. A distributed install enters its OWN creds in Settings instead of
editing .env, so these live (global, per-install) in app_setting and OVERRIDE the
.env defaults. Cached in a module global for the sync auth path; load()/set_creds()
refresh it. Falls back to .env for any unset key, so an existing .env-configured
instance keeps working with zero changes.
"""
from __future__ import annotations

import logging

from .config import settings
from .db import SessionLocal, dialect_insert as pg_insert
from .db.models import AppSetting

log = logging.getLogger(__name__)

_K_ID = "schwab_client_id"
_K_SECRET = "schwab_client_secret"
_K_CALLBACK = "schwab_callback_url"
_DEFAULT_CALLBACK = "https://127.0.0.1/"
_ENC_PREFIX = "enc:"  # marks a Fernet-encrypted stored secret (vs legacy plaintext)


def _encrypt_secret(secret: str) -> str:
    """Encrypt the app secret with the SAME Fernet key as the token store, so it's
    never plaintext in the DB (parity with tokens/*.token.enc)."""
    from .profiles import _fernet

    return _ENC_PREFIX + _fernet().encrypt(secret.encode()).decode()


def _decrypt_secret(stored: str | None) -> str | None:
    """Stored → plaintext. Handles legacy plaintext rows (no prefix) transparently;
    an undecryptable enc: value (rotated/lost key) degrades to None → 'not configured'
    rather than a crash."""
    if not stored:
        return stored
    if not stored.startswith(_ENC_PREFIX):
        return stored  # legacy plaintext (pre-encryption row)
    try:
        from .profiles import _fernet

        return _fernet().decrypt(stored[len(_ENC_PREFIX):].encode()).decode()
    except Exception as e:
        log.warning(f"stored secret could not be decrypted (rotated/lost key?) — treating as not configured: {e!r}")
        return None

# Seeded from .env at import so get() is valid even before load() runs at startup.
_creds: dict = {
    "client_id": settings.schwab_client_id or "",
    "client_secret": settings.schwab_client_secret or "",
    "callback_url": settings.schwab_callback_url or _DEFAULT_CALLBACK,
}


async def _raw_get(key: str) -> str | None:
    async with SessionLocal() as s:
        row = await s.get(AppSetting, key)
        return row.value if row else None


async def _raw_set(key: str, value: str) -> None:
    stmt = (
        pg_insert(AppSetting).values(key=key, value=value)
        .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": value})
    )
    async with SessionLocal() as s:
        await s.execute(stmt)
        await s.commit()


def _scoped(key: str) -> str:
    """Profile-scope a cred key to the ACTIVE profile — creds are per-profile (each
    login can use its own Schwab developer app), so switching profiles switches creds."""
    from . import profiles
    return profiles.pkey(key)


async def _load_one(base_key: str) -> tuple[str | None, str]:
    """Read a cred, preferring the ACTIVE profile's value and falling back to a legacy
    GLOBAL value (pre-per-profile installs). Returns (raw_value, key_it_came_from)."""
    pk = _scoped(base_key)
    v = await _raw_get(pk)
    if v is not None:
        return v, pk
    return await _raw_get(base_key), base_key  # legacy shared cred → acts as the default


async def load() -> None:
    """Populate the cache from the ACTIVE profile's creds (DB, per-profile → legacy-global
    → .env). A legacy PLAINTEXT stored secret is re-encrypted in place on first load."""
    global _creds
    cid, _ = await _load_one(_K_ID)
    sec_raw, sec_key = await _load_one(_K_SECRET)
    cb, _ = await _load_one(_K_CALLBACK)
    sec = _decrypt_secret(sec_raw)
    if sec_raw and not sec_raw.startswith(_ENC_PREFIX):
        try:
            await _raw_set(sec_key, _encrypt_secret(sec_raw))  # upgrade legacy row in place
        except Exception:
            pass  # cache still works this boot; retried next load
    _creds = {
        "client_id": cid or settings.schwab_client_id or "",
        "client_secret": sec or settings.schwab_client_secret or "",
        "callback_url": cb or settings.schwab_callback_url or _DEFAULT_CALLBACK,
    }


def get() -> dict:
    return dict(_creds)


def is_configured() -> bool:
    return bool(_creds.get("client_id") and _creds.get("client_secret"))


def status() -> dict:
    """Safe (secret-free) view for the UI — never returns the secret itself."""
    cid = _creds.get("client_id") or ""
    masked = (cid[:4] + "…" + cid[-4:]) if len(cid) > 8 else ("set" if cid else "")
    return {
        "configured": is_configured(),
        "client_id_masked": masked,
        "callback_url": _creds.get("callback_url") or _DEFAULT_CALLBACK,
        "has_secret": bool(_creds.get("client_secret")),
    }


def reveal() -> dict:
    """Full creds for the ACTIVE profile — for the Settings reveal/copy controls. Safe on
    a local single-user desktop app (the user's own creds, served over localhost only)."""
    return {
        "client_id": _creds.get("client_id") or "",
        "client_secret": _creds.get("client_secret") or "",
        "callback_url": _creds.get("callback_url") or _DEFAULT_CALLBACK,
    }


async def set_creds(client_id: str | None = None, client_secret: str | None = None,
                    callback_url: str | None = None) -> dict:
    """Persist any provided fields to the ACTIVE profile (blank secret keeps the existing
    one) + refresh. Per-profile, so editing one profile's creds never touches another's."""
    if client_id is not None:
        await _raw_set(_scoped(_K_ID), client_id.strip())
    if client_secret is not None and client_secret.strip():
        await _raw_set(_scoped(_K_SECRET), _encrypt_secret(client_secret.strip()))
    if callback_url is not None:
        await _raw_set(_scoped(_K_CALLBACK), callback_url.strip() or _DEFAULT_CALLBACK)
    await load()
    from .schwab.auth import reset_client
    reset_client()  # new creds take effect on the next get_client()
    return status()


# --- Financial Modeling Prep (optional, per-install) — powers company profile
# --- auto-tagging (sector/industry/country). Stored Fernet-encrypted like the secret.
_K_FMP = "fmp_api_key"


async def get_fmp_key() -> str | None:
    """The stored FMP key (decrypted), or None if unset."""
    return _decrypt_secret(await _raw_get(_K_FMP))


async def set_fmp_key(key: str) -> dict:
    if key and key.strip():
        await _raw_set(_K_FMP, _encrypt_secret(key.strip()))
    return await fmp_status()


async def fmp_status() -> dict:
    """Secret-free view: whether an FMP key is configured (never returns the key)."""
    return {"configured": bool(await get_fmp_key())}
