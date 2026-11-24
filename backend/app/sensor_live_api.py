"""sensor_live_api.py - "YarnScope Live" (/tools/yarnscope-live; desktop ui/widgets/sensor_live_window.py).

Continuous measurement with a small dashboard (Nutzerwunsch 2026-11-23): start / stop by hand, every 30 m knots/m +
CV per sensor and - with a second sensor + the distance - the measured speed. Logic: ui/yarnscope/sensor_live.py in
the desktop repo (one live session per process; THE SERVER talks to the box, so this works while the web server runs
on the laptop the box hangs on). The browser only chooses box / sensor keys out of the user's Sensoft
configurations / numbers; the page polls /state every second.
Rights: feature tdms_inspector to look, write access (level 2) to start (saving writes to the share); stop = whoever
started it or a superuser.
Bookmarks (Nutzerwunsch 2026-11-24): POST /bookmark keeps the last N m in the server's memory (no input while tuning);
on a bookmark /bookmark/{id}/trial copies a template trial with the typed jet / pressure / OF / speed and - only if
asked - writes the bookmark as that trial's TDMS (ui/yarnscope/live_trial.py); /bookmark/{id}/file writes it to _manual.
The browser sends only ids, field keys and typed values; series, template and fields are checked on the server.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature
from .sensor_api import _err, _merr, _error_json, _second_kw, _sensors, _zeros

from db import display_settings as ds  # noqa: E402
from db import trial_actions as ta  # noqa: E402
from db import trial_copy as tc  # noqa: E402
from ui.yarnscope import live_trial  # noqa: E402
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
            "default_distance_mm": DEFAULT_DISTANCE_MM, "zeros": _zeros()}


class ZeroBody(BaseModel):
    box: str
    sensor: str
    second: Optional[str] = None


@router.post("/zero")
def zero(body: ZeroBody, user: Dict[str, Any] = Depends(_feature)):
    """Empty value (no yarn) before the start - remembered per box/head/connector like the measure window
    (sensor_measure.zero_check); the live session writes it into its files."""
    if not ta.can_edit_trials(user):
        return _err(403, "read_only", "Write access required.")
    cur = sl.current()
    if cur is not None and cur.state in ("running", "stopping"):
        return _err(409, "busy", "A measurement is already running.")
    try:
        p, p2 = _sensors(body)
        z = sm.zero_check(body.box, p["head"], p["connector"])
        if p2:
            z["axes"] += sm.zero_check(body.box, p2["head"], p2["connector"])["axes"]
    except sm.MeasureError as e:
        return _merr(e)
    return z


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


# ---------------------------------------------------------------------------------------------------- bookmarks
def _session_or_err():
    s = sl.current()
    if s is None:
        return None, _err(404, "no_session", "No live measurement.")
    return s, None


class BookmarkBody(BaseModel):
    length: Optional[float] = None
    label: Optional[str] = None


@router.post("/bookmark")
def bookmark(body: BookmarkBody, user: Dict[str, Any] = Depends(_feature)):
    if not ta.can_edit_trials(user):
        return _err(403, "read_only", "Write access required.")
    s, err = _session_or_err()
    if err:
        return err
    try:
        return s.bookmark(body.length, body.label)
    except sm.MeasureError as e:
        return _merr(e)


@router.post("/bookmark/{bid}/label")
def bookmark_label(bid: int, body: BookmarkBody, user: Dict[str, Any] = Depends(_feature)):
    s, err = _session_or_err()
    if err:
        return err
    try:
        return s.label_bookmark(bid, body.label)
    except sm.MeasureError as e:
        return _merr(e)


@router.delete("/bookmark/{bid}")
def bookmark_delete(bid: int, user: Dict[str, Any] = Depends(_feature)):
    s, err = _session_or_err()
    if err:
        return err
    try:
        s.delete_bookmark(bid)
    except sm.MeasureError as e:
        return _merr(e)
    return {"ok": True}


def _val_json(f: tc.CopyField, v: Any) -> Dict[str, Any]:
    if v is tc.NOT_AVAILABLE:
        return {"na": True}
    return {"v": None if v is None else (v if isinstance(v, (int, float, str)) else str(v)),
            "text": tc.display_value(f, v)}


@router.get("/trial-setup")
def trial_setup(series: Optional[int] = None, user: Dict[str, Any] = Depends(_feature)):
    """Without series: the user's recent series (same list as the desktop). With series: its trials, the default
    template (highest number), the copy fields shown by default and every trial's values for them."""
    recent = [{"series": int(e["series"]), "eid": e.get("eid") or "", "name": e.get("name") or ""}
              for e in (ds.load(user.get("id")) or {}).get("recent_series") or [] if e.get("series")]
    if series is None:
        return {"recent": recent}
    info = live_trial.series_info(series)
    if info is None:
        return _err(404, "no_series", "No trial series with this number.", series=series)
    st = live_trial.setup(info["id"])
    fields = st["fields"]
    return {"recent": recent, "series": info, "next_no": st["next_no"], "default": st["default"],
            "trials": [{"id": int(t["id"]), "vno": int(t["vno"])} for t in sorted(st["trials"], key=lambda t: t["vno"])],
            "fields": [{"key": f.key, "label": f.label, "rule": f.rule,
                        "choices": [[k, n] for k, n in (f.choices or [])] or None} for f in fields],
            "source": {str(tid): {f.key: _val_json(f, vals.get(f.key)) for f in fields}
                       for tid, vals in st["source"].items()}}


class TrialBody(BaseModel):
    series_id: int
    template_id: int
    values: Dict[str, Any] = {}
    save_tdms: bool = False


@router.post("/bookmark/{bid}/trial")
def bookmark_trial(bid: int, body: TrialBody, user: Dict[str, Any] = Depends(_feature)):
    if not ta.can_edit_trials(user):
        return _err(403, "read_only", "Write access required.")
    s, err = _session_or_err()
    if err:
        return err
    if live_trial.series_info(body.series_id) is None:
        return _err(404, "no_series", "No trial series with this number.", series=body.series_id)
    try:
        r = live_trial.create(body.series_id, body.template_id, body.values, user=user, session=s,
                              bookmark_id=bid, save_tdms=body.save_tdms)
    except sm.MeasureError as e:
        return _merr(e)
    from db.usage_log import log_usage_event
    log_usage_event("feature", "live_trial", f"web series {body.series_id} V{r['vno']} tdms={bool(r.get('file'))}")
    return r


@router.post("/trial")
def trial_without_bookmark(body: TrialBody, user: Dict[str, Any] = Depends(_feature)):
    """A trial without a bookmark (Nutzerwunsch 2026-11-24): the same copy with jet / pressure / OF / speed, never a
    TDMS - works without a live measurement too."""
    if not ta.can_edit_trials(user):
        return _err(403, "read_only", "Write access required.")
    if live_trial.series_info(body.series_id) is None:
        return _err(404, "no_series", "No trial series with this number.", series=body.series_id)
    try:
        r = live_trial.create(body.series_id, body.template_id, body.values, user=user, save_tdms=False)
    except sm.MeasureError as e:
        return _merr(e)
    from db.usage_log import log_usage_event
    log_usage_event("feature", "live_trial", f"web series {body.series_id} V{r['vno']} without bookmark")
    return r


class TrialItem(BaseModel):
    values: Dict[str, Any] = {}
    bookmark: Optional[int] = None          # this trial's TDMS = that bookmark (None = no file)


class TrialsBody(BaseModel):
    series_id: int
    template_id: int
    items: list[TrialItem]


@router.post("/trials")
def trials_many(body: TrialsBody, user: Dict[str, Any] = Depends(_feature)):
    """Several trials in one go (Nutzerwunsch 2026-11-24, e.g. jet plate 1 and 2): one copy per item with its values, each
    optionally with its own bookmark as TDMS (live_trial.create_many - all checked before the first copy)."""
    if not ta.can_edit_trials(user):
        return _err(403, "read_only", "Write access required.")
    if live_trial.series_info(body.series_id) is None:
        return _err(404, "no_series", "No trial series with this number.", series=body.series_id)
    s = sl.current()
    if any(it.bookmark is not None for it in body.items) and s is None:
        return _err(404, "no_session", "No live measurement.")
    items = [{"values": it.values, "bookmark_id": it.bookmark, "save_tdms": it.bookmark is not None} for it in body.items]
    try:
        out = live_trial.create_many(body.series_id, body.template_id, items, user=user, session=s)
    except sm.MeasureError as e:
        return _merr(e)
    from db.usage_log import log_usage_event
    log_usage_event("feature", "live_trial", f"web series {body.series_id} {len(out)} trials, "
                                             f"{sum(1 for r in out if r.get('file'))} with TDMS")
    return {"trials": out}


class FileBody(BaseModel):
    name: str


@router.post("/bookmark/{bid}/file")
def bookmark_file(bid: int, body: FileBody, user: Dict[str, Any] = Depends(_feature)):
    if not ta.can_edit_trials(user):
        return _err(403, "read_only", "Write access required.")
    s, err = _session_or_err()
    if err:
        return err
    try:
        r = live_trial.save_file(s, bid, body.name)
    except sm.MeasureError as e:
        return _merr(e)
    return {"file": r["file"], "files": r["files"], "next_name": sm.next_name(body.name.strip())}


# ------------------------------------------------------------------------------------------------ saved runs
# Nutzerwunsch 2026-11-24: load a saved live run again and see exactly its curves (sensor_live.load_saved). With its side
# file at once; an older run is analysed again in a background job (the page polls it).
import threading  # noqa: E402
import uuid  # noqa: E402

_load_jobs: Dict[str, Dict[str, Any]] = {}
_load_lock = threading.Lock()


@router.get("/saved")
def saved(kind: str = "dty", user: Dict[str, Any] = Depends(_feature)):
    if kind not in sm.KINDS:
        return _err(400, "bad_kind", "Unknown folder.")
    try:
        return {"runs": sl.saved_runs(kind)}
    except sm.MeasureError as e:
        return _merr(e)


class LoadBody(BaseModel):
    file: str
    kind: str = "dty"


@router.post("/saved/load")
def saved_load(body: LoadBody, user: Dict[str, Any] = Depends(_feature)):
    if body.kind not in sm.KINDS:
        return _err(400, "bad_kind", "Unknown folder.")
    try:
        name = sl._check_file(body.file)
    except sm.MeasureError as e:
        return _merr(e)
    if (sl._manual_dir(body.kind) / (name + sl.SIDE_SUFFIX)).is_file():
        try:
            return {"view": sl.load_saved(name, body.kind)}
        except sm.MeasureError as e:
            return _merr(e)
    if not (sl._manual_dir(body.kind) / name).is_file():
        return _err(404, "no_file", "File not found.", file=name)
    jid = uuid.uuid4().hex[:12]
    job: Dict[str, Any] = {"id": jid, "user": user.get("id"), "done": 0, "total": 0, "finished": False, "view": None,
                           "error": None}
    with _load_lock:
        for k in [k for k, j in _load_jobs.items() if j["finished"]]:
            _load_jobs.pop(k, None)
        _load_jobs[jid] = job

    def run():
        def progress(a, b):
            job["done"], job["total"] = a, b
        try:
            job["view"] = sl.load_saved(name, body.kind, progress=progress)
        except Exception as e:  # noqa: BLE001 - shown on the page
            job["error"] = _error_json(e)
        job["finished"] = True

    threading.Thread(target=run, name="yarnscope-live-load", daemon=True).start()
    return {"job_id": jid}


@router.get("/saved/job/{job_id}")
def saved_job(job_id: str, user: Dict[str, Any] = Depends(_feature)):
    job = _load_jobs.get(job_id)
    if job is None or job["user"] != user.get("id"):
        return _err(404, "no_job", "Unknown job.")
    return {k: v for k, v in job.items() if k != "user"}
