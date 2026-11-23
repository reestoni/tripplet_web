"""sensor_live_api.py - "YarnScope Live" (/tools/yarnscope-live; desktop ui/widgets/sensor_live_window.py).

Continuous measurement with a small dashboard (Nutzerwunsch 2026-11-23): start / stop by hand, every 30 m knots/m +
CV per sensor and - with a second sensor + the distance - the measured speed. Logic: ui/yarnscope/sensor_live.py in
the desktop repo (one live session per process; THE SERVER talks to the box, so this works while the web server runs
on the laptop the box hangs on). The browser only chooses box / sensor keys out of the user's Sensoft
configurations / numbers; the page polls /state every second.
Rights: feature tdms_inspector to look, write access (level 2) to start (saving writes to the share); stop = whoever
started it or a superuser.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature
from .sensor_api import _err, _merr, _error_json, _second_kw, _sensors

from db import trial_actions as ta  # noqa: E402
from ui.yarnscope import sensor_live as sl  # noqa: E402
from ui.yarnscope import sensor_measure as sm  # noqa: E402
from ui.yarnscope.sensor_pair import DEFAULT_DISTANCE_MM  # noqa: E402

router = APIRouter(prefix="/api/yarnscope-live")
_feature = require_feature("tdms_inspector")


@router.get("/setup")
def setup(user: Dict[str, Any] = Depends(_feature)):
    boxes, box_error = [], None
    try:
        boxes = sm.list_boxes()
    except sm.MeasureError as e:
        box_error = _error_json(e)
    cur = sl.current()
    return {"can_write": ta.can_edit_trials(user), "boxes": boxes, "box_error": box_error, "sensors": sm.sensor_presets(),
            "window_m": sl.WINDOW_M, "window_range": list(sl.WINDOW_RANGE), "speed_range": list(sm.SPEED_RANGE),
            "manual_dir": sm.MANUAL_DIR, "save_limit_m": sl.SAVE_LIMIT_M,
            "running": bool(cur and cur.state in ("running", "stopping")),
            "default_distance_mm": DEFAULT_DISTANCE_MM}


class StartBody(BaseModel):
    box: str
    sensor: str
    second: Optional[str] = None
    speed: Optional[float] = None
    distance: Optional[float] = None
    auto_speed: bool = False               # two sensors + distance: TrippleT measures the speed itself
    window: float = sl.WINDOW_M
    save: bool = True
    name: str = "live"
    kind: str = "dty"


@router.post("/start")
def start(body: StartBody, user: Dict[str, Any] = Depends(_feature)):
    if not ta.can_edit_trials(user):
        return _err(403, "read_only", "Write access required.")
    if body.kind not in sm.KINDS:
        return _err(400, "bad_kind", "Unknown folder.")
    try:
        p, p2 = _sensors(body)
        s = sl.start(box=body.box, head_name=p["head"], connector=p["connector"], speed_m_min=body.speed,
                     distance_mm=body.distance, window_m=body.window, save=body.save, name=body.name, kind=body.kind,
                     user={"id": user.get("id"), "username": user.get("username")}, auto_speed=body.auto_speed,
                     **_second_kw(p2))
    except sm.MeasureError as e:
        return _merr(e)
    return s.view()


@router.get("/state")
def state(since: int = 0, user: Dict[str, Any] = Depends(_feature)):
    s = sl.current()
    if s is None:
        return {"state": "none", "rows": [], "n_rows": 0}
    return s.view(max(0, since))


@router.post("/stop")
def stop(user: Dict[str, Any] = Depends(_feature)):
    s = sl.current()
    if s is None:
        return {"state": "none", "rows": [], "n_rows": 0}
    mine = (s.user.get("id") == user.get("id")) or int(user.get("access_level") or 0) >= 4
    if not mine:
        return JSONResponse(status_code=403, content={"code": "not_yours", "detail": "Started by someone else.",
                                                      "vars": {"user": s.user.get("username") or ""}})
    sl.stop()
    return s.view(0)
