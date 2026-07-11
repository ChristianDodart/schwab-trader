"""Async SQLAlchemy engine/session setup (psycopg3 driver)."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from ..config import settings

log = logging.getLogger(__name__)

_BACKEND_DIR = Path(__file__).resolve().parents[2]  # .../backend


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.db_url, echo=False, future=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Dialect-appropriate INSERT so upserts (.on_conflict_do_update/.do_nothing/.returning)
# compile on BOTH backends — Postgres for dev/server, SQLite for the packaged desktop
# bundle. Callers do `from ..db import dialect_insert as pg_insert` and use it exactly
# like the old postgresql insert (identical .values().on_conflict_*() API on both).
if engine.dialect.name == "sqlite":
    # This IMPORT is the definition: re-exported via app/db/__init__ as pg_insert.
    from sqlalchemy.dialects.sqlite import insert as dialect_insert  # noqa: F401

    # SQLite concurrency hardening — the whole app shares ONE file with several
    # concurrent writers (snapshot scheduler, resyncs, UI writes) plus ~1/sec reads:
    #   WAL          → readers never block the writer (and vice versa); persistent.
    #   busy_timeout → residual lock contention WAITS up to 5s instead of raising
    #                  "database is locked".
    #   synchronous=NORMAL → safe with WAL, much faster than FULL.
    #   foreign_keys=ON → SQLite defaults FK enforcement OFF; the schema/code were
    #                  written against Postgres, which always enforces. Restore parity.
    from sqlalchemy import event

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_on_connect(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()
else:
    from sqlalchemy.dialects.postgresql import insert as dialect_insert  # noqa: F401


def _sync_url() -> str:
    """A SYNC SQLAlchemy URL for alembic/create_all (async drivers can't run sync)."""
    return settings.db_url.replace("+aiosqlite", "").replace("+asyncpg", "")


def _alembic_config():
    from alembic.config import Config

    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    return cfg


def _migrate_to_head() -> None:
    """Bring the schema to head via Alembic — versioned, non-destructive ALTERs
    (a fresh DB gets built by the baseline migration; an up-to-date one is a no-op).

    Fallback: if Alembic can't run, create any missing tables AND stamp head so the
    DB stays consistent with the migration history (a bare create_all would later
    collide with the baseline's CREATE TABLEs)."""
    from alembic import command
    from sqlalchemy import create_engine

    from . import models  # noqa: F401  (register models on Base.metadata)

    cfg = _alembic_config()

    # SQLite (the packaged bundle):
    #  - FRESH file (no alembic_version) → the historical migrations use Postgres-only
    #    ALTER/named-constraint ops SQLite can't replay, so build straight from the
    #    models (create_all == head) and stamp head.
    #  - EXISTING file → run upgrade(head) so shipped updates ACTUALLY apply. (Without
    #    this, a create_all+stamp on every boot silently skips any migration that adds
    #    a column to an existing table, then stamps head — breaking auto-updates.)
    #    Future migrations MUST use op.batch_alter_table to replay on SQLite.
    if engine.dialect.name == "sqlite":
        from sqlalchemy import inspect as _inspect

        sync_engine = create_engine(_sync_url())
        try:
            fresh = "alembic_version" not in _inspect(sync_engine).get_table_names()
            if fresh:
                Base.metadata.create_all(sync_engine)
        finally:
            sync_engine.dispose()
        if fresh:
            command.stamp(cfg, "head")
        else:
            command.upgrade(cfg, "head")
        return

    try:
        command.upgrade(cfg, "head")
    except Exception as e:  # don't brick local boot on a migration hiccup
        log.warning(f"alembic upgrade failed ({e!r}); falling back to create_all + stamp.")
        sync_engine = create_engine(_sync_url())
        try:
            Base.metadata.create_all(sync_engine)
        finally:
            sync_engine.dispose()
        command.stamp(cfg, "head")


async def init_db() -> None:
    """Run DB migrations to head (Alembic). Sync work runs off the event loop."""
    await asyncio.to_thread(_migrate_to_head)
