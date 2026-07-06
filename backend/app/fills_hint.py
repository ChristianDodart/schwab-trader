"""Per-account "does this account expose fills?" hint — an optimization only.

The managed LLC account exposes NO fills, yet every nightly `resync_account` still
pages several empty `get_orders` windows to discover that. Once we've seen an account
come back genuinely empty (and it has no fill-derived history), we remember it and
skip the fills probe on subsequent syncs — going straight to positions mirroring.

SAFETY: this is purely a call-saver. It can only ever cause fills=[] to be passed to
`_write`, which for such an account backfills from positions exactly as before; and
`_write`'s existing "empty fills + fill-derived history ⇒ REFUSE" guard still protects
a full-access account. We also force a full re-probe every `_REPROBE_DAYS` so a newly
enabled account is rediscovered. Any parse doubt ⇒ probe.

Stored in app_setting under `fills_capable:{account_hash}` as `"{0|1}:{YYYY-MM-DD}"`.
"""
from __future__ import annotations

from datetime import date

_REPROBE_DAYS = 7
_KEY = "fills_capable:"


def parse_hint(raw: str | None) -> tuple[bool | None, date | None]:
    """`"1:2026-07-05"` → (True, date); `"0:…"` → (False, date). None/garbage → (None, None)."""
    if not raw or ":" not in raw:
        return None, None
    flag, _, iso = raw.partition(":")
    if flag not in ("0", "1"):
        return None, None
    try:
        return flag == "1", date.fromisoformat(iso)
    except ValueError:
        return flag == "1", None


def format_hint(capable: bool, probed_on: date) -> str:
    return f"{'1' if capable else '0'}:{probed_on.isoformat()}"


def should_probe(capable: bool | None, last_probe: date | None, today: date,
                 reprobe_days: int = _REPROBE_DAYS) -> bool:
    """Probe the fills API unless we KNOW the account doesn't expose them AND we probed
    recently. Unknown (None) ⇒ probe. Capable (True) ⇒ always probe. Not-capable (False)
    ⇒ skip, but re-probe if it's been ≥ reprobe_days (or the date is missing)."""
    if capable is None or capable is True:
        return True
    if last_probe is None:
        return True
    return (today - last_probe).days >= reprobe_days


async def get_hint(account_hash: str) -> tuple[bool | None, date | None]:
    from .db import SessionLocal
    from .db.models import AppSetting

    async with SessionLocal() as s:
        row = await s.get(AppSetting, _KEY + account_hash)
    return parse_hint(row.value if row else None)


async def set_hint(account_hash: str, capable: bool, probed_on: date) -> None:
    from .db import SessionLocal, dialect_insert as pg_insert
    from .db.models import AppSetting

    val = format_hint(capable, probed_on)
    stmt = (
        pg_insert(AppSetting).values(key=_KEY + account_hash, value=val)
        .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": val})
    )
    async with SessionLocal() as s:
        await s.execute(stmt)
        await s.commit()
