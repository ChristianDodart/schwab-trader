"""Frozen (PyInstaller) entrypoint for the packaged desktop app's backend sidecar.

Electron spawns this exe, passing SCHWAB_DATA_DIR (its per-user userData path) so
the DB + encrypted tokens live in a writable location, and optionally SCHWAB_PORT.
Imports the app object directly (no uvicorn import-string reload machinery).
"""
import asyncio
import os
import sys
import threading

import uvicorn

# Line-buffer output so sidecar logs are visible if Electron ever captures them.
for _s in (sys.stdout, sys.stderr):
    try:
        if _s is not None:
            _s.reconfigure(line_buffering=True)
    except Exception:
        pass

from app.main import app  # noqa: E402


def _tether_to_parent() -> None:
    """Die with Electron. Electron spawns us with stdin as a pipe; when Electron
    exits (even a hard crash), the OS closes the pipe and this read returns EOF, so
    we exit too — no orphaned engine left holding the SQLite file / port."""
    try:
        sys.stdin.buffer.read()  # blocks until EOF
    except Exception:
        pass
    os._exit(0)


def main() -> None:
    # Only tether when launched with a real (piped) stdin — i.e. by Electron, not a
    # console. A terminal's stdin would block harmlessly, but skip it to be safe.
    try:
        if sys.stdin is not None and not sys.stdin.isatty():
            threading.Thread(target=_tether_to_parent, daemon=True).start()
    except Exception:
        pass
    port = int(os.environ.get("SCHWAB_PORT", "8000"))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, reload=False))
    if sys.platform == "win32":
        asyncio.run(server.serve(), loop_factory=asyncio.SelectorEventLoop)
    else:
        asyncio.run(server.serve())


if __name__ == "__main__":
    main()
