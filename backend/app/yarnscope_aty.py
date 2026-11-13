"""yarnscope_aty.py - ATY YarnScope in the browser (desktop tab "YarnScope ATY", ui/aty_yarnscope_tab.py).

Everything is computed by the desktop's Qt-free ui/yarnscope/aty_service.py:
- single trial = thick-spot analysis (analyse_file) -> metrics line, Distribution (histograms),
  Garnspiegel / Fabric / Knitted geometry (thickness classes as KEYS, colours + visibility in the browser);
- Compare = core analysis of 2+ trials (tables, radar "yarn fingerprint", spacing / relative height
  histograms, signal & core zoom);
- Save / Batch = core analysis -> tblLaborATYoMat (aty_service.save_trial / analyse_core_file + save_db_row).
Write access (level 2) for Save and saving batches, like the DTY YarnScope of the web app.
"""
from __future__ import annotations

import threading
import time as _time
import uuid as _uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user
from .yarnscope import _executor   # one worker for all YarnScope batches (TDMS files are on one share)

from db import series_tables as stb  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from ui.yarnscope import aty_service as svc  # noqa: E402

router = APIRouter(prefix="/api")

CACHE_SIZE = 6
_cache: "OrderedDict[Tuple[int, str, float], Dict[str, Any]]" = OrderedDict()      # thick-spot analysis
_core: "OrderedDict[Tuple[int, str, float], Dict[str, Any]]" = OrderedDict()       # core analysis (Compare)
_lock = threading.Lock()
_jobs: Dict[str, Dict[str, Any]] = {}


def _json(obj: Any) -> Response:
    import json
    return Response(json.dumps(svc.jsonable(obj)), media_type="application/json")


def _err(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _files(series_id: int, with_analysed: bool = False) -> Tuple[list, Dict[int, str]]:
    st = stb.load_trials(series_id)
    labels = {int(t["ID"]): st.labels[i] for i, t in enumerate(st.trials)}
    return svc.trial_files(series_id, st.trials, set(st.reference_names), with_analysed=with_analysed), labels


def _trial_file(series_id: int, trial_id: int) -> Optional[dict]:
    files, _labels = _files(series_id)
    return next((f for f in files if int(f["trial_id"]) == int(trial_id) and f.get("tdms") is not None), None)


def _key(trial_id: int, path: Path) -> Tuple[int, str, float]:
    try:
        mtime = Path(path).stat().st_mtime
    except OSError:
        mtime = 0.0
    return int(trial_id), str(path), mtime


def _put(cache: OrderedDict, k, v) -> None:
    with _lock:
        cache[k] = v
        cache.move_to_end(k)
        while len(cache) > CACHE_SIZE:
            cache.popitem(last=False)


def _get(cache: OrderedDict, k):
    with _lock:
        hit = cache.get(k)
        if hit is not None:
            cache.move_to_end(k)
        return hit


def has_yarnscope_aty(series_id: int) -> bool:
    try:
        return bool(svc.series_has_tdms(series_id))
    except Exception:
        return False


def _entry(series_id: int, trial_id: int):
    f = _trial_file(series_id, trial_id)
    if f is None:
        return None
    return _get(_cache, _key(trial_id, f["tdms"]))


def _not_analysed() -> JSONResponse:
    return _err(409, "not_analysed", "Analyse the trial first.")


# ------------------------------------------------------------------ trials + single trial
@router.get("/series/{series_id}/aty")
def trials(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    files, labels = _files(series_id, with_analysed=True)
    out = []
    for f in files:
        path = f.get("tdms")
        loaded = False
        if path is not None:
            with _lock:
                loaded = _key(f["trial_id"], path) in _cache
        out.append({"trial_id": int(f["trial_id"]), "vno": f["vno"],
                    "label": labels.get(int(f["trial_id"]), svc.trial_label(f["vno"])),
                    "has_file": path is not None, "file": Path(path).name if path is not None else None,
                    "analysed": bool(f.get("analysed")), "loaded": loaded})
    return {"trials": out, "folder_ok": svc.tdms_base().exists(), "controls": svc.CONTROLS,
            "features": svc.HIST_FEATURES, "class_colours": {"di": svc.tc.DI_COLORS, "due": svc.tc.DUE_COLORS}}


def _result(entry: Dict[str, Any]) -> dict:
    total_m = len(entry["arr"]) * entry["mm_pp"] / 1000.0
    return {"metrics": svc.metrics_json(entry["db_vals"]), "total_m": total_m, "mm_pp": entry["mm_pp"],
            "spots": len(entry.get("spots") or [])}


@router.post("/series/{series_id}/aty/{trial_id}/analyse")
def analyse(series_id: int, trial_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """Desktop "Analysieren": thick-spot analysis (kept in the server cache)."""
    f = _trial_file(series_id, trial_id)
    if f is None:
        return _err(404, "no_file", "No TDMS file for this trial.")
    k = _key(trial_id, f["tdms"])
    entry = _get(_cache, k)
    if entry is None:
        try:
            entry = svc.analyse_file(f["tdms"])
        except ValueError as e:
            return _err(422, "no_signal", str(e))
        _put(_cache, k, entry)
        log_usage_event("feature", "yarnscope_aty", "web")
    return _json(_result(entry))


@router.get("/series/{series_id}/aty/{trial_id}/hist")
def hist(series_id: int, trial_id: int, feature: str = "F01_length_mm", _user: Dict[str, Any] = Depends(current_user)):
    entry = _entry(series_id, trial_id)
    if entry is None:
        return _not_analysed()
    if feature not in dict(svc.HIST_FEATURES):
        return _err(400, "bad_feature", "Unknown feature.")
    return _json(svc.histogram_view(entry["hists"], feature))


def _clamp(name: str, v: float) -> float:
    _d, lo, hi = svc.CONTROLS[name]
    return max(lo, min(float(v), hi))


@router.get("/series/{series_id}/aty/{trial_id}/garnspiegel")
def garnspiegel(series_id: int, trial_id: int, start: float = 0.0, turns: int = 10, gap: float = 2.0,
                _user: Dict[str, Any] = Depends(current_user)):
    entry = _entry(series_id, trial_id)
    if entry is None:
        return _not_analysed()
    lay = svc.garnspiegel_view(entry, _clamp("start_m", start), int(_clamp("turns", turns)), _clamp("gap", gap))
    return _json(svc.garnspiegel_json(lay))


@router.get("/series/{series_id}/aty/{trial_id}/fabric")
def fabric(series_id: int, trial_id: int, bands: int = 250, _user: Dict[str, Any] = Depends(current_user)):
    entry = _entry(series_id, trial_id)
    if entry is None:
        return _not_analysed()
    return _json(svc.fabric_view(entry, int(_clamp("bands", bands))))


@router.get("/series/{series_id}/aty/{trial_id}/knitted")
def knitted(series_id: int, trial_id: int, rows: int = 50, _user: Dict[str, Any] = Depends(current_user)):
    entry = _entry(series_id, trial_id)
    if entry is None:
        return _not_analysed()
    return _json(svc.knitted_view(entry, int(_clamp("rows", rows))))


@router.post("/series/{series_id}/aty/{trial_id}/save")
def save(series_id: int, trial_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Desktop "Save to DB": core analysis of the loaded signal -> tblLaborATYoMat."""
    if int(user.get("access_level") or 0) < 2:
        return _err(403, "read_only", "You have read-only access.")
    entry = _entry(series_id, trial_id)
    if entry is None:
        return _not_analysed()
    if not svc.save_trial(int(trial_id), entry["arr"], float(entry["mm_pp"]), entry.get("ell"), user):
        return _err(500, "save_failed", "The values could not be written to the database.")
    log_usage_event("feature", "yarnscope_aty_save", "web")
    return {"ok": True}


# ------------------------------------------------------------------ Compare
class CompareBody(BaseModel):
    trial_ids: List[int]
    start_m: float = 0.0          # start of the 40 mm "signal & core" zoom (desktop: Start [m] of the panel)


@router.post("/series/{series_id}/aty/compare")
def compare(series_id: int, body: CompareBody, _user: Dict[str, Any] = Depends(current_user)):
    """Desktop "Run Comparison": core analysis of the selected trials (analysed trials from the cache,
    others read from their TDMS file), sorted by trial number."""
    ids = list(dict.fromkeys(int(t) for t in body.trial_ids))
    if not ids:
        return _err(400, "compare_count", "Choose at least one trial.")
    files, _labels = _files(series_id)
    by_id = {int(f["trial_id"]): f for f in files if f.get("tdms") is not None}
    results, errors = [], []
    for tid in ids:
        f = by_id.get(tid)
        if f is None:
            errors.append(f"{tid}: no TDMS file")
            continue
        k = _key(tid, f["tdms"])
        core_r = _get(_core, k)
        entry = _get(_cache, k)
        try:
            if entry is not None:
                arr, mm_pp, ell = entry["arr"], entry["mm_pp"], entry.get("ell")
            else:
                arr, mm_pp, ell = svc.read_signal(f["tdms"])
                if arr is None:
                    raise ValueError("no signal")
            if core_r is None:
                core_r = svc.core_analysis(arr, mm_pp, ell)
                _put(_core, k, core_r)
            results.append((f["vno"], core_r, arr, float(mm_pp)))
        except Exception as e:
            errors.append(f"{svc.trial_label(f['vno'])}: {e}")
    results.sort(key=lambda r: (r[0] is None, r[0]))
    out = svc.compare_json(results, series_id, max(0.0, float(body.start_m)) * 1000.0)
    out["errors"] = "; ".join(errors)
    log_usage_event("feature", "yarnscope_aty_compare", f"web {len(results)}")
    return _json(out)


# ------------------------------------------------------------------ Batch (desktop screen_aty_batch, locked to the series)
class BatchBody(BaseModel):
    only_pending: bool = True
    trial_ids: Optional[list] = None
    save: bool = True


def _run_batch(job: Dict[str, Any], user: Dict[str, Any]) -> None:
    from .user_context import reset, set_user
    token = set_user(user)
    try:
        for row in job["rows"]:
            if job["stop"]:
                if row["status"] == "pending":
                    row["status"] = "skipped"
                continue
            if row["status"] != "pending":
                continue
            row["status"] = "running"
            job["current"] = row["label"]
            try:
                vals = svc.analyse_core_file(Path(row["_path"]))
                row["values"] = {key: vals.get(key) for _h, key, _d in svc.BATCH_COLUMNS}
                if job["save"]:
                    ok = svc.save_db_row(int(row["trial_id"]), vals, user)
                    row["status"] = "saved" if ok else "error"
                    if not ok:
                        row["error"] = "The values could not be written to the database."
                else:
                    row["status"] = "analysed"
            except Exception as e:
                row["status"] = "error"
                row["error"] = str(e)[:300]
            job["done"] += 1
        job["current"] = None
    finally:
        job["finished"] = True
        job["ended"] = _time.time()
        reset(token)


@router.post("/series/{series_id}/aty/batch")
def start_batch(series_id: int, body: BatchBody, user: Dict[str, Any] = Depends(current_user)):
    if body.save and int(user.get("access_level") or 0) < 2:
        return _err(403, "read_only", "You have read-only access.")
    running = [j for j in _jobs.values() if j["series_id"] == series_id and not j["finished"]]
    if running:
        return {"job_id": running[0]["id"]}
    files, labels = _files(series_id, with_analysed=True)
    wanted = {int(x) for x in body.trial_ids} if body.trial_ids else None
    rows = []
    for f in files:
        if f.get("tdms") is None:
            continue
        tid = int(f["trial_id"])
        selected = tid in wanted if wanted is not None else (not body.only_pending or not f.get("analysed"))
        rows.append({"trial_id": tid, "label": labels.get(tid, svc.trial_label(f["vno"])), "file": Path(f["tdms"]).name,
                     "_path": str(f["tdms"]), "status": "pending" if selected else "not selected",
                     "error": "", "values": None})
    job = {"id": _uuid.uuid4().hex[:12], "series_id": series_id, "rows": rows, "save": body.save,
           "total": sum(r["status"] == "pending" for r in rows), "done": 0, "current": None,
           "stop": False, "finished": False, "started": _time.time(), "ended": None}
    _jobs[job["id"]] = job
    if job["total"]:
        log_usage_event("feature", "yarnscope_aty_batch", f"web {job['total']}")
        _executor.submit(_run_batch, job, dict(user))
    else:
        job["finished"] = True
    return {"job_id": job["id"]}


def _job_json(job: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in job.items() if k != "rows"} | {
        "rows": [{k: v for k, v in r.items() if not k.startswith("_")} for r in job["rows"]],
        "columns": [{"label": h, "key": k, "decimals": d} for h, k, d in svc.BATCH_COLUMNS]}


@router.get("/aty/batch/{job_id}")
def batch_status(job_id: str, _user: Dict[str, Any] = Depends(current_user)):
    job = _jobs.get(job_id)
    if job is None:
        return _err(404, "not_found", "Batch not found.")
    return _json(_job_json(job))


@router.post("/aty/batch/{job_id}/stop")
def batch_stop(job_id: str, _user: Dict[str, Any] = Depends(current_user)):
    job = _jobs.get(job_id)
    if job is None:
        return _err(404, "not_found", "Batch not found.")
    job["stop"] = True
    return {"ok": True}


@router.get("/series/{series_id}/aty/batch/current")
def batch_current(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """The newest batch of this series (to show it again after reloading the page), like the DTY batch."""
    jobs = sorted((j for j in _jobs.values() if j["series_id"] == series_id), key=lambda j: j["started"])
    return _json(_job_json(jobs[-1])) if jobs else {"job": None}
