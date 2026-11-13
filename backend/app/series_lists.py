"""series_lists.py - All Experiments and Backlog (read only), data from db/series_overview.py."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db import backlog_moves as bm  # noqa: E402
from db import series_overview as so  # noqa: E402
from db.trial_reference import format_trial_number  # noqa: E402

router = APIRouter(prefix="/api")

BOARD_STATUSES = (1, 2, 3, 4)        # Backlog, In Progress, Done, To Be Cleaned; 5 = Archived panel
OWNER_COLOUR_STATUSES = (2, 3)       # desktop CardRowDelegate: stripe not in Backlog/To Be Cleaned/Archived


def _statuses() -> List[Dict[str, Any]]:
    return [{"id": int(r["ID"]), "name": r["BacklogStatus"]} for r in so.status_lookup()]


def _int(v: Any) -> Optional[int]:
    try:
        return None if v in (None, "") else int(v)
    except (TypeError, ValueError):
        return None


def _er(v: Any) -> Optional[Any]:
    return None if v in (None, "", 0, "0") else v


@router.get("/experiments")
def all_experiments(machine: Optional[str] = Query(None),
                    _user: Dict[str, Any] = Depends(require_feature("all_experiments"))) -> Dict[str, Any]:
    machine_id = so.MACHINE_FILTERS.get(machine) if machine else None
    rows = so.all_experiments_rows(machine_id, so.experiment_request_field())
    reports = so.series_report_map()
    statuses = {s["id"]: s["name"] for s in _statuses()}
    out = []
    for r in rows:
        sid = _int(r.get("series_id_pk"))
        status_id = _int(r.get("backlog_status_id"))
        out.append({
            "series_id": sid,
            "experiment_pk": _int(r.get("exp_id_pk")),
            "experiment_id": r.get("experiment_id"),
            "series_name": r.get("series_name") or "",
            "machine": r.get("maschine") or r.get("machine") or "",
            "creation_date": r.get("creation_date"),
            "owner": r.get("owner"),
            "status_id": status_id,
            "status": statuses.get(status_id) if status_id is not None else None,
            "has_attach": bool(r.get("has_attach")),
            "experiment_request_id": _er(r.get("experiment_request_id")),
            "has_notes": bool(r.get("has_notes")),
            "reports": reports.get(sid, 0) if sid is not None else 0,
        })
    return {"machines": list(so.MACHINE_FILTERS.keys()), "statuses": _statuses(), "rows": out}


def _card(r: Dict[str, Any], status_id: int, reports: Dict[int, int], flags: Dict[int, list]) -> Dict[str, Any]:
    sid = _int(r.get("TrialSeriesID"))
    retest = []
    for f in (flags.get(sid, []) if sid is not None else []):
        vno = f.get("Versuchsnummer")
        retest.append({
            "trial": format_trial_number(vno) if vno not in (None, "") else "?",
            "lab": f.get("LabSource") or "",
            "note": f.get("Note") or "",
        })
    colour = r.get("OwnerColour")
    return {
        "series_id": sid,
        "experiment_pk": _int(r.get("ExperimentPK")),
        "experiment_id": str(r.get("ExperimentID") or r.get("Experiment ID") or ""),
        "series_name": r.get("TrialSeries Name") or "",
        "machine": r.get("Maschine") or "",
        "status": r.get("Status") or "",
        "prio": r.get("Prio"),
        "owner": r.get("Owner") or "",
        "owner_colour": str(colour) if colour and status_id in OWNER_COLOUR_STATUSES else None,
        "has_attach": bool(int(r.get("HasImage") or 0) or int(r.get("HasPDF") or 0)),
        "has_notes": bool(int(r.get("HasNotes") or 0)),
        "experiment_request_id": _er(r.get("ExperimentRequestID")),
        "reports": reports.get(sid, 0) if sid is not None else 0,
        "retest": retest,
    }


@router.get("/backlog")
def backlog(user: Dict[str, Any] = Depends(require_feature("backlog"))) -> Dict[str, Any]:
    er_field = so.experiment_request_field()
    reports = so.series_report_map()
    flags = so.retest_flags_map()
    statuses = _statuses()
    boxes = []
    for st in statuses:
        if st["id"] in BOARD_STATUSES:
            boxes.append({**st, "cards": [_card(r, st["id"], reports, flags)
                                          for r in so.backlog_rows(st["id"], er_field)]})
    archived = []
    for r in so.archived_rows(er_field):
        exp_id = str(r.get("Experiment ID") or r.get("ExperimentID") or "")
        parts = exp_id.split("-")
        archived.append({
            "series_id": _int(r.get("TrialSeriesID")),
            "experiment_pk": _int(r.get("ExperimentPK")),
            "experiment_id": exp_id,
            "series_name": r.get("TrialSeries Name") or "",
            "machine": r.get("Maschine") or "",
            "experiment_request_id": _er(r.get("ExperimentRequestID")),
            # grouping like the desktop ArchivedPanel: year = first 4 digits, then the "XX" part
            "year": exp_id[:4] if exp_id[:4].isdigit() else "?",
            "xx": parts[1] if len(parts) >= 2 else "?",
        })
    # welcome line above the board (desktop _refresh_welcome_message; tblUser.WelcomeMessage via db/user_account) -
    # the page joins it with the first name, the default greeting is translated there
    from db.user_account import load_welcome_message
    return {"boxes": boxes, "archived": archived,
            "welcome": {"message": load_welcome_message(user.get("id")), "first_name": user.get("first_name") or ""}}


# --------------------------------------------------------------------------- moving cards
class MoveBody(BaseModel):
    series_id: int
    to_status: int
    machine_id: Optional[int] = None


@router.post("/backlog/move")
def move_card(body: MoveBody, user: Dict[str, Any] = Depends(require_feature("backlog"))):
    """Same rules and writes as the desktop drag & drop (db/backlog_moves.py).
    The old status is read from the DB (not trusted from the page)."""
    if body.to_status not in (1, 2, 3, 4, 5):
        return JSONResponse(status_code=400, content={"code": "bad_status", "detail": "Unknown status."})
    state = bm.series_state(body.series_id)
    if state is None:
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "This series no longer exists."})
    old, owner = state
    if old == body.to_status:
        return {"ok": True, "moved": False}
    uid = user.get("id")
    level = int(user.get("access_level") or 0)
    reason = bm.check_move(old or 0, body.to_status, user_id=uid, access_level=level, owner_id=owner)
    if reason:
        return JSONResponse(status_code=403, content={"code": reason, "detail": bm.DENY_MESSAGES[reason]})
    machine_id = None
    if bm.needs_machine(old or 0, body.to_status, body.series_id):
        machines = [{"id": int(m["ID"]), "name": m["Maschine"]} for m in bm.non_joker_machines()]
        if body.machine_id is None:
            return JSONResponse(status_code=409, content={
                "code": "need_machine", "machines": machines,
                "detail": "This series has a placeholder (joker) machine. Please choose the real machine."})
        if body.machine_id not in {m["id"] for m in machines}:
            return JSONResponse(status_code=400, content={"code": "bad_machine", "detail": "Unknown machine."})
        machine_id = body.machine_id
    bm.update_backlog_status(body.series_id, body.to_status, old, uid, machine_id)
    bm.after_move(body.series_id, body.to_status, uid)
    return {"ok": True, "moved": True}
