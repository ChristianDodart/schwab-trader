"""Dev entrypoint:  python run.py

psycopg's async driver can't run on Windows' default ProactorEventLoop. uvicorn's
own run() re-sets the loop on Windows, so instead of uvicorn.run() we drive the
server under asyncio.run() with an explicit SelectorEventLoop factory.
"""
import asyncio
import sys

import uvicorn

# Line-buffer stdout/stderr so prints (stream reconnects, snapshot logs) show up
# promptly when output is redirected to a file/pipe instead of a console.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(line_buffering=True)
    except Exception:
        pass


def main() -> None:
    config = uvicorn.Config("app.main:app", host="127.0.0.1", port=8000, reload=False)
    server = uvicorn.Server(config)
    if sys.platform == "win32":
        # loop_factory (Python 3.12+) avoids the deprecated event-loop policy API.
        asyncio.run(server.serve(), loop_factory=asyncio.SelectorEventLoop)
    else:
        asyncio.run(server.serve())


if __name__ == "__main__":
    main()
