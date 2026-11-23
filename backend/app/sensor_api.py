"""sensor_api.py - YarnScope measurement from Show Experiment ("📏 Messen", Nutzerwunsch 2026-11-20, F&E feasibility).

Logic: ui/yarnscope/sensor_measure.py in the desktop repo (same as the desktop dialog). The SERVER talks to the NI
box - so this works only while the web server runs on the laptop the box hangs on (phase 1: 127.0.0.1). On the
VM there is no box: setup answers boxes = [] and the page says so (later: a small helper on the laptop).

The browser sends only choices: trial id (-> number from the DB, no reference samples), a sensor KEY out of the
user's Sensoft configurations (-> head + connector, never a free file name), the box name (checked against the
connected boxes), speed / length (checked against the limits), dty|aty. One measurement at a time (the box);
runs as a background job the page polls (like the PDF import), with cancel.
"""
from __future__ import annotations

import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user, require_feature
from .user_context import reset, set_user

from db import trial_actions as ta  # noqa: E402
from ui.yarnscope import sensor_measure as sm  # noqa: E402

router = APIRouter(prefix="/api/series")
# free measurement in the TDMS Inspector (own name + speed, no series; Nutzerwunsch 2026-11-23)
inspector_router = APIRouter(prefix="/api/tdms-inspector/sensor")
_inspector = require_feature("tdms_inspector")

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sensor-measure")
_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()
_KEEP_S = 3600


def _err(status: int, code: str, detail: str, **vars: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, "vars": vars})


def _merr(e: sm.MeasureError) -> JSONResponse:
    status = {"busy": 409, "exists": 409, "box_missing": 409, "no_nidaqmx": 503, "no_driver": 503,
              "folder_missing": 503, "daq_error": 502}.get(e.code, 400)
    return _err(status, e.code, e.detail, **e.vars)


def _error_json(e: Exception) -> Dict[str, Any]:
    if isinstance(e, sm.MeasureError):
        return {"code": e.code, "detail": e.detail, "vars": e.vars}
    return {"code": "daq_error", "detail": str(e)[:300], "vars": {"detail": str(e)[:300]}}


def _preset(key: str) -> Optional[Dict[str, Any]]:
    return next((p for p in sm.sensor_presets() if p["key"] == key), None)


@router.get("/{series_id}/sensor/setup")
def setup(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Boxes (or why none), sensors from the Sensoft configurations, trials with proposed speed and files."""
    boxes, box_error = [], None
    try:
        boxes = sm.list_boxes()
    except sm.MeasureError as e:
        box_error = _error_json(e)
    return {"can_write": ta.can_edit_trials(user), "boxes": boxes, "box_error": box_error,
            "sensors": sm.sensor_presets(), "trials": sm.trials_for(series_id),
            "length": sm.DEFAULT_LENGTH_M, "speed_range": list(sm.SPEED_RANGE), "length_range": list(sm.LENGTH_RANGE),
            "replaced_dir": sm.REPLACED_DIR}


class SensorChoice(BaseModel):
    box: str
    sensor: str


class ZeroBody(SensorChoice):
    seconds: float = 1.0


@router.post("/{series_id}/sensor/zero")
def zero(series_id: int, body: ZeroBody, user: Dict[str, Any] = Depends(current_user)):
    """Empty value of the sensor (no yarn) - nothing is saved."""
    if not ta.can_edit_trials(user):
        return _err(403, "read_only", "Write access required.")
    p = _preset(body.sensor)
    if not p:
        return _err(400, "head_missing", "Unknown sensor.", head=body.sensor)
    try:
        return sm.zero_check(body.box, p["head"], p["connector"], body.seconds)
    except sm.MeasureError as e:
        return _merr(e)


class MeasureBody(SensorChoice):
    trial_id: int
    speed: float
    length: float
    kind: str = "dty"
    replace: bool = False
    zero: Optional[Dict[str, Any]] = None


def _run(job: Dict[str, Any], kwargs: Dict[str, Any], user: Dict[str, Any], fn=None, on_done=None) -> None:
    token = set_user(user)
    job["queued"] = False

    def progress(a: int, b: int) -> None:
        job["done"], job["total"] = int(a), int(b)
    try:
        res = (fn or sm.measure)(**kwargs, progress=progress, cancel=lambda: job["cancel"])
        job["result"] = on_done(res) if on_done else res
    except Exception as e:  # noqa: BLE001 - shown on the page
        job["error"] = _error_json(e)
    finally:
        job["finished"], job["ended"] = True, time.time()
        reset(token)


@router.post("/{series_id}/sensor/measure")
def measure_start(series_id: int, body: MeasureBody, user: Dict[str, Any] = Depends(current_user)):
    """Starts the measurement of one trial -> {job_id}; poll /sensor/job/<id>. An existing file -> 409 exists
    (again with replace = the old file goes to _replaced)."""
    if not ta.can_edit_trials(user):
        return _err(403, "read_only", "Write access required.")
    trial = next((t for t in sm.trials_for(series_id) if t["trial_id"] == body.trial_id), None)
    if not trial:
        return _err(404, "not_found", "Trial not in this series.")
    p = _preset(body.sensor)
    if not p:
        return _err(400, "head_missing", "Unknown sensor.", head=body.sensor)
    if body.kind not in sm.KINDS:
        return _err(400, "bad_kind", "Unknown folder.")
    try:                                         # quick checks before the job (the page shows them at once)
        sm.check_plan(body.speed, body.length, p["axes"])
        if trial.get(body.kind) and not body.replace:
            raise sm.MeasureError("exists", f"{trial[body.kind]} exists", file=trial[body.kind])
    except sm.MeasureError as e:
        return _merr(e)
    kwargs = dict(series_id=series_id, trial_id=trial["trial_id"], vno=trial["vno"], box=body.box,
                  head_name=p["head"], connector=p["connector"], speed_m_min=body.speed, length_m=body.length,
                  kind=body.kind, replace=body.replace, user={"id": user.get("id"), "username": user.get("username")},
                  zero=body.zero if isinstance(body.zero, dict) else None)
    return _start_job(series_id, user, trial["vno"], kwargs)


def _start_job(scope: int, user: Dict[str, Any], vno: Any, kwargs: Dict[str, Any], fn=None, on_done=None):
    """scope = series id (0 = TDMS Inspector). One measurement at a time on this server."""
    now = time.time()
    with _lock:
        for k in [k for k, j in _jobs.items() if j["finished"] and now - (j["ended"] or now) > _KEEP_S]:
            del _jobs[k]
        if any(not j["finished"] for j in _jobs.values()):
            return _err(409, "busy", "A measurement is running.")
        job = {"id": uuid.uuid4().hex[:12], "series_id": scope, "user_id": user.get("id"), "vno": vno,
               "done": 0, "total": 0, "queued": True, "finished": False, "cancel": False, "result": None,
               "error": None, "ended": None}
        _jobs[job["id"]] = job
    _executor.submit(_run, job, kwargs, dict(user), fn, on_done)
    return {"job_id": job["id"]}


def _job(series_id: int, job_id: str, user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    job = _jobs.get(job_id)
    if not job or job["series_id"] != series_id or job["user_id"] != user.get("id"):
        return None
    return job


@router.get("/{series_id}/sensor/job/{job_id}")
def measure_job(series_id: int, job_id: str, user: Dict[str, Any] = Depends(current_user)):
    job = _job(series_id, job_id, user)
    if not job:
        return _err(404, "not_found", "Unknown measurement.")
    return {k: job[k] for k in ("id", "vno", "done", "total", "queued", "finished", "result", "error")}


@router.post("/{series_id}/sensor/job/{job_id}/cancel")
def measure_cancel(series_id: int, job_id: str, user: Dict[str, Any] = Depends(current_user)):
    job = _job(series_id, job_id, user)
    if not job:
        return _err(404, "not_found", "Unknown measurement.")
    job["cancel"] = True
    return {"ok": True}


# ------------------------------------------------------------------------------------ TDMS Inspector: free measurement
@inspector_router.get("/setup")
def inspector_setup(user: Dict[str, Any] = Depends(_inspector)):
    """Boxes (or why none) and sensors - like the series setup, without trials."""
    boxes, box_error = [], None
    try:
        boxes = sm.list_boxes()
    except sm.MeasureError as e:
        box_error = _error_json(e)
    return {"can_write": ta.can_edit_trials(user), "boxes": boxes, "box_error": box_error,
            "sensors": sm.sensor_presets(), "length": sm.DEFAULT_LENGTH_M, "speed_range": list(sm.SPEED_RANGE),
            "length_range": list(sm.LENGTH_RANGE), "manual_dir": sm.MANUAL_DIR}


@inspector_router.post("/zero")
def inspector_zero(body: ZeroBody, user: Dict[str, Any] = Depends(_inspector)):
    return zero(0, body, user)


class FreeBody(SensorChoice):
    name: str
    speed: float
    length: float
    kind: str = "dty"
    zero: Optional[Dict[str, Any]] = None


@inspector_router.post("/measure")
def inspector_measure(body: FreeBody, user: Dict[str, Any] = Depends(_inspector)):
    """Measure with own name + speed -> <DTY|ATY folder>/_manual/<name>_<date>.tdms (sensor_measure.measure_free).
    The finished job's result carries series_id = the inspector number of the new file, so the page opens it."""
    if not ta.can_edit_trials(user):
        return _err(403, "read_only", "Write access required.")
    p = _preset(body.sensor)
    if not p:
        return _err(400, "head_missing", "Unknown sensor.", head=body.sensor)
    if body.kind not in sm.KINDS:
        return _err(400, "bad_kind", "Unknown folder.")
    try:
        name = sm.check_name(body.name)
        sm.check_plan(body.speed, body.length, p["axes"])
    except sm.MeasureError as e:
        return _merr(e)
    from . import tdms_inspector
    username = str(user.get("username") or "")
    kwargs = dict(name=name, box=body.box, head_name=p["head"], connector=p["connector"], speed_m_min=body.speed,
                  length_m=body.length, kind=body.kind, user={"id": user.get("id"), "username": username},
                  zero=body.zero if isinstance(body.zero, dict) else None)

    def opened(res: Dict[str, Any]) -> Dict[str, Any]:
        path = res.pop("path")                   # the server path stays on the server
        res["series_id"] = tdms_inspector.register(path, res["file"], username)
        res["size"] = os.path.getsize(path)
        return res
    return _start_job(0, user, name, kwargs, fn=sm.measure_free, on_done=opened)


@inspector_router.get("/job/{job_id}")
def inspector_job(job_id: str, user: Dict[str, Any] = Depends(_inspector)):
    return measure_job(0, job_id, user)


@inspector_router.post("/job/{job_id}/cancel")
def inspector_cancel(job_id: str, user: Dict[str, Any] = Depends(_inspector)):
    return measure_cancel(0, job_id, user)
