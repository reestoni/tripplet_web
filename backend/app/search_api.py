"""search_api.py - Quick search (Ctrl+F; desktop ui/screen_quick_search.py) on db/quick_search.py, and the
"Recent" series list (desktop ui/recent_series.py) on db/display_settings.push_recent - stored per user in
tblUser.DisplaySettings ("recent_series"), so the desktop and the web share the same list."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user

from db import display_settings as ds  # noqa: E402
from db import quick_search as qs  # noqa: E402
from db.connection import fetch_all  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api")


@router.get("/quick-search")
def quick_search(series: str = "", jet: str = "", yarn: str = "", machine: str = "",
                 user: Dict[str, Any] = Depends(current_user)):
    terms = [qs._terms(x[:200]) for x in (jet, machine, series, yarn)]
    if not any(terms):
        return {"results": []}
    res = qs._search(*terms)
    return {"results": [{"series_id": r["series_pk"], "experiment": r["exp_id"], "name": r["series_name"],
                         "machine": r["maschine"], "reasons": r["reasons"]} for r in res[:200]],
            "more": max(0, len(res) - 200)}


@router.get("/recent")
def recent(user: Dict[str, Any] = Depends(current_user)):
    entries = list((ds.load(user.get("id")) or {}).get("recent_series") or [])
    ids = [int(e["series"]) for e in entries if e.get("series") is not None]
    alive = {int(r["ID"]) for r in fetch_all(f"SELECT ID FROM tblTrialSeries WHERE ID IN ({','.join('?' * len(ids))})", ids)} if ids else set()
    return {"items": [{"series_id": int(e["series"]), "experiment": e.get("eid") or "", "name": e.get("name") or ""}
                      for e in entries if e.get("series") is not None and int(e["series"]) in alive]}


class OpenedBody(BaseModel):
    series_id: int


@router.post("/recent")
def opened(body: OpenedBody, user: Dict[str, Any] = Depends(current_user)):
    """A series was opened in Show Experiment -> top of the user's recent list (not for recycle bin previews)."""
    rows = fetch_all("SELECT ts.ID, ts.SeriesName, e.ID AS ExpPK, e.ExperimentID FROM tblTrialSeries ts "
                     "LEFT JOIN tblExperimente e ON e.ID = ts.ExperimentID WHERE ts.ID = ?", [body.series_id])
    if not rows or not ds.has_column():
        return {"ok": False}
    r = rows[0]
    entry = {"exp": int(r.get("ExpPK") or 0), "series": int(r["ID"]), "eid": str(r.get("ExperimentID") or ""),
             "name": str(r.get("SeriesName") or "")}
    cur = list((ds.load(user.get("id")) or {}).get("recent_series") or [])
    ds.update(user.get("id"), recent_series=ds.push_recent(cur, entry))
    return {"ok": True}


@router.post("/screen-open")
def screen_open(body: Dict[str, Any], user: Dict[str, Any] = Depends(current_user)):
    """Usage tracking of page opens (desktop: every screen change -> tblUsageLog 'screen_open'); the web logs the
    desktop screen name of the page so Usage Stats counts both apps together, marked 'web' in Detail."""
    name = str(body.get("screen") or "")[:80]
    if name:
        from db.usage_log import log_usage_event as _log
        _log("screen_open", name, "web")
    return {"ok": True}
