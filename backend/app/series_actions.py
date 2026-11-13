"""series_actions.py - the right-click actions of Show Experiment / Backlog in the browser.

Same rules as the desktop, from the shared modules:
- notes on values / trials      db/cell_notes.py      (write: everybody, change: author, delete: author or superuser)
- change history of a value     db/change_log.py      (superuser, like ui/change_history_dialog.can_view_history)
- flag for retest (lab header)   db/retest_flags.py    (superuser)
- fill row (Machine Data / R&D) db/series_save.fill_* (the result goes into the unsaved edits of the page)
- delete trials / a series      db/recycle_bin.py     (rule of db/series_permissions.py)

Cells are always addressed as (tab, data row, data column); the DB binding is taken on the server.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user
from .series_edit import _load_tabs

from db import cell_notes  # noqa: E402
from db import change_log  # noqa: E402
from db import machine_data as mdm  # noqa: E402
from db import recycle_bin  # noqa: E402
from db import retest_flags  # noqa: E402
from db import series_permissions as sp  # noqa: E402
from db import series_save as ss  # noqa: E402
from db import series_tables as stb  # noqa: E402
from db import trial_reference  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api")

SUPERUSER = 4


def _err(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _level(user: Dict[str, Any]) -> int:
    return int(user.get("access_level") or 0)


def _binding(series_id: int, tab: str, r: int, c: int, mode: str, unit: str):
    """(binding, tab object) of one cell, or (None, tab)."""
    if mode not in mdm.VIEW_MODES:
        mode = "single"
    tabs, _extra, _md = _load_tabs(series_id, {tab}, mode, unit)
    t = tabs.get(tab)
    if t is None or not (0 <= r < len(t.cells)) or not (0 <= c < len(t.cells[r])):
        return None, t
    return t.cells[r][c][1], t


def _ids(b) -> List[int]:
    ids = getattr(b, "id_values", None)
    vals = list(ids) if ids is not None else [getattr(b, "id_value", None)]
    return sorted({int(i) for i in vals if i is not None})


def _note_out(n: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": int(n["ID"]), "text": str(n.get("NoteText") or ""), "user": (n.get("UserName") or "").strip(),
            "when": cell_notes.format_when(n.get("CreatedAt")),
            "edited": n.get("UpdatedAt") is not None,
            "changed_since": bool(cell_notes.value_changed_since(n)),
            "can_edit": cell_notes.can_edit(n), "can_delete": cell_notes.can_delete(n)}


def _trial_ids(series_id: int) -> List[int]:
    return [int(t) for t in stb.load_trials(series_id).trial_ids if t is not None]


# ------------------------------------------------------------------ notes
class CellRef(BaseModel):
    tab: str = ""           # "" + trial_id = note on the whole trial
    r: int = -1
    c: int = -1
    trial_id: Optional[int] = None
    mode: str = "single"
    unit: str = "Nm3h"


def _note_key(series_id: int, ref: CellRef):
    """(table, row id, field) where the notes of this cell/trial sit."""
    if not ref.tab:
        if ref.trial_id is None or int(ref.trial_id) not in _trial_ids(series_id):
            return None
        return ("tblTrial", int(ref.trial_id), "")
    b, _t = _binding(series_id, ref.tab, ref.r, ref.c, ref.mode, ref.unit)
    if b is None:
        return None
    ids = _ids(b)
    return (str(b.table), ids[0], str(b.field)) if ids else None


@router.post("/series/{series_id}/notes/list")
def notes_of_cell(series_id: int, ref: CellRef, _user: Dict[str, Any] = Depends(current_user)):
    if not cell_notes.available():
        return {"available": False, "notes": []}
    key = _note_key(series_id, ref)
    if key is None:
        return _err(400, "no_cell", "Notes cannot be attached here.")
    by_key = cell_notes.by_cell(cell_notes.notes_for_series(series_id, _trial_ids(series_id)))
    notes = by_key.get(cell_notes.cell_key(*key), [])
    if ref.tab:   # grouped ply cells: notes of every record of the group (like the desktop tooltip)
        b, _t = _binding(series_id, ref.tab, ref.r, ref.c, ref.mode, ref.unit)
        notes = cell_notes.notes_for_binding(by_key, b) if b is not None else notes
    return {"available": True, "notes": [_note_out(n) for n in notes]}


class NewNote(CellRef):
    text: str


@router.post("/series/{series_id}/notes")
def add_note(series_id: int, body: NewNote, _user: Dict[str, Any] = Depends(current_user)):
    if not cell_notes.available():
        return _err(409, "unavailable", "Notes are not set up in this database.")
    if not body.text.strip():
        return _err(400, "empty", "The note is empty.")
    key = _note_key(series_id, body)
    if key is None:
        return _err(400, "no_cell", "Notes cannot be attached here.")
    nid = cell_notes.add_note(key[0], key[1], key[2], body.text, series_id=series_id)
    log_usage_event("feature", "cell_note_add", "web trial" if not body.tab else f"web {key[0]}")
    return {"id": nid}


class NoteText(BaseModel):
    text: str


@router.put("/notes/{note_id}")
def edit_note(note_id: int, body: NoteText, _user: Dict[str, Any] = Depends(current_user)):
    n = cell_notes.get_note(note_id)
    if n is None:
        return _err(404, "not_found", "This note no longer exists.")
    if not cell_notes.can_edit(n):
        return _err(403, "forbidden", "Only the author can change a note.")
    if not body.text.strip():
        return _err(400, "empty", "The note is empty.")
    cell_notes.update_note(note_id, body.text)
    return {"ok": True}


@router.delete("/notes/{note_id}")
def remove_note(note_id: int, _user: Dict[str, Any] = Depends(current_user)):
    n = cell_notes.get_note(note_id)
    if n is None:
        return {"ok": True}
    if not cell_notes.can_delete(n):
        return _err(403, "forbidden", "Only the author or a superuser can delete a note.")
    cell_notes.delete_note(note_id)
    return {"ok": True}


# ------------------------------------------------------------------ change history (superuser)
def _show(t, r: int, raw: Any) -> str:
    if raw in (None, ""):
        return ""
    opts = t.options.get(r) if t is not None else None
    if opts:
        return opts.get(str(raw), opts.get(str(raw).split(".")[0], str(raw)))
    return str(raw)


def _when(dt: Any) -> str:
    return dt.strftime("%Y-%m-%d %H:%M") if hasattr(dt, "strftime") else str(dt or "")


@router.post("/series/{series_id}/history")
def cell_history(series_id: int, ref: CellRef, user: Dict[str, Any] = Depends(current_user)):
    if _level(user) < SUPERUSER:
        return _err(403, "forbidden", "Only superusers can see the change history.")
    if not change_log.table_ready():
        return {"available": False, "rows": []}
    b, t = _binding(series_id, ref.tab, ref.r, ref.c, ref.mode, ref.unit)
    if b is None:
        return _err(400, "no_cell", "This value has no history.")
    rows = change_log.history_for_cell(str(b.table), _ids(b), str(b.field))
    return {"available": True, "rows": [
        {"when": _when(x.get("ChangedAt")), "who": x.get("UserName") or "",
         "old": _show(t, ref.r, x.get("OldValue")), "new": _show(t, ref.r, x.get("NewValue"))} for x in rows]}


@router.get("/series/{series_id}/history")
def series_history(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    """All logged changes of the series (desktop: 'Whole series' in the history dialog)."""
    if _level(user) < SUPERUSER:
        return _err(403, "forbidden", "Only superusers can see the change history.")
    if not change_log.table_ready():
        return {"available": False, "rows": []}
    keys = {"machine", "rd"} | {lt.key for lt in stb.LAB_TABS}
    tabs, _e, _md = _load_tabs(series_id, keys, "single", "Nm3h")
    where: Dict[tuple, tuple] = {}            # (table, field) -> (tab, data row) for the title + dropdown names
    for name, t in tabs.items():
        for r, row in enumerate(t.cells):
            for _v, b in row:
                if b is not None:
                    where.setdefault((str(b.table).lower(), str(b.field).lower()), (name, r))
                    break
    out = []
    for x in change_log.history_for_series(series_id):
        k = (str(x.get("TableName") or "").lower(), str(x.get("FieldName") or "").lower())
        tab_r = where.get(k)
        t = tabs.get(tab_r[0]) if tab_r else None
        r = tab_r[1] if tab_r else -1
        vno = x.get("Versuchsnummer")
        out.append({"when": _when(x.get("ChangedAt")), "who": x.get("UserName") or "",
                    "trial": f"V{vno}" if vno not in (None, "") else "",
                    "param": t.titles[r] if t is not None else (x.get("FieldName") or ""),
                    "old": _show(t, r, x.get("OldValue")), "new": _show(t, r, x.get("NewValue"))})
    return {"available": True, "rows": out}


# ------------------------------------------------------------------ retest flag (superuser)
class Retest(BaseModel):
    tab: str
    trial_id: int
    note: str = ""


@router.post("/series/{series_id}/retest")
def flag_retest(series_id: int, body: Retest, user: Dict[str, Any] = Depends(current_user)):
    if _level(user) < SUPERUSER:
        return _err(403, "forbidden", "Only superusers can flag a retest.")
    lt = next((x for x in stb.LAB_TABS if x.key == body.tab), None)
    if lt is None:
        return _err(400, "bad_tab", "Retests can only be flagged on a lab tab.")
    if body.trial_id not in _trial_ids(series_id):
        return _err(400, "bad_trial", "This trial is not part of the series.")
    if not retest_flags.flags_table_ready():
        return _err(409, "unavailable", "Retest flags are not set up in this database.")
    retest_flags.mark_trial_for_retest(body.trial_id, series_id, lt.lab_source, body.note.strip(), user.get("id"))
    log_usage_event("feature", "retest_flag", f"web {lt.lab_source}")
    return {"ok": True}


# ------------------------------------------------------------------ fill row
class FillInfoReq(BaseModel):
    tab: str            # machine | rd
    r: int
    mode: str = "single"


def _fill_tab(series_id: int, tab: str, r: int, mode: str):
    if tab not in ("machine", "rd"):
        return None
    if mode not in mdm.VIEW_MODES:
        mode = "single"
    tabs, _e, md = _load_tabs(series_id, {tab}, mode, "Nm3h")
    t = tabs.get(tab)
    if t is None or not (0 <= r < len(t.cells)):
        return None
    fixed = len(md.titles_fixed) if tab == "machine" else 4
    return t, fixed


def _kind(t, r: int) -> str:
    return ss.fill_kind(r, has_housing_list=bool(t.options.get(0)), has_jets_list=bool(t.options.get(1)),
                        dropdown_rows=[k for k in t.options if k not in (0, 1)])


@router.post("/series/{series_id}/fill/info")
def fill_info(series_id: int, body: FillInfoReq, _user: Dict[str, Any] = Depends(current_user)):
    got = _fill_tab(series_id, body.tab, body.r, body.mode)
    if got is None:
        return _err(400, "bad_row", "This row cannot be filled.")
    t, fixed = got
    kind = _kind(t, body.r)
    if kind == ss.FILL_TEXT:
        plies = ss.fill_ply_labels(t.col_specs, kind, data_row=body.r, titles_fixed_count=fixed,
                                   first_binding=t.cells[body.r][0][1] if t.cells[body.r] else None,
                                   use_groups=body.mode == "groups")
    else:
        plies = ss.fill_ply_labels(t.col_specs, kind)
    default = ss.fill_default(v for v, _b in t.cells[body.r]) if kind != ss.FILL_TEXT else None
    return {"kind": kind, "n_trials": ss.fill_n_trials(t.col_specs, len(t.cells[body.r])),
            "plies": plies, "default": None if default is None else str(default),
            "read_only": body.r in t.read_only}


class FillReq(FillInfoReq):
    start: int
    end: int
    value: Any = None
    plies: Optional[List[str]] = None


@router.post("/series/{series_id}/fill")
def fill(series_id: int, body: FillReq, user: Dict[str, Any] = Depends(current_user)):
    """The cells a fill changes - the page puts them into its unsaved edits (desktop: yellow cells)."""
    if _level(user) < 2:
        return _err(403, "read_only", "You have read-only access.")
    got = _fill_tab(series_id, body.tab, body.r, body.mode)
    if got is None:
        return _err(400, "bad_row", "This row cannot be filled.")
    t, _fixed = got
    kind = _kind(t, body.r)
    value = body.value
    if kind != ss.FILL_TEXT and value not in (None, ""):
        try:
            value = int(value)
        except (TypeError, ValueError):
            pass
    edits = ss.fill_range_edits(t.col_specs, body.start, body.end, value, cells=t.cells[body.r],
                                rule=t.validators[body.r] if body.r < len(t.validators) else None,
                                row_title=t.titles[body.r], kind=kind, selected_plies=body.plies,
                                read_only=body.r in t.read_only)
    if kind == ss.FILL_TEXT and value not in (None, "") and ss.normalize_input(
            t.validators[body.r] if body.r < len(t.validators) else None, t.titles[body.r], value, None) is None:
        return _err(400, "invalid", "This value is not valid for the row.")
    log_usage_event("feature", "fill_range_bulk_edit", f"web {kind}")
    return {"kind": kind, "edits": [{"c": c, "value": new, "display": _show(t, body.r, new) if kind != ss.FILL_TEXT else new}
                                    for c, _b, new in edits]}


# ------------------------------------------------------------------ delete trials / series (recycle bin)
class TrialIds(BaseModel):
    trial_ids: List[int]


@router.get("/series/{series_id}/rights")
def rights(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    lvl = _level(user)
    return {"delete_trials": bool(recycle_bin.can_delete_trials_now(series_id)),
            "delete_series": bool(recycle_bin.available() and sp.can_delete_series_now(series_id)),
            "move": bool(sp.can_move_series_now(series_id)),
            "history": lvl >= SUPERUSER and change_log.table_ready(),
            "retest": lvl >= SUPERUSER and retest_flags.flags_table_ready(),
            "notes": cell_notes.available(),
            "write": lvl >= 2, "retention_days": recycle_bin.RETENTION_DAYS}


@router.post("/series/{series_id}/trials/delete/preview")
def delete_trials_preview(series_id: int, body: TrialIds, _user: Dict[str, Any] = Depends(current_user)):
    st = stb.load_trials(series_id)
    vno = {int(t): v for t, v in zip(st.trial_ids, st.trial_vnos) if t is not None}
    ids = [i for i in body.trial_ids if i in vno]
    try:
        counts = recycle_bin.preview_trials(series_id, ids)
    except recycle_bin.RecycleBinError as e:
        return _err(409, "failed", str(e))
    return {"names": trial_reference.format_number_list([vno[i] for i in ids]),
            "all": len(ids) == len(vno),
            "retention_days": recycle_bin.RETENTION_DAYS,
            "rows": [{"what": recycle_bin.table_label(t), "n": n} for t, n in counts if t.lower() != "tbltrial"]}


@router.post("/series/{series_id}/trials/delete")
def delete_trials(series_id: int, body: TrialIds, _user: Dict[str, Any] = Depends(current_user)):
    st = stb.load_trials(series_id)
    known = {int(t): lab for t, lab in zip(st.trial_ids, st.labels) if t is not None}
    ids = [i for i in body.trial_ids if i in known]
    if not ids:
        return _err(400, "no_trials", "No trial of this series selected.")
    if not recycle_bin.can_delete_trials_now(series_id):
        return _err(403, "forbidden", "You may only delete trials of a series you are allowed to move in the Backlog.")
    try:
        head = stb.series_header(series_id) or {}
        exp, sn = str(head.get("ExperimentID") or "").strip(), str(head.get("SeriesName") or "").strip()
        no = sn.split(" ", 1)[0] if sn[:2].isdigit() else ""
        series_label = f"{exp}.{no}" if exp and no else (exp or sn)      # = desktop _series_display_label()
        vno = {int(t): v for t, v in zip(st.trial_ids, st.trial_vnos) if t is not None}
        label = f"{series_label} {trial_reference.format_number_list([vno.get(i) for i in ids])}".strip()
        bin_id = recycle_bin.delete_trials(series_id, ids, label)
    except recycle_bin.RecycleBinError as e:
        return _err(409, "failed", str(e))
    log_usage_event("feature", "delete_trials", f"web {len(ids)}")
    return {"bin_id": bin_id}


@router.post("/series/{series_id}/delete")
def delete_series(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    head = stb.series_header(series_id)
    if head is None:
        return _err(404, "not_found", "This series does not exist.")
    if not recycle_bin.available() or not sp.can_delete_series_now(series_id):
        return _err(403, "forbidden", "You may only delete a series you are allowed to move in the Backlog.")
    try:
        bin_id = recycle_bin.delete_series(series_id, str(head.get("SeriesName") or ""))
    except recycle_bin.RecycleBinError as e:
        return _err(409, "failed", str(e))
    log_usage_event("feature", "delete_series", "web")
    return {"bin_id": bin_id}
