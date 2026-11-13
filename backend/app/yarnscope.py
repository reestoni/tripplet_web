"""yarnscope.py - DTY YarnScope in the browser. All computing is ui/yarnscope/dty_service.py
(shared with the desktop tab); this module only caches analyses and serves JSON.

Analyses take seconds and hold large arrays, so the last few are kept in memory
(key = trial + file path + file time; a new TDMS file analyses again).
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse, Response

from . import core  # noqa: F401
from .deps import current_user

from db import series_tables as stb  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from ui.yarnscope import dty_service as svc  # noqa: E402

router = APIRouter(prefix="/api")

CACHE_SIZE = 6
_cache: "OrderedDict[Tuple[int, str, float], Tuple[dict, dict]]" = OrderedDict()
_lock = threading.Lock()


def _json(obj: Any) -> Response:
    import json
    return Response(json.dumps(svc.jsonable(obj)), media_type="application/json")


def _trial_file(series_id: int, trial_id: int) -> Optional[Path]:
    st = stb.load_trials(series_id)
    for t in svc.trial_files(series_id, st.trials, set(st.reference_names)):
        if int(t["trial_id"]) == int(trial_id):
            return t["tdms"]
    return None


def _key(trial_id: int, path: Path) -> Tuple[int, str, float]:
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = 0.0
    return int(trial_id), str(path), mtime


def _cached(series_id: int, trial_id: int) -> Optional[Tuple[dict, dict]]:
    path = _trial_file(series_id, trial_id)
    if path is None:
        return None
    k = _key(trial_id, path)
    with _lock:
        hit = _cache.get(k)
        if hit:
            _cache.move_to_end(k)
        return hit


def _not_analysed() -> JSONResponse:
    return JSONResponse(status_code=409, content={"code": "not_analysed", "detail": "Analyse the trial first."})


@router.get("/series/{series_id}/yarnscope")
def trials(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    st = stb.load_trials(series_id)
    rows = svc.trial_files(series_id, st.trials, set(st.reference_names), with_analysed=True)
    labels = {int(t["ID"]): st.labels[i] for i, t in enumerate(st.trials)}
    out = []
    for r in rows:
        path = r["tdms"]
        loaded = False
        if path is not None:
            with _lock:
                loaded = _key(r["trial_id"], path) in _cache
        out.append({"trial_id": int(r["trial_id"]), "vno": r["vno"], "label": labels.get(int(r["trial_id"]), f"V{r['vno']}"),
                    "has_file": path is not None, "file": path.name if path is not None else None,
                    "analysed": bool(r.get("analysed")), "loaded": loaded})
    return {"trials": out, "folder_ok": svc.tdms_base().exists()}


@router.post("/series/{series_id}/yarnscope/{trial_id}/analyse")
def analyse(series_id: int, trial_id: int, _user: Dict[str, Any] = Depends(current_user)):
    path = _trial_file(series_id, trial_id)
    if path is None:
        return JSONResponse(status_code=404, content={"code": "no_file", "detail": "No TDMS file for this trial."})
    k = _key(trial_id, path)
    with _lock:
        hit = _cache.get(k)
    if hit is None:
        try:
            hit = svc.analyse_trial(path, trial_id)
        except ValueError as e:
            return JSONResponse(status_code=422, content={"code": "no_signal", "detail": str(e)})
        with _lock:
            _cache[k] = hit
            _cache.move_to_end(k)
            while len(_cache) > CACHE_SIZE:
                _cache.popitem(last=False)
        log_usage_event("feature", "yarnscope_dty", "web")
    res, vals = hit
    return _json(svc.result_json(res, vals))


@router.get("/series/{series_id}/yarnscope/{trial_id}/segment")
def segment(series_id: int, trial_id: int, start: float = 0.0, window: float = 3.0,
            _user: Dict[str, Any] = Depends(current_user)):
    hit = _cached(series_id, trial_id)
    if hit is None:
        return _not_analysed()
    res, vals = hit
    window = max(0.5, min(float(window), 200.0))
    return _json(svc.segment_view_json(svc.segment_view(res, vals, float(start), window)))


@router.get("/series/{series_id}/yarnscope/{trial_id}/signal")
def signal(series_id: int, trial_id: int, start: float = 0.0, window: float = 3.0,
           _user: Dict[str, Any] = Depends(current_user)):
    hit = _cached(series_id, trial_id)
    if hit is None:
        return _not_analysed()
    window = max(0.1, min(float(window), 50.0))
    return _json(svc.signal_view_json(svc.signal_view(hit[0], float(start), window)))


@router.get("/series/{series_id}/yarnscope/{trial_id}/garnspiegel")
def garnspiegel(series_id: int, trial_id: int, start: float = 0.0, _user: Dict[str, Any] = Depends(current_user)):
    hit = _cached(series_id, trial_id)
    if hit is None:
        return _not_analysed()
    return _json(svc.garnspiegel_json(svc.garnspiegel_view(hit[0], float(start))))


@router.post("/series/{series_id}/yarnscope/{trial_id}/save")
def save(series_id: int, trial_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Write the analysis into tbllabordtyomat (same as the desktop's Save) - write users only."""
    if int(user.get("access_level") or 0) < 2:
        return JSONResponse(status_code=403, content={"code": "read_only", "detail": "You have read-only access."})
    hit = _cached(series_id, trial_id)
    if hit is None:
        return _not_analysed()
    ok = svc.save_analysis(int(trial_id), hit[1], user)
    if not ok:
        return JSONResponse(status_code=500, content={"code": "save_failed", "detail": "The analysis could not be saved."})
    return {"ok": True}


def has_yarnscope(series_id: int) -> bool:
    try:
        return bool(svc.series_has_tdms(series_id))
    except Exception:
        return False


# --------------------------------------------------------------------------- batch (like the desktop "⚡ Batch")
import time as _time
import uuid as _uuid
from concurrent.futures import ThreadPoolExecutor
from pydantic import BaseModel

# one analysis at a time on the server (each takes seconds and a lot of memory)
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="yarnscope-batch")
_jobs: Dict[str, Dict[str, Any]] = {}
BATCH_COLUMNS = ["FPm", "CV_FP", "AvgKL", "CV_KL", "AvgOL", "CV_OL", "AKnots", "BKnots", "CKnots",
                 "Stab_03", "Stab_06", "Stab_10", "Stab_13"]


class BatchBody(BaseModel):
    only_pending: bool = True          # desktop default: skip trials already saved
    trial_ids: Optional[list] = None   # explicit selection wins (desktop: selected rows)
    save: bool = True


def _run_batch(job: Dict[str, Any], user: Dict[str, Any]) -> None:
    from .user_context import reset, set_user
    token = set_user(user)                       # save_analysis / usage log see the right user
    try:
        for row in job["rows"]:
            if job["stop"]:
                row["status"] = "skipped"
                continue
            if row["status"] != "pending":
                continue
            row["status"] = "running"
            job["current"] = row["label"]
            try:
                path = Path(row["_path"])
                res, vals = svc.analyse_trial(path, row["trial_id"])
                with _lock:
                    k = _key(row["trial_id"], path)
                    _cache[k] = (res, vals)
                    _cache.move_to_end(k)
                    while len(_cache) > CACHE_SIZE:
                        _cache.popitem(last=False)
                row["values"] = {c: vals.get(c) for c in BATCH_COLUMNS}
                if job["save"]:
                    ok = svc.save_analysis(int(row["trial_id"]), vals, user)
                    row["status"] = "saved" if ok else "error"
                    if not ok:
                        row["error"] = "The values could not be written to the database."
                else:
                    row["status"] = "analysed"
            except Exception as e:                # one bad file must not stop the others
                row["status"] = "error"
                row["error"] = str(e)[:300]
            job["done"] += 1
        job["current"] = None
    finally:
        job["finished"] = True
        job["ended"] = _time.time()
        reset(token)


@router.post("/series/{series_id}/yarnscope/batch")
def start_batch(series_id: int, body: BatchBody, user: Dict[str, Any] = Depends(current_user)):
    if body.save and int(user.get("access_level") or 0) < 2:
        return JSONResponse(status_code=403, content={"code": "read_only", "detail": "You have read-only access."})
    running = [j for j in _jobs.values() if j["series_id"] == series_id and not j["finished"]]
    if running:
        return {"job_id": running[0]["id"]}
    st = stb.load_trials(series_id)
    labels = {int(t["ID"]): st.labels[i] for i, t in enumerate(st.trials)}
    files = svc.trial_files(series_id, st.trials, set(st.reference_names), with_analysed=True)
    wanted = {int(x) for x in body.trial_ids} if body.trial_ids else None
    rows = []
    for f in files:
        if f["tdms"] is None:
            continue
        tid = int(f["trial_id"])
        selected = tid in wanted if wanted is not None else (not body.only_pending or not f.get("analysed"))
        rows.append({"trial_id": tid, "label": labels.get(tid, f"V{f['vno']}"), "file": f["tdms"].name,
                     "_path": str(f["tdms"]), "status": "pending" if selected else "not selected",
                     "error": "", "values": None})
    job = {"id": _uuid.uuid4().hex[:12], "series_id": series_id, "rows": rows, "save": body.save,
           "total": sum(r["status"] == "pending" for r in rows), "done": 0, "current": None,
           "stop": False, "finished": False, "started": _time.time(), "ended": None}
    _jobs[job["id"]] = job
    if job["total"]:
        log_usage_event("feature", "yarnscope_dty_batch", f"web {job['total']}")
        _executor.submit(_run_batch, job, dict(user))
    else:
        job["finished"] = True
    return {"job_id": job["id"]}


def _job_json(job: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in job.items() if k != "rows"} | {
        "rows": [{k: v for k, v in r.items() if not k.startswith("_")} for r in job["rows"]],
        "columns": BATCH_COLUMNS}


@router.get("/yarnscope/batch/{job_id}")
def batch_status(job_id: str, _user: Dict[str, Any] = Depends(current_user)):
    job = _jobs.get(job_id)
    if job is None:
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "Batch not found."})
    return _json(_job_json(job))


@router.post("/yarnscope/batch/{job_id}/stop")
def batch_stop(job_id: str, _user: Dict[str, Any] = Depends(current_user)):
    job = _jobs.get(job_id)
    if job is None:
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "Batch not found."})
    job["stop"] = True                          # the running trial finishes, the rest is skipped
    return {"ok": True}


@router.get("/series/{series_id}/yarnscope/batch/current")
def batch_current(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """The newest batch of this series (to show it again after reloading the page)."""
    jobs = sorted((j for j in _jobs.values() if j["series_id"] == series_id), key=lambda j: j["started"])
    return _json(_job_json(jobs[-1])) if jobs else {"job": None}
