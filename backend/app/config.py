"""App settings, loaded from backend/.env."""
from __future__ import annotations

import os
import sys
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent  # .../backend


def _default_data_dir() -> Path:
    """Where mutable state (SQLite DB, encrypted tokens) lives.

    Dev/source runs: the backend dir (unchanged behavior). A PACKAGED app (frozen
    exe) can't write next to the exe (Program Files is read-only), so it uses a
    per-user data dir — SCHWAB_DATA_DIR if set (Electron passes the OS userData
    path), else %APPDATA%/SchwabTrader (Windows) / ~/.schwab-trader."""
    env = os.environ.get("SCHWAB_DATA_DIR")
    if env:
        return Path(env)
    if getattr(sys, "frozen", False):  # PyInstaller bundle
        base = os.environ.get("APPDATA") or str(Path.home())
        return Path(base) / "SchwabTrader"
    return _BACKEND_DIR


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    schwab_client_id: str = ""
    schwab_client_secret: str = ""
    schwab_callback_url: str = "https://127.0.0.1/"
    schwab_token_path: str = "token.json"

    # Empty = derive a per-user SQLite path under data_dir (the packaged default).
    # A set DATABASE_URL (dev .env / server) wins.
    database_url: str = ""

    watchlist: str = "RCAT,SYM,IREN,RKLB,QBTS"

    @property
    def watchlist_symbols(self) -> list[str]:
        return [s.strip().upper() for s in self.watchlist.split(",") if s.strip()]

    @property
    def data_dir(self) -> Path:
        d = _default_data_dir()
        d.mkdir(parents=True, exist_ok=True)
        return d

    @property
    def db_url(self) -> str:
        """Effective DB URL: an explicit DATABASE_URL if set, else a per-user SQLite
        file under data_dir (so a packaged app 'just works' with no config)."""
        if self.database_url:
            return self.database_url
        db = self.data_dir / "data" / "schwab_trader.db"
        db.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{db.as_posix()}"

    @property
    def token_path(self) -> Path:
        p = Path(self.schwab_token_path)
        return p if p.is_absolute() else self.data_dir / p


settings = Settings()
