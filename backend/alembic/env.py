"""Alembic environment — wired to the app's settings + ORM metadata.

The DB URL comes from app config (or a `-x db_url=...` override), and the target
metadata is the app's Base, so `alembic revision --autogenerate` diffs the live DB
against the models. Uses a SYNC engine (psycopg3 supports both); the app's async
engine is unrelated to migrations.
"""
from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.config import settings
from app.db import models  # noqa: F401  (registers tables on Base.metadata)
from app.db.database import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    override = context.get_x_argument(as_dictionary=True).get("db_url")
    url = override or settings.db_url
    # Alembic runs SYNC; strip async drivers so a SQLite (bundle) or asyncpg URL works.
    return url.replace("+aiosqlite", "").replace("+asyncpg", "")


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
