"""conclusion_api.py - conclusion of a trial series ("Fazit", Show Experiment tab) on db/series_conclusion.py
(shared with the desktop tab ui/widgets/conclusion_tab.py).

GET  /api/series/{id}/conclusion   fields + goal of the experiment request + who changed it last + can_edit
PUT  /api/series/{id}/conclusion   save (access level 2; first save notifies the request creator)
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user

from db import series_conclusion as sc  # noqa: E402

router = APIRouter(prefix="/api")

_STATUS = {"no_table": 409, "no_right": 403, "not_found": 404, "invalid": 400, "too_long": 400}


def _json(c: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(c)
    for k in ("updated_at", "created_at"):
        v = out.get(k)
        out[k] = v.isoformat() if hasattr(v, "isoformat") else v
    if out.get("request"):
        out["request"] = {k: v for k, v in out["request"].items() if k != "created_by"}
    return out


@router.get("/series/{series_id}/conclusion")
def get_conclusion(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    return {**_json(sc.get(series_id)), "can_edit": sc.table_ready() and sc.can_edit(user)}


class ConclusionBody(BaseModel):
    goal: str = ""
    outcome: Optional[str] = None
    summary: str = ""
    best_trials: List[int] = []
    findings: str = ""
    recommendation: Optional[str] = None
    recommendation_text: str = ""


@router.put("/series/{series_id}/conclusion")
def put_conclusion(series_id: int, body: ConclusionBody, user: Dict[str, Any] = Depends(current_user)):
    try:
        res = sc.save(series_id, body.model_dump(), user)
    except sc.ConclusionError as e:
        return JSONResponse(status_code=_STATUS.get(e.code, 400), content={"code": e.code, "detail": str(e)})
    return {"created": res["created"], "notified": res["notified"],
            "conclusion": {**_json(res["conclusion"]), "can_edit": True}}
