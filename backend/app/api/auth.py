"""Auth & identity endpoints: Schwab token status/re-auth, per-profile API
credentials (Schwab + FMP), and profile management."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter
from pydantic import BaseModel

from .. import credentials as credentials_svc
from .. import profiles as profiles_svc
from ..main import _restart_stream
from ..schwab.auth import begin_reauth, complete_reauth, token_status
from ..schwab.auth import probe_live as auth_probe_live

router = APIRouter()


@router.get("/api/auth/status")
async def auth_status() -> dict:
    """Schwab token health. Actively verifies liveness with a cheap authenticated call
    (cached ~45s; a healthy stream counts as fresh) so 'connected' reflects a real
    round-trip, not just the token-file timestamp."""
    await auth_probe_live()
    return token_status()


@router.post("/api/auth/check")
async def auth_check() -> dict:
    """Force an immediate liveness probe (the banner's 'Check now' button)."""
    await auth_probe_live(force=True)
    return token_status()


class SchwabCredsBody(BaseModel):
    client_id: str | None = None
    client_secret: str | None = None
    callback_url: str | None = None


@router.get("/api/schwab-creds")
async def get_schwab_creds() -> dict:
    """Active profile's Schwab API credential status (never returns the secret)."""
    return credentials_svc.status()


@router.get("/api/schwab-creds/reveal")
async def reveal_schwab_creds() -> dict:
    """Full creds for the active profile — backs the Settings reveal/copy controls
    (local single-user app; served over localhost only)."""
    return credentials_svc.reveal()


@router.post("/api/schwab-creds")
async def set_schwab_creds(body: SchwabCredsBody) -> dict:
    """Save this install's own Schwab developer-app creds (blank secret keeps the
    existing one). Takes effect on the next client build."""
    return await credentials_svc.set_creds(body.client_id, body.client_secret, body.callback_url)


class FmpKeyBody(BaseModel):
    key: str


@router.get("/api/fmp-status")
async def get_fmp_status() -> dict:
    """Whether an optional Financial Modeling Prep key is configured (never the key)."""
    return await credentials_svc.fmp_status()


@router.post("/api/fmp-key")
async def set_fmp_key(body: FmpKeyBody) -> dict:
    """Save the optional FMP key (Fernet-encrypted). Powers sector/industry/country auto-tagging."""
    return await credentials_svc.set_fmp_key(body.key)


class ReceivedUrlBody(BaseModel):
    received_url: str


@router.post("/api/auth/begin")
async def auth_begin() -> dict:
    """Start UI re-auth: returns the Schwab authorization URL to open."""
    return begin_reauth()


@router.post("/api/auth/complete")
async def auth_complete(body: ReceivedUrlBody) -> dict:
    """Finish UI re-auth: exchange the pasted redirect URL for a fresh token,
    then restart the quote stream so the live feed reconnects with it."""
    result = await asyncio.to_thread(complete_reauth, body.received_url)
    if result.get("ok"):
        _restart_stream()
    return result


# ---- profiles (separate Schwab logins: Christian, Dave, …) ----

class ProfileCreateBody(BaseModel):
    name: str


class ProfileRenameBody(BaseModel):
    name: str


@router.get("/api/profiles")
async def get_profiles() -> dict:
    """List profiles + which is active + each one's connection/token status."""
    return await profiles_svc.list_profiles()


@router.post("/api/profiles")
async def create_profile(body: ProfileCreateBody) -> dict:
    return await profiles_svc.create_profile(body.name)


@router.post("/api/profiles/{pid}/activate")
async def activate_profile(pid: str) -> dict:
    """Switch active profile → its token becomes the one get_client() uses, and the
    live feed reconnects under it. The UI reloads so all views re-read under it."""
    result = await profiles_svc.set_active(pid)
    if result.get("ok"):
        await credentials_svc.load()  # creds are per-profile — load the new profile's
        _restart_stream()
    return result


@router.post("/api/profiles/{pid}/rename")
async def rename_profile(pid: str, body: ProfileRenameBody) -> dict:
    return await profiles_svc.rename_profile(pid, body.name)


@router.delete("/api/profiles/{pid}")
async def delete_profile(pid: str) -> dict:
    return await profiles_svc.delete_profile(pid)
