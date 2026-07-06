"""Profiles — separate Schwab logins the operator switches between (Christian,
Dave, …). Each profile owns:
  - its own OAuth token, stored ENCRYPTED off-DB (Fernet; key in tokens/master.key,
    gitignored, created on first use — never plaintext on disk),
  - its own profile-scoped app_settings (selected account, UI layouts, bulk
    thresholds), namespaced `p:{id}:{key}` via pkey().

Switching the active profile swaps which token get_client() uses, so the app
repopulates with that person's accounts/config/layout. Account-level rows
(lots/trades/config) are already keyed by Schwab account_hash — distinct per
login — so they never bleed across profiles.

The active profile id is cached in a module global (`_active_pid`) so the sync
get_client() path can read it without an await; it's loaded at startup and
updated on switch.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete, select
from .config import settings
from .db import SessionLocal, dialect_insert as pg_insert
from .db.models import AppSetting, Profile

_TOKENS_DIR = settings.data_dir / "tokens"  # per-user in a packaged app; backend/tokens in dev
_ACTIVE_KEY = "active_profile_id"        # GLOBAL app_setting (unprefixed)
_MIGRATED_KEY = "legacy_migrated"        # set to "1" only after a SUCCESSFUL migration
REFRESH_TOKEN_TTL_DAYS = 7

_active_pid: str | None = None           # in-memory cache for the sync get_client() path


# ---------- encryption / token storage ----------

_acl_hardened = False  # once per process — icacls is a subprocess, keep off hot paths


def _harden_dir_acl(path: Path) -> None:
    """Windows: os.chmod can't restrict NTFS access, so lock the tokens dir (master
    key + encrypted tokens) to the current user + SYSTEM via icacls. Best-effort —
    a failure never blocks the app (single-user machines lose nothing)."""
    global _acl_hardened
    if _acl_hardened or sys.platform != "win32":
        return
    _acl_hardened = True
    user = os.environ.get("USERNAME")
    if not user:
        return
    try:
        subprocess.run(
            ["icacls", str(path), "/inheritance:r",
             "/grant:r", f"{user}:(OI)(CI)F", "/grant:r", "SYSTEM:(OI)(CI)F"],
            capture_output=True, timeout=10, check=False,
        )
    except Exception:
        pass


def _fernet() -> Fernet:
    _TOKENS_DIR.mkdir(parents=True, exist_ok=True)
    _harden_dir_acl(_TOKENS_DIR)
    kp = _TOKENS_DIR / "master.key"
    if not kp.exists():
        kp.write_bytes(Fernet.generate_key())
        try:
            os.chmod(kp, 0o600)  # POSIX; Windows relies on the dir ACL above
        except OSError:
            pass
    return Fernet(kp.read_bytes())


def _token_file(pid: str) -> Path:
    return _TOKENS_DIR / f"{pid}.token.enc"


def has_token(pid: str | None) -> bool:
    return bool(pid) and _token_file(pid).exists()


def token_io(pid: str):
    """(read, write) funcs for schwab-py's client_from_access_functions. The token
    is Fernet-encrypted on disk and decrypted only in memory."""
    def read():
        return json.loads(_fernet().decrypt(_token_file(pid).read_bytes()))

    def write(token, *args, **kwargs):
        _TOKENS_DIR.mkdir(parents=True, exist_ok=True)
        _token_file(pid).write_bytes(_fernet().encrypt(json.dumps(token).encode()))

    return read, write


def _token_created_at(pid: str) -> float | None:
    if not has_token(pid):
        return None
    try:
        blob = json.loads(_fernet().decrypt(_token_file(pid).read_bytes()))
        return float(blob["creation_timestamp"])
    except (InvalidToken, ValueError, KeyError, TypeError, OSError):
        return None


def profile_status(pid: str | None) -> dict:
    """Token health for one profile, in the shape the AuthBanner expects."""
    created = _token_created_at(pid) if pid else None
    if created is None:
        return {"authorized": False, "expired": True, "severity": "expired",
                "issued_at": None, "expires_at": None, "days_left": None,
                "reauth_cmd": None,
                "message": "This profile isn't connected — authorize it to go live."}
    expires = created + REFRESH_TOKEN_TTL_DAYS * 86400
    days_left = (expires - time.time()) / 86400
    expired = days_left <= 0
    if expired:
        sev, msg = "expired", "Schwab authorization expired — reconnect this profile (feed is in DEMO)."
    elif days_left <= 2:
        sev, msg = "warn", f"Schwab authorization expires in {days_left:.1f} day(s) — reconnect soon."
    else:
        sev, msg = "ok", f"Schwab authorization valid for {days_left:.1f} more days."

    def _iso(ts: float) -> str:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

    return {"authorized": not expired, "expired": expired, "severity": sev,
            "issued_at": _iso(created), "expires_at": _iso(expires),
            "days_left": round(days_left, 2), "reauth_cmd": None, "message": msg}


# ---------- active profile + scoping ----------

def current_active_pid() -> str | None:
    return _active_pid


def pkey(key: str) -> str:
    """Profile-scope an app_setting key to the ACTIVE profile."""
    return f"p:{_active_pid or 'none'}:{key}"


# ---------- raw app_setting access (local, to avoid an accounts<->profiles cycle) ----------

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


# ---------- CRUD + switching ----------

async def list_profiles() -> dict:
    async with SessionLocal() as s:
        rows = (await s.execute(select(Profile).order_by(Profile.created_at))).scalars().all()
    active = current_active_pid()
    return {
        "active_id": active,
        "profiles": [
            {"id": p.id, "name": p.name, "active": p.id == active,
             "connected": has_token(p.id), "status": profile_status(p.id)}
            for p in rows
        ],
    }


async def create_profile(name: str, activate: bool = False) -> dict:
    pid = uuid.uuid4().hex
    async with SessionLocal() as s:
        s.add(Profile(id=pid, name=(name or "Profile").strip()[:64] or "Profile"))
        await s.commit()
    if activate:
        await set_active(pid)
    return {"ok": True, "id": pid}


async def set_active(pid: str) -> dict:
    global _active_pid
    async with SessionLocal() as s:
        if await s.get(Profile, pid) is None:
            return {"ok": False, "error": "no such profile"}
    await _raw_set(_ACTIVE_KEY, pid)
    _active_pid = pid
    from .schwab.auth import reset_client
    reset_client()  # next get_client() loads this profile's token
    return {"ok": True, "active_id": pid}


async def rename_profile(pid: str, name: str) -> dict:
    async with SessionLocal() as s:
        p = await s.get(Profile, pid)
        if p is None:
            return {"ok": False, "error": "no such profile"}
        p.name = (name or p.name).strip()[:64] or p.name
        await s.commit()
    return {"ok": True}


async def delete_profile(pid: str) -> dict:
    # Refuse to delete the active profile (switch first) so the app never ends up
    # with no active token.
    if pid == current_active_pid():
        return {"ok": False, "error": "switch to another profile before deleting this one"}
    async with SessionLocal() as s:
        p = await s.get(Profile, pid)
        if p is None:
            return {"ok": False, "error": "no such profile"}
        await s.delete(p)
        await s.execute(delete(AppSetting).where(AppSetting.key.like(f"p:{pid}:%")))
        await s.commit()
    try:
        _token_file(pid).unlink(missing_ok=True)
    except OSError:
        pass
    return {"ok": True}


# ---------- startup + one-time legacy migration ----------

async def ensure_default() -> None:
    """Guarantee at least one profile + a valid active pointer. On first run, adopt
    the legacy single-token setup (token.json + unprefixed settings) as a 'Default'
    profile so the existing connection/layout carries over untouched.

    Migration is marker-gated (`_MIGRATED_KEY`) and idempotent, so a crash between
    creating the Default row and finishing the copy is RESUMED on the next boot
    rather than skipped forever."""
    global _active_pid
    async with SessionLocal() as s:
        existing = (await s.execute(select(Profile).order_by(Profile.created_at))).scalars().all()

    if existing:
        _active_pid = await _raw_get(_ACTIVE_KEY)
        if not _active_pid or all(p.id != _active_pid for p in existing):
            await set_active(existing[0].id)
        # Resume an interrupted first-boot migration (idempotent) if the marker
        # never got set — e.g. a crash after the Default row committed.
        if await _raw_get(_MIGRATED_KEY) != "1":
            await _migrate_legacy(existing[0].id)
            await _raw_set(_MIGRATED_KEY, "1")
        return

    pid = uuid.uuid4().hex
    async with SessionLocal() as s:
        s.add(Profile(id=pid, name="Default"))
        await s.commit()
    await _migrate_legacy(pid)
    await _raw_set(_MIGRATED_KEY, "1")     # only after the copy fully succeeds
    await _raw_set(_ACTIVE_KEY, pid)
    _active_pid = pid


async def _migrate_legacy(pid: str) -> None:
    """Idempotent: safe to re-run. Adopts token.json (encrypted), copies legacy
    unprefixed settings, then purges the lingering plaintext token."""
    from .config import settings

    legacy = settings.token_path
    # 1) legacy plaintext token.json -> this profile's encrypted token (as-is).
    try:
        if legacy.exists() and not has_token(pid):
            _, write = token_io(pid)
            write(json.loads(legacy.read_text()))
    except Exception:
        pass  # a missing/corrupt legacy token just means "connect this profile"

    # 2) legacy unprefixed profile-scoped settings -> p:{pid}:* (idempotent upserts).
    async with SessionLocal() as s:
        rows = (await s.execute(select(AppSetting))).scalars().all()
    for r in rows:
        k = r.key
        if k in ("selected_account_hash", "bulk_prefs") or k.startswith("uipref:"):
            await _raw_set(f"p:{pid}:{k}", r.value)

    # 3) once the encrypted copy exists, remove the lingering cleartext token file
    # so an unencrypted copy of the OAuth token doesn't linger on disk.
    try:
        if has_token(pid) and legacy.exists():
            legacy.unlink()
    except OSError:
        pass
