"""process_playground_api.py - Process Playground (/tools/process-playground; desktop ui/screen_process_playground.py)
on ui/dty_whatif.py + ui/process_playground_core.py (both Qt-free, the desktop screen uses them too).

The DTY trials are loaded once per process (Reload loads them again); the model fits are kept per yarn / jet
combination (they do not depend on the start). The browser sends combination key, start and slider values; the
server computes the statements, warnings (codes), suggestions and chart points. Only reads."""
from __future__ import annotations

import threading
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db.usage_log import log_usage_event  # noqa: E402
from ui import dty_whatif as w  # noqa: E402
from ui import process_playground_core as ppc  # noqa: E402

router = APIRouter(prefix="/api/process-playground")
_feature = require_feature("process_playground")

_lock = threading.Lock()
_state: Dict[str, Any] = {"ds": None, "fits": {}}
MAX_FITS = 60


def _err(code: str, detail: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _dataset(reload: bool = False) -> w.DataSet:
    with _lock:
        if reload or _state["ds"] is None:
            _state["ds"] = w.build_dataset(w.load_rows())
            _state["fits"] = {}
        return _state["ds"]


def _fits(key: str) -> dict:
    with _lock:
        f = _state["fits"]
        if key not in f:
            if len(f) >= MAX_FITS:
                f.pop(next(iter(f)))
            f[key] = {}
        return f[key]


def _combo(key: str):
    ds = _dataset()
    return ds, ppc.find_combo(ds, key)


def _start(c, start: Dict[str, Any]) -> Dict[str, float]:
    """Start values as numbers; a missing one = bottom of the measured range (desktop spin minimum)."""
    rng = ppc.slider_ranges(c)
    out = {}
    for p in w.PARAMS:
        v = start.get(p)
        try:
            out[p] = round(float(v), 6)
        except (TypeError, ValueError):
            out[p] = rng[p]["lo"]
    return out


@router.get("/data")
def data(reload: bool = False, user: Dict[str, Any] = Depends(_feature)):
    try:
        ds = _dataset(reload)
    except Exception as e:
        return _err("load_failed", f"The trials could not be loaded: {e}", 500)
    log_usage_event("feature", "process_playground_open", "web")
    return {"combos": ppc.combos_list(ds), "n_trials": len(ds.rows),
            "params": {p: {"label": v[0], "unit": v[2], "step": v[3], "dec": v[4]} for p, v in w.PARAMS.items()},
            "targets": {t: {"label": v[0], "unit": v[1], "dec": v[2]} for t, v in w.TARGETS.items()}}


@router.get("/combo")
def combo(key: str, user: Dict[str, Any] = Depends(_feature)):
    ds, c = _combo(key)
    if c is None:
        return _err("not_found", "This yarn / jet combination is not in the data (any more).", 404)
    opts, best = ppc.settings_options(c)
    return {"key": key, "yarn": c.yarn_name, "jet": c.jet_name, "trials": c.n_trials, "settings": c.n_settings,
            "series": c.n_series, "varied": list(c.varied), "options": opts, "best": best,
            "ranges": ppc.slider_ranges(c)}


class EvalIn(BaseModel):
    key: str
    start: Dict[str, Optional[float]]
    moved: Dict[str, Optional[float]] = {}


@router.post("/evaluate")
def evaluate(body: EvalIn, user: Dict[str, Any] = Depends(_feature)):
    ds, c = _combo(body.key)
    if c is None:
        return _err("not_found", "This yarn / jet combination is not in the data (any more).", 404)
    start = _start(c, body.start)
    new = ppc.new_settings(c, start, body.moved)
    ev = ppc.evaluate(ds, c, start, new, _fits(body.key))
    if ev["changed"]:
        log_usage_event("feature", "process_playground", f"change: {c.yarn_name} / {c.jet_name}")
    return {"start": start, "new": new, "changed": ev["changed"], "warnings": ev["warnings"], "rows": ev["rows"],
            "notes": ppc.start_check(c, start)}


class ChartIn(BaseModel):
    key: str
    start: Dict[str, Optional[float]]
    new: Dict[str, Optional[float]] = {}
    target: str
    param: str


@router.post("/chart")
def chart(body: ChartIn, user: Dict[str, Any] = Depends(_feature)):
    ds, c = _combo(body.key)
    if c is None:
        return _err("not_found", "This yarn / jet combination is not in the data (any more).", 404)
    if body.target not in w.TARGETS or body.param not in w.PARAMS:
        return _err("bad_request", "Unknown lab value or setting.")
    start = _start(c, body.start)
    new = {**start, **{p: float(v) for p, v in body.new.items() if p in w.PARAMS and v is not None}}
    return {"chart": ppc.chart_json(ds, c, _fits(body.key), body.target, body.param, start, new),
            "varied": body.param in c.varied}


class FindIn(BaseModel):
    key: str
    start: Dict[str, Optional[float]]
    goals: Dict[str, str] = {}
    main: str
    direction: str


@router.post("/find")
def find(body: FindIn, user: Dict[str, Any] = Depends(_feature)):
    ds, c = _combo(body.key)
    if c is None:
        return _err("not_found", "This yarn / jet combination is not in the data (any more).", 404)
    if body.main not in w.TARGETS or body.direction not in (w.UP, w.DOWN):
        return _err("bad_request", "Unknown main goal.")
    goals = {t: g for t, g in body.goals.items() if t in w.TARGETS and g in (w.UP, w.DOWN, w.KEEP)}
    goals[body.main] = body.direction
    start = _start(c, body.start)
    sugg, msg = w.suggest(c.rows, ds.margins, start, goals, body.main, fit_cache=_fits(body.key))
    log_usage_event("feature", "process_playground", f"find: {c.yarn_name} / {c.jet_name}")
    return {**ppc.suggestions_json(sugg, start, goals, body.main), "message": msg}


@router.get("/trial/{trial_id}")
def trial(trial_id: int, user: Dict[str, Any] = Depends(_feature)):
    """"Open in Process Playground" from Show Experiment."""
    res = ppc.trial_start(_dataset(), trial_id)
    if res is None:
        return _err("trial_unusable", "This trial has no yarn / jet combination with varied settings and lab values.", 404)
    key, start = res
    return {"key": key, "start": start}
