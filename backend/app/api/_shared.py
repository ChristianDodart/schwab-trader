"""Helpers shared by the APIRouter modules.

Previously these lived in main.py, which forced every api module to import from the
composition root — the reason main.py must include routers at the bottom under
`# noqa: E402`. Router modules should depend on this file (which has no main import),
not on main; main re-exports them for its own remaining routes.
"""
from __future__ import annotations

from fastapi import Response
from pydantic import BaseModel

from .. import accounts as accounts_svc


async def _selected() -> str:
    """The active account hash ("" when none selected) — scopes almost every route."""
    return await accounts_svc.get_setting(accounts_svc._sel_key()) or ""


def _csv_response(name: str, headers: list[str], rows: list[list]) -> Response:
    """Build a downloadable CSV (stdlib csv → attachment). `name` gets today's date."""
    import csv
    import io
    from datetime import date as _date

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    fname = f"{name}-{_date.today().isoformat()}.csv"
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


class CsvImportBody(BaseModel):
    csv: str                    # raw text of a Schwab "Transactions" CSV export
