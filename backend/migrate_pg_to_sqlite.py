"""One-shot Postgres -> SQLite data migration for the schwab-trader app.

Non-destructive: reads Postgres (source), builds a fresh SQLite file (dest), and
verifies row counts. Postgres is left untouched as a rollback. Token files
(tokens/*.token.enc + master.key) live on disk and carry over automatically.

Run:  DEST_SQLITE=sqlite:///abs/path.db  python migrate_pg_to_sqlite.py
"""
from __future__ import annotations

import os
import sys

from sqlalchemy import create_engine, func, insert, select

from app.config import settings
from app.db import models  # noqa: F401  (registers tables on Base.metadata)
from app.db.database import Base

SRC_URL = settings.database_url.replace("+asyncpg", "").replace("+aiosqlite", "")
DEST_URL = os.environ["DEST_SQLITE"]  # e.g. sqlite:///C:/.../data/schwab_trader.db

if not SRC_URL.startswith("postgresql"):
    print(f"Refusing: source is not Postgres ({SRC_URL!r}). Point DATABASE_URL at Postgres to export.")
    sys.exit(1)

src = create_engine(SRC_URL)
dest = create_engine(DEST_URL)

# Build the dest schema straight from the models (== migration head).
Base.metadata.create_all(dest)

tables = list(Base.metadata.sorted_tables)  # FK-dependency order (parents first)

copied: dict[str, int] = {}
with src.connect() as sc, dest.begin() as dc:
    for t in tables:
        rows = [dict(r._mapping) for r in sc.execute(select(t)).all()]
        if rows:
            dc.execute(insert(t), rows)
        copied[t.name] = len(rows)

# Verify: dest counts must equal source counts for every table.
ok = True
print(f"{'table':22} {'src':>7} {'dst':>7}")
with src.connect() as sc, dest.connect() as dc:
    for t in tables:
        n_src = sc.execute(select(func.count()).select_from(t)).scalar()
        n_dst = dc.execute(select(func.count()).select_from(t)).scalar()
        mark = "OK" if n_src == n_dst else "MISMATCH"
        if n_src != n_dst:
            ok = False
        print(f"{t.name:22} {n_src:7} {n_dst:7}  {mark}")

print("MIGRATION_OK" if ok else "MIGRATION_MISMATCH")
sys.exit(0 if ok else 2)
