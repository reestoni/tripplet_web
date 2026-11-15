"""jet_advisor_api.py - Jet Advisor (/tools/jet-advisor; desktop ui/screen_jet_advisor.py) on ui/jet_advisor.py
(Qt-free, the desktop screen uses it too).

Targets (points/m, CV, stability) + yarn (existing yarn or material / final titer / filaments) + filters (jet type,
maker, group, titer range, setting limits) -> ranking of jets with recommended pressure / overfeed / speed.
The trials are loaded once per process (Reload loads them again), fits are cached inside the Advisor.
The browser sends only numbers and IDs; the server checks them (request_from_json). Only reads."""
from __future__ import annotations

import threading
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db.usage_log import log_usage_event  # noqa: E402
from ui import jet_advisor as ja  # noqa: E402

router = APIRouter(prefix="/api/jet-advisor")
_feature = require_feature("jet_advisor")

_lock = threading.Lock()
_state: Dict[str, Any] = {"adv": None}


def _err(code: str, detail: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _advisor(reload: bool = False) -> ja.Advisor:
    with _lock:
        if _state["adv"] is None:
            _state["adv"] = ja.Advisor()
        elif reload:
            _state["adv"].reload()
        return _state["adv"]


@router.get("/options")
def options(reload: bool = False, user: Dict[str, Any] = Depends(_feature)):
    try:
        adv = _advisor(reload)
    except Exception as e:
        return _err("load_failed", f"The trials could not be loaded: {e}", 500)
    log_usage_event("feature", "jet_advisor_open", "web")
    return adv.options()


class Spec(BaseModel):
    lo: Optional[float] = None
    hi: Optional[float] = None


class AdviseBody(BaseModel):
    targets: Dict[str, Spec] = {}
    yarn_id: Optional[int] = None
    endtiter: Optional[float] = None
    filaments: Optional[float] = None
    material_id: Optional[int] = None
    same_material: bool = True
    max_distance: float = ja.MAX_DISTANCE
    jet_types: Optional[List[int]] = None
    makers: Optional[List[int]] = None
    groups: Optional[List[int]] = None
    titer_fit: bool = False
    limits: Dict[str, List[Optional[float]]] = {}
    prefer: str = "robust"


@router.post("/advise")
def advise(body: AdviseBody, user: Dict[str, Any] = Depends(_feature)):
    try:
        adv = _advisor()
    except Exception as e:
        return _err("load_failed", f"The trials could not be loaded: {e}", 500)
    req = ja.request_from_json(body.model_dump())
    with _lock:            # the fit cache inside the Advisor is a plain dict
        res = adv.advise(req)
    if "error" in res:
        detail = {ja.ERR_NO_TARGET: "Give at least one target.",
                  ja.ERR_NO_YARN: "Choose a yarn or give final titer and filament count."}.get(res["error"], "")
        return _err(res["error"], detail)
    log_usage_event("feature", "jet_advisor_run", "web")
    return ja.result_json(res)
