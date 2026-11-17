"""series_manage.py - right-click menu of a series in Backlog / All Experiments (desktop:
BacklogScreen / AllExperimentsScreen context menus).

Rules and writes come from the shared modules: db/series_actions.py (rename, machine, priority,
notes), db/trial_actions.py (reassign yarn), db/backlog_moves.py (status), db/series_permissions.py
+ db/recycle_bin.py (delete, see series_actions router). The page only sends what the user chose.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user

from db import backlog_moves as bm  # noqa: E402
from db import recycle_bin  # noqa: E402
from db import series_actions as sa  # noqa: E402
from db import series_permissions as sp  # noqa: E402
from db import trial_actions as ta  # noqa: E402
from db.connection import fetch_all  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/series")

STATUS_IDS = (1, 2, 3, 4, 5)


def _err(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _row(series_id: int) -> Optional[Dict[str, Any]]:
    rows = fetch_all("SELECT ID, SeriesName, BacklogPrio, BacklogStatusID, BacklogOwner, MachineID "
                     "FROM tblTrialSeries WHERE ID = ?", [int(series_id)])
    return rows[0] if rows else None


@router.get("/{series_id}/manage")
def manage_info(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    """What the menu offers for this series and this user (disabled entries carry the reason)."""
    r = _row(series_id)
    if r is None:
        return _err(404, "not_found", "This series no longer exists.")
    level = int(user.get("access_level") or 0)
    old = int(r.get("BacklogStatusID") or 0)
    statuses = []
    for sid in STATUS_IDS:
        reason = None if sid == old else bm.check_move(old, sid, user_id=user.get("id"), access_level=level,
                                                         owner_id=r.get("BacklogOwner"))
        statuses.append({"id": sid, "current": sid == old, "allowed": sid != old and reason is None,
                         "reason": reason})          # code -> bl.err.<code> in the page
    prefix, editable = sa.split_prefix(str(r.get("SeriesName") or "").strip("\n"))
    mid, mname = sa.current_machine(series_id)
    return {
        "name": str(r.get("SeriesName") or ""), "prefix": prefix, "editable": editable,
        "prio": r.get("BacklogPrio"), "status_id": old, "machine_id": mid, "machine": mname,
        "statuses": statuses,
        "rights": {"rename": sa.can_rename(user), "prio": sa.can_change_prio(user),
                   "machine": sa.can_change_machine(user), "reassign_yarn": ta.can_reassign_yarn(user),
                   "delete": bool(recycle_bin.available() and sp.can_delete_series_now(series_id))},
    }


class Rename(BaseModel):
    text: str


@router.post("/{series_id}/rename")
def rename(series_id: int, body: Rename, user: Dict[str, Any] = Depends(current_user)):
    if not sa.can_rename(user):
        return _err(403, "forbidden", "You do not have permission to rename this trial series.")
    if _row(series_id) is None:
        return _err(404, "not_found", "This series no longer exists.")
    new_full = sa.rename(series_id, body.text)
    if new_full is None:
        return _err(400, "empty", "The name is empty.")
    return {"name": new_full}


class Prio(BaseModel):
    prio: int


@router.post("/{series_id}/prio")
def prio(series_id: int, body: Prio, user: Dict[str, Any] = Depends(current_user)):
    if not sa.can_change_prio(user):
        return _err(403, "forbidden", "You may not change the priority.")
    if not 0 <= body.prio <= 999:          # desktop: QInputDialog.getInt(0, 999)
        return _err(400, "range", "The priority must be between 0 and 999.")
    if _row(series_id) is None:
        return _err(404, "not_found", "This series no longer exists.")
    sa.set_backlog_prio(series_id, body.prio)
    return {"ok": True}


@router.get("/{series_id}/machines")
def machines(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    if not sa.can_change_machine(user):
        return _err(403, "forbidden", "Only superusers may change the machine of a trial series.")
    mid, _name = sa.current_machine(series_id)
    return {"current": mid, "machines": [{"id": m["ID"], "name": m["Maschine"]} for m in sa.list_machines()]}


class Machine(BaseModel):
    machine_id: int


@router.post("/{series_id}/machine")
def change_machine(series_id: int, body: Machine, user: Dict[str, Any] = Depends(current_user)):
    if not sa.can_change_machine(user):
        return _err(403, "forbidden", "Only superusers may change the machine of a trial series.")
    if body.machine_id not in {m["ID"] for m in sa.list_machines()}:
        return _err(400, "bad_machine", "Unknown machine.")
    if _row(series_id) is None:
        return _err(404, "not_found", "This series no longer exists.")
    sa.change_machine(series_id, body.machine_id, user)
    return {"ok": True}


class NotesText(BaseModel):
    text: str


@router.post("/{series_id}/notes-text")
def save_series_notes(series_id: int, body: NotesText, user: Dict[str, Any] = Depends(current_user)):
    """Notes of the series (Show Experiment, Notes tab)."""
    if not sa.can_save_notes(user):
        return _err(403, "read_only", "You have read-only access.")
    if _row(series_id) is None:
        return _err(404, "not_found", "This series no longer exists.")
    sa.save_notes(series_id, body.text)
    return {"ok": True}


# ------------------------------------------------------------------ reassign yarn (superusers)
@router.get("/{series_id}/yarn-lines")
def yarn_lines(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    if not ta.can_reassign_yarn(user):
        return _err(403, "forbidden", "Only superusers may change the yarn of a trial series.")
    choices = ta.reassign_yarn_choices()
    names = {int(c["ID"]): str(c["Name"] or "") for c in choices}
    lines = [{"ply": l.get("Ply"), "yarn_id": l.get("YarnID"),
              "yarn": names.get(int(l["YarnID"])) if l.get("YarnID") is not None else ""}
             for l in ta.series_ply_yarns(series_id)]
    return {"lines": lines, "choices": [{"id": int(c["ID"]), "name": str(c["Name"] or "")} for c in choices]}


class YarnRow(BaseModel):
    orig_ply: Optional[str] = None
    orig_yid: Optional[int] = None
    new_yid: Optional[int] = None
    deleted: bool = False
    is_new: bool = False


class YarnPlan(BaseModel):
    rows: List[YarnRow]
    apply: bool = False


@router.post("/{series_id}/yarns/reassign")
def reassign_yarn(series_id: int, body: YarnPlan, user: Dict[str, Any] = Depends(current_user)):
    """Check (apply=False) or write (apply=True) the ply/yarn lines - desktop "Reassign yarn…"."""
    if not ta.can_reassign_yarn(user):
        return _err(403, "forbidden", "Only superusers may change the yarn of a trial series.")
    current = {(l.get("Ply"), l.get("YarnID")) for l in ta.series_ply_yarns(series_id)}
    rows = [r.model_dump() for r in body.rows]
    for r in rows:   # existing lines must be lines of this series (the page cannot invent plies to update)
        if not r["is_new"] and (r["orig_ply"], r["orig_yid"]) not in current:
            return _err(409, "stale", "The plies of this series changed meanwhile - please open the dialog again.")
    names = {int(c["ID"]): str(c["Name"] or "") for c in ta.reassign_yarn_choices()}
    if any(r["new_yid"] is not None and int(r["new_yid"]) not in names for r in rows if not r["deleted"]):
        return _err(400, "bad_yarn", "Unknown yarn.")
    try:
        plan = ta.plan_yarn_reassign(series_id, rows, names)
    except ValueError as e:
        return _err(400, "invalid", str(e))
    if plan["conflicts"] or not body.apply:
        return {"conflicts": plan["conflicts"], "message": ta.conflict_message(plan["conflicts"]) if plan["conflicts"] else "",
                "applied": False}
    n = ta.apply_yarn_reassign(series_id, plan, user)
    log_usage_event("feature", "reassign_yarn", f"web {n}")
    return {"conflicts": [], "applied": True, "changes": n}


# ------------------------------------------------------------------ trial labels (Print labels)
from fastapi.responses import Response  # noqa: E402

from db import label_sheets as ls  # noqa: E402
from db import trial_labels as tl  # noqa: E402


@router.get("/{series_id}/labels")
def labels_info(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """Trial range, header line and the saved 'TrialLabel' sheet template (desktop PrintLabelsDialog)."""
    rng = tl.trial_label_range(series_id)
    return {"range": list(rng) if rng else None, "header": tl.trial_label_header(series_id),
            "template": {k: ls.load_label_template(tl.TEMPLATE_NAME).get(k) for k, _l in ls.TEMPLATE_FIELDS},
            "fields": [[k, label] for k, label in ls.TEMPLATE_FIELDS]}


class LabelReq(BaseModel):
    from_no: int
    to_no: int
    start_index: int = 0
    template: Dict[str, float]


def _clean_template(tpl: Dict[str, float]) -> Optional[Dict[str, float]]:
    keys = {k for k, _l in ls.TEMPLATE_FIELDS}
    if set(tpl) != keys or any(not (0 <= float(v) <= 2000) for v in tpl.values()):
        return None
    out = {k: float(v) for k, v in tpl.items()}
    out["ColumnCount"], out["RowCount"] = int(out["ColumnCount"]), int(out["RowCount"])
    if out["ColumnCount"] < 1 or out["RowCount"] < 1:
        return None
    return out


@router.post("/{series_id}/labels/pdf")
def labels_pdf(series_id: int, body: LabelReq, _user: Dict[str, Any] = Depends(current_user)):
    tpl = _clean_template(body.template)
    if tpl is None:
        return _err(400, "bad_template", "The sheet settings are not valid.")
    data = tl.trial_labels_pdf(series_id, body.from_no, body.to_no, max(0, body.start_index), tpl)
    if data is None:
        return _err(404, "no_trials", "No trials in this series.")
    log_usage_event("feature", "print_trial_labels", "web")
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="trial_labels_{series_id}.pdf"'})


class LabelTemplate(BaseModel):
    template: Dict[str, float]


@router.post("/labels/template")
def save_labels_template(body: LabelTemplate, _user: Dict[str, Any] = Depends(current_user)):
    """'Save template' - like the desktop, everybody may save the sheet settings."""
    tpl = _clean_template(body.template)
    if tpl is None:
        return _err(400, "bad_template", "The sheet settings are not valid.")
    ls.save_label_template(tl.TEMPLATE_NAME, tpl)
    return {"ok": True}
