"""usage_stats_api.py - Usage Stats (/superuser/usage-stats; desktop ui/screen_usage_stats.py) on db/usage_stats.py.
Superusers only (activity per user, not anonymised) - same rule as the desktop."""
from __future__ import annotations

import datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from . import core  # noqa: F401
from .deps import current_user

from db import usage_stats as us  # noqa: E402

router = APIRouter(prefix="/api/superuser/usage-stats")
SUPERUSER = 4


def _plain(v: Any) -> Any:
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat(sep=" ")[:19] if isinstance(v, datetime.datetime) else v.isoformat()
    return v


def _rows(rows):
    return [{k: _plain(v) for k, v in r.items()} for r in rows or []]


@router.get("")
def stats(user: Dict[str, Any] = Depends(current_user)):
    if int(user.get("access_level") or 0) < SUPERUSER:
        return JSONResponse(status_code=403, content={"code": "superuser_only", "detail": "Superusers only."})
    if not us.available():
        return JSONResponse(status_code=404, content={"code": "no_table", "detail": "tblUsageLog not found."})
    st = us.load_stats()
    help_rows, help_summary = us.summarize_help_events(st["help_events"])
    return {"logins": _rows(st["logins"]), "screens": _rows(st["screens"]), "features": _rows(st["features"]),
            "ranking": _rows(st["ranking"]), "login_timeline": _rows(st["login_timeline"]),
            "help": _rows(help_rows), "help_summary": help_summary,
            "help_totals": {k: sum(1 for e in st["help_events"] if e.get("EventName") == k) for k, _l in us.HELP_KINDS}}
