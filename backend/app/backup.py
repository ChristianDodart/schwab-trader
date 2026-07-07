"""Automated backups of the SQLite trading database.

The entire trading history lives in ONE file — real-money data with no other copy.
Backups use sqlite3's online backup API (correct against a live WAL database — a
plain file copy could catch a torn page mid-write), run at startup + every 24h,
and rotate. Backups contain the DB only: tokens are Fernet-encrypted separately
and are deliberately excluded — restoring a backup means reconnecting Schwab,
which is one click and safer than copying key material around.

Restore = stop the app, replace data/schwab_trader.db with a backup file, start.
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from .config import settings

log = logging.getLogger(__name__)

_KEEP = 14                    # newest N backups survive rotation
_INTERVAL_S = 24 * 3600.0
_PREFIX = "schwab_trader-"


def _db_path() -> Path | None:
    """The live SQLite file, or None when running on a non-SQLite URL (Postgres dev
    rollback) — backups are a packaged-app/SQLite concern."""
    url = settings.db_url
    if not url.startswith("sqlite"):
        return None
    return Path(url.split("///", 1)[1])


def backups_dir() -> Path:
    d = settings.data_dir / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _backup_sync(src: Path, dest: Path) -> None:
    """Online backup — safe while the app is writing (WAL)."""
    with sqlite3.connect(str(src)) as s, sqlite3.connect(str(dest)) as d:
        s.backup(d)


def _rotate_sync() -> int:
    files = sorted(backups_dir().glob(f"{_PREFIX}*.db"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    removed = 0
    for old in files[_KEEP:]:
        try:
            old.unlink()
            removed += 1
        except OSError:
            pass  # locked/permission — retried next rotation
    return removed


async def run_backup() -> dict:
    src = _db_path()
    if src is None:
        return {"ok": False, "error": "backups apply to the SQLite database only"}
    if not src.exists():
        return {"ok": False, "error": f"database not found at {src}"}
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = backups_dir() / f"{_PREFIX}{stamp}.db"
    try:
        await asyncio.to_thread(_backup_sync, src, dest)
        await asyncio.to_thread(_rotate_sync)
    except Exception as e:
        try:
            dest.unlink(missing_ok=True)  # never leave a torn half-file behind
        except OSError:
            pass
        return {"ok": False, "error": repr(e)}
    return {"ok": True, "file": dest.name, "bytes": dest.stat().st_size,
            "at": datetime.now(timezone.utc).isoformat()}


def list_backups() -> dict:
    src = _db_path()
    files = sorted(backups_dir().glob(f"{_PREFIX}*.db"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    return {
        "dir": str(backups_dir()),
        "db_bytes": src.stat().st_size if (src and src.exists()) else None,
        "keep": _KEEP,
        "backups": [
            {"file": f.name, "bytes": f.stat().st_size,
             "at": datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc).isoformat()}
            for f in files
        ],
    }


async def run_backup_scheduler() -> None:
    """Startup backup, then one per day. Failures are logged and retried next cycle —
    a backup problem must never take the app down."""
    if _db_path() is None:
        log.info("non-SQLite database — scheduler idle.")
        return
    while True:
        try:
            res = await run_backup()
            if res.get("ok"):
                log.info(f"wrote {res['file']} ({res['bytes']:,} bytes)")
            else:
                log.warning(f"FAILED: {res.get('error')}")
        except Exception:
            log.exception("scheduler error")
        await asyncio.sleep(_INTERVAL_S + (time.monotonic() % 60))  # slight jitter
