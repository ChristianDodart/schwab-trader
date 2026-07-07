"""App-wide logging (W27-2).

One call to setup_logging() from main.py wires three sinks:
  - rotating file  <data dir>/app.log (~2 MB x 3) — survives restarts, safe to tail
  - console        what `uvicorn` users have been reading all along
  - ring buffer    the newest WARNING+ records, served by /api/logs/recent so
                   Settings → Diagnostics can show "recent errors" without file access

Modules log through the stdlib: `log = logging.getLogger(__name__)`.
"""
from __future__ import annotations

import collections
import logging
import logging.handlers
from datetime import datetime, timezone
from pathlib import Path

_FMT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"
_RING_SIZE = 200


class _RingHandler(logging.Handler):
    """Keep the newest WARNING+ records in memory for the diagnostics endpoint."""

    def __init__(self, size: int = _RING_SIZE):
        super().__init__(level=logging.WARNING)
        self.records: collections.deque = collections.deque(maxlen=size)

    def emit(self, record: logging.LogRecord) -> None:
        try:
            self.records.append({
                "at": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="seconds"),
                "level": record.levelname,
                "logger": record.name,
                "message": self.format(record),
            })
        except Exception:  # a broken record must never take the app down
            pass


_ring = _RingHandler()
_configured = False


def setup_logging(data_dir: str | Path, console: bool = True) -> None:
    """Idempotent root-logger setup. Called once from main.py at import."""
    global _configured
    if _configured:
        return
    _configured = True

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter(_FMT)

    try:
        Path(data_dir).mkdir(parents=True, exist_ok=True)
        fh = logging.handlers.RotatingFileHandler(
            Path(data_dir) / "app.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError:
        pass  # unwritable data dir → console + ring still work

    if console:
        ch = logging.StreamHandler()
        ch.setFormatter(fmt)
        root.addHandler(ch)

    # Ring formats message-only (the endpoint carries time/level as fields).
    _ring.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(_ring)

    # Third-party chatter that would drown our own lines at INFO.
    for noisy in ("httpx", "httpcore", "websockets", "schwab"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def recent_warnings(limit: int = 50) -> list[dict]:
    """Newest-first WARNING+ records for Settings → Diagnostics."""
    return list(_ring.records)[-limit:][::-1]
