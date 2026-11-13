"""series_tools.py - Show Experiment tools in the browser: copy trials, Yarns… dialog, reference samples.

All writes go through the shared modules the desktop uses:
- copy trials        db/trial_actions.copy_trials_setup / copy_trials (+ db/trial_copy value rules)
- Yarns… dialog      db/series_yarns.load_state / plan / describe / apply_plan (same checks as the dialog)
- reference samples  db/trial_actions.add_reference_sample / set_reference_flag / rename_reference_sample
Write access = access level >= 2 like the desktop (recycle-bin previews do not exist in the web).
"""
from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user

from db import series_tables as stb  # noqa: E402
from db import series_yarns as sy  # noqa: E402
from db import trial_actions as ta  # noqa: E402
from db import trial_copy as tc  # noqa: E402
from db.connection import fetch_all  # noqa: E402
from db.trial_reference import format_trial_number  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/series")


def _err(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _can_write(user: Dict[str, Any]) -> bool:
    return ta.can_edit_trials(user)


# ------------------------------------------------------------------ copy trials
def _val_json(f: tc.CopyField, v: Any) -> Dict[str, Any]:
    if v is tc.NOT_AVAILABLE:
        return {"na": True}
    if v is tc.VARIES:
        return {"varies": True, "text": tc.display_value(f, v)}
    return {"v": None if v is None else (v if isinstance(v, (int, float, str)) else str(v)),
            "text": tc.display_value(f, v)}


@router.get("/{series_id}/copy-setup")
def copy_setup(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """What the desktop copy dialog shows: trials (with summary), fields, source values, next number."""
    s = ta.copy_trials_setup(series_id)
    fields: List[tc.CopyField] = s["fields"]
    summary = [f for f in fields if f.default]
    trials = []
    for t in s["trials"]:
        src = s["source"].get(int(t["id"]), {})
        parts = [tc.summary_value(f, src.get(f.key)) for f in summary]
        trials.append({"id": int(t["id"]), "label": format_trial_number(t["vno"]),
                       "summary": "  ·  ".join(p for p in parts if p)})
    return {
        "trials": trials, "next_no": s["next_no"],
        "fields": [{"key": f.key, "label": f.label, "rule": f.rule, "default": f.default,
                    "choices": [[k, n] for k, n in (f.choices or [])] or None} for f in fields],
        "source": {str(tid): {k: _val_json(next(f for f in fields if f.key == k), v) for k, v in vals.items()}
                   for tid, vals in s["source"].items()},
    }


class CopyItem(BaseModel):
    source: int
    values: Dict[str, Any] = {}


class CopyBody(BaseModel):
    plan: List[CopyItem]


@router.post("/{series_id}/copy")
def copy_trials_ep(series_id: int, body: CopyBody, user: Dict[str, Any] = Depends(current_user)):
    if not _can_write(user):
        return _err(403, "read_only", "You have read-only access.")
    if not body.plan or len(body.plan) > 500:
        return _err(400, "empty", "Nothing to copy.")
    s = ta.copy_trials_setup(series_id)
    fields: List[tc.CopyField] = s["fields"]
    by_key = {f.key: f for f in fields}
    known = {int(t["id"]) for t in s["trials"]}
    plan = []
    for item in body.plan:
        if item.source not in known:
            return _err(400, "bad_trial", "A source trial is not part of this series.")
        over: Dict[str, Any] = {}
        for k, v in item.values.items():
            f = by_key.get(k)
            if f is None:
                return _err(400, "bad_field", "Unknown field.")
            if tc.NOT_AVAILABLE is s["source"].get(item.source, {}).get(k):
                continue
            if f.choices:
                ids = {str(c[0]) for c in f.choices}
                if v not in (None, "") and str(v) not in ids:
                    return _err(400, "invalid", f"'{v}' is not a valid value for {f.label}.")
                val = None if v in (None, "") else next(c[0] for c in f.choices if str(c[0]) == str(v))
            else:
                norm = tc.normalize_value(f.rule, v)
                if norm is None:
                    return _err(400, "invalid", f"'{v}' is not a valid value for {f.label}.")
                val = norm if norm != "" else None
            over[k] = val
        plan.append((item.source, over))
    new_ids, err = ta.copy_trials(series_id, plan, fields, user)
    n_changed = sum(1 for _s, o in plan if o)
    log_usage_event("feature", "copy_trials", f"web {len(new_ids)} copies, {n_changed} with changed values")
    if err is not None:
        return _err(500, "partly", f"{len(new_ids)} of {len(plan)} copies were made, then an error occurred: {err}")
    return {"new_ids": new_ids}


# ------------------------------------------------------------------ Yarns… dialog
def _uses() -> List[List[Any]]:
    try:
        return [[int(r["ID"]), str(r.get("Name") or "")] for r in fetch_all("SELECT ID, Name FROM tblYarnUse ORDER BY ID")]
    except Exception:
        return []


@router.get("/{series_id}/yarns")
def yarns_state(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    st = sy.load_state(series_id)
    return {
        "editable": sy.can_edit(user),
        "trials": [{"id": tid, "label": label, "ref": tid in st.refs} for tid, _v, label in st.trials],
        "rows": [{"ply": r.ply, "yarn_id": r.yarn_id, "yarn": r.yarn_name, "use_id": r.use_id,
                  "ends": {str(k): v for k, v in r.ends.items()}} for r in st.rows],
        "mixed": sorted(sy.mixed_plies(st.rows)),
        "uses": _uses(), "max_ends": sy.MAX_ENDS,
    }


@router.get("/yarns/catalog")
def yarn_catalog(_user: Dict[str, Any] = Depends(current_user)):
    return {"yarns": [{"id": y["id"], "name": y["name"], "colour": y["colour"], "search": y["search"]} for y in sy.load_yarns()]}


class YRow(BaseModel):
    ply: str
    yarn_id: Optional[int] = None
    use_id: Optional[int] = None
    ends: Dict[str, int] = {}


class YarnsBody(BaseModel):
    rows: List[YRow]
    apply: bool = False


@router.post("/{series_id}/yarns")
def yarns_apply(series_id: int, body: YarnsBody, user: Dict[str, Any] = Depends(current_user)):
    """Check (apply=False: list of changes) or write the Yarns… dialog. Rows: the loaded rows in their
    order (changed), then new rows - like the desktop, plan() matches by position."""
    if not sy.can_edit(user):
        return _err(403, "read_only", "Read only - you need write access to change yarns.")
    before = sy.load_state(series_id)
    if len(body.rows) < len(before.rows):
        return _err(409, "stale", "The yarns of this series changed meanwhile - please open the dialog again.")
    tids = {tid for tid, _v, _l in before.trials}
    names = {y["id"]: y["name"] for y in sy.load_yarns()}
    uses = {u[0] for u in _uses()}
    after = copy.deepcopy(before)
    rows: List[sy.PlyRow] = []
    for i, r in enumerate(body.rows):
        old = before.rows[i] if i < len(before.rows) else None
        if old is not None and r.ply != old.ply:
            return _err(400, "bad_row", "Existing rows keep their ply number.")
        if r.yarn_id is None or (r.yarn_id not in names and (old is None or r.yarn_id != old.yarn_id)):
            return _err(400, "bad_yarn", "Unknown yarn.")
        if r.use_id is not None and r.use_id not in uses:
            return _err(400, "bad_use", "Unknown yarn use.")
        ends = {}
        for k, n in r.ends.items():
            if int(k) not in tids or not 0 <= int(n) <= sy.MAX_ENDS:
                return _err(400, "bad_ends", "Invalid number of ends.")
            if int(n):
                ends[int(k)] = int(n)
        name = names.get(r.yarn_id) or (old.yarn_name if old else "")
        rows.append(sy.PlyRow(r.ply, r.yarn_id, name, r.use_id, ends,
                              orig_yarn_id=old.orig_yarn_id if old else None, orig_use_id=old.orig_use_id if old else None))
    # series rule (desktop dialog): a yarn always keeps its ply number - a new row goes to the ply of its
    # yarn or the next free one; a changed yarn may not be another ply already
    for i, pr in enumerate(rows):
        if i >= len(before.rows):
            expected = sy.ply_of_yarn(rows[:i], pr.yarn_id) or sy.next_ply_label(rows[:i])
            if pr.ply != expected:
                return _err(400, "bad_ply", f"{pr.yarn_name} must go to {expected}.")
        elif pr.yarn_id != before.rows[i].yarn_id:
            other = sy.ply_of_yarn([o for o in rows if o.ply != pr.ply], pr.yarn_id)
            if other:
                return _err(400, "yarn_twice", f"{pr.yarn_name} is already {other} in this series - "
                                               "a yarn always keeps its ply number.")
    after.rows = rows
    missing = sy.trials_without_ply(after)
    if missing:
        return _err(400, "no_ply", "Every trial needs at least one ply. Without a ply: " + ", ".join(missing))
    dup = sy.duplicate_rows(after)
    if dup:
        return _err(400, "duplicate", f"{dup[0].ply} ({dup[0].yarn_name}) appears twice with the same yarn use.")
    ops = sy.plan(before, after)
    lines = sy.describe(ops, {u[0]: u[1] for u in _uses()})
    if not body.apply or not ops:
        return {"changes": lines, "applied": False}
    sy.apply_plan(ops, series_id, user)
    log_usage_event("feature", "series_yarns", f"web {len(ops)}")
    return {"changes": lines, "applied": True}


# ------------------------------------------------------------------ reference samples
class RefName(BaseModel):
    name: str = ""


def _refs_ok(user: Dict[str, Any]) -> Optional[JSONResponse]:
    if not ta.reference_samples_available():
        return _err(409, "unavailable", "Reference samples are not available in this database yet.")
    if not _can_write(user):
        return _err(403, "read_only", "You have read-only access.")
    return None


def _trial(series_id: int, trial_id: int):
    st = stb.load_trials(series_id)
    for t, v in zip(st.trial_ids, st.trial_vnos):
        if t is not None and int(t) == trial_id:
            return v, int(t) in st.reference_names
    return None


@router.post("/{series_id}/references")
def add_reference(series_id: int, body: RefName, user: Dict[str, Any] = Depends(current_user)):
    bad = _refs_ok(user)
    if bad:
        return bad
    tid = ta.add_reference_sample(series_id, body.name.strip() or None, user)
    log_usage_event("feature", "reference_sample", "add")
    return {"trial_id": tid}


class RefFlag(BaseModel):
    make_reference: bool
    name: str = ""


@router.post("/{series_id}/references/{trial_id}/flag")
def flag_reference(series_id: int, trial_id: int, body: RefFlag, user: Dict[str, Any] = Depends(current_user)):
    bad = _refs_ok(user)
    if bad:
        return bad
    t = _trial(series_id, trial_id)
    if t is None:
        return _err(404, "not_found", "This trial is not part of the series.")
    vno, is_ref = t
    if is_ref == body.make_reference:
        return {"ok": True, "new_number": None}
    new_vno = ta.set_reference_flag(trial_id, series_id, vno, body.make_reference, body.name.strip() or None)
    log_usage_event("feature", "reference_sample", "mark" if body.make_reference else "unmark")
    return {"ok": True, "new_number": new_vno}


@router.post("/{series_id}/references/{trial_id}/rename")
def rename_reference(series_id: int, trial_id: int, body: RefName, user: Dict[str, Any] = Depends(current_user)):
    bad = _refs_ok(user)
    if bad:
        return bad
    t = _trial(series_id, trial_id)
    if t is None or not t[1]:
        return _err(404, "not_found", "This is not a reference sample of the series.")
    ta.rename_reference_sample(trial_id, body.name.strip() or None)
    return {"ok": True}


# ------------------------------------------------------------------ Statimat / Itemat PDF import
from db import lab_pdf_import as lpi  # noqa: E402
from db import series_attachments as sat  # noqa: E402


class PdfImport(BaseModel):
    kind: str                 # "statimat" | "itemat"
    ids: List[int]            # attachment ids of PDFs attached to this series


@router.post("/{series_id}/pdf-import")
def pdf_import(series_id: int, body: PdfImport, user: Dict[str, Any] = Depends(current_user)):
    """Desktop "Statimat import" / "Itemat import": only PDFs attached to this series (allow-list by
    attachment id, the browser never sends paths). Open to every user like the desktop and like uploads
    (db/lab_pdf_import.can_import, Nutzerentscheid 2026-11-13)."""
    if not lpi.can_import(user):
        return _err(403, "forbidden", "You may not import PDFs.")
    if body.kind not in ("statimat", "itemat") or not body.ids:
        return _err(400, "bad_request", "Choose Statimat or Itemat and at least one PDF.")
    paths = []
    for aid in body.ids:
        p = sat.file_for_download("pdf", series_id, aid)
        if not p:
            return _err(404, "not_found", "A chosen PDF is not attached to this series.")
        paths.append(p)
    if body.kind == "statimat":
        res = lpi.import_statimat(series_id, paths, user)
        msg = lpi.import_message("Import finished.", "Imported spools", res["imported"], res["skipped"], res["errors"])
    else:
        cols = lpi.itemat_columns()
        if cols is None:
            return _err(409, "columns", "Could not resolve the required columns of the Itemat table.")
        try:
            res = lpi.import_itemat(series_id, paths, user, cols=cols)
        except Exception as e:      # DB errors propagate in the shared code (as on the desktop)
            return _err(500, "failed", f"The Itemat import failed: {e}")
        msg = lpi.import_message("Itemat import finished.", "Imported trials", res["imported"], res["skipped"], res["errors"])
    return {"imported": res["imported"], "skipped": res["skipped"], "errors": res["errors"], "message": msg}


# ------------------------------------------------------------------ vs Ref / Target (Compare with reference)
from ui import ref_compare as rc  # noqa: E402  (Qt-free)
from db import ref_criteria  # noqa: E402


def _sources(st) -> List[Dict[str, Any]]:
    """Numeric rows of every lab tab (one column per trial) - like ref_compare_dialog.gather_sources():
    model attribute = "model_" + tab key, so saved criteria sets work in desktop and web alike."""
    out = []
    for lt in stb.LAB_TABS:
        try:
            p = lt.build(st)
        except Exception:
            p = None
        if p is None:
            continue
        rows = [(title, ["" if v is None else str(v) for v, _b in p.cells[r]]) for r, title in enumerate(p.row_titles)]
        out.append({"attr": f"model_{lt.key}", "tab": lt.title, "rows": rows})
    return out


def _sets() -> List[Dict[str, Any]]:
    if not ref_criteria.available():
        return []
    return [{"id": int(s["ID"]), "name": str(s["Name"]), "criteria": s["criteria"], "can_delete": ref_criteria.can_delete(s)}
            for s in ref_criteria.list_sets()]


_SRC_CACHE: Dict[int, Any] = {}
_SRC_TTL = 120.0          # seconds - criteria changes re-judge without rebuilding every lab tab


def _compare_data(series_id: int, fresh: bool = False):
    import time
    hit = _SRC_CACHE.get(series_id)
    if hit and not fresh and time.time() - hit[0] < _SRC_TTL:
        return hit[1]
    st = stb.load_trials(series_id)
    data = {"trial_ids": [int(t) for t in st.trial_ids if t is not None],
            "labels": {int(t): lab for t, lab in zip(st.trial_ids, st.labels) if t is not None},
            "refs": dict(st.reference_names), "sources": _sources(st)}
    _SRC_CACHE[series_id] = (time.time(), data)
    if len(_SRC_CACHE) > 20:
        _SRC_CACHE.pop(next(iter(_SRC_CACHE)))
    return data


@router.get("/{series_id}/ref-compare/setup")
def ref_compare_setup(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    st = stb.load_trials(series_id)
    return {"trials": [{"id": int(t), "label": lab, "ref": int(t) in st.reference_names}
                       for t, lab in zip(st.trial_ids, st.labels) if t is not None],
            "refs": [{"id": int(t), "name": n or ""} for t, n in st.reference_names.items()],
            "sets": _sets(), "db": ref_criteria.available(),
            "directions": list(rc.DIRECTIONS), "default_tol": rc.DEFAULT_TOL}


class Compare(BaseModel):
    ref_id: Optional[int] = None          # None = own targets
    criteria: Dict[str, Dict[str, Any]] = {}
    fresh: bool = False                   # first call of a dialog: read the lab values again


@router.post("/{series_id}/ref-compare")
def ref_compare(series_id: int, body: Compare, _user: Dict[str, Any] = Depends(current_user)):
    """Metrics + every trial judged against the reference / own targets (ui/ref_compare.py, shared)."""
    d = _compare_data(series_id, fresh=body.fresh)
    trial_ids, labels = d["trial_ids"], d["labels"]
    if body.ref_id is not None and body.ref_id not in d["refs"]:
        return _err(400, "bad_ref", "This is not a reference sample of the series.")
    metrics = rc.collect_metrics(d["sources"], trial_ids, body.ref_id)
    rows = rc.evaluate(metrics, trial_ids, body.criteria, skip_ids=list(d["refs"]))
    return {
        "metrics": [{"key": m["key"], "tab": m["tab"], "title": m["title"], "ref": m["ref"],
                     "counted": rc.counted(m, body.criteria.get(m["key"]))} for m in metrics],
        "rows": [{"trial_id": r["trial_id"], "label": labels.get(r["trial_id"], ""), "passed": r["passed"],
                  "total": r["total"], "all_pass": r["all_pass"], "failing": rc.failing(r, metrics),
                  "cells": {k: dict(v, value=next(m["values"].get(r["trial_id"]) for m in metrics if m["key"] == k))
                            for k, v in r["cells"].items()}} for r in rows],
    }


class CritSet(BaseModel):
    name: str
    criteria: Dict[str, Dict[str, Any]]
    set_id: Optional[int] = None


@router.post("/ref-criteria")
def save_criteria(body: CritSet, _user: Dict[str, Any] = Depends(current_user)):
    """Criteria sets are for everybody (desktop: save / save as); deleting = creator or superuser."""
    if not ref_criteria.available():
        return _err(409, "unavailable", "Saving criteria is not set up in this database yet.")
    try:
        sid = ref_criteria.save(body.name, body.criteria, body.set_id)
    except ValueError as e:
        return _err(400, "invalid", str(e))
    return {"id": sid, "sets": _sets()}


@router.delete("/ref-criteria/{set_id}")
def delete_criteria(set_id: int, _user: Dict[str, Any] = Depends(current_user)):
    s = next((x for x in (ref_criteria.list_sets() if ref_criteria.available() else []) if int(x["ID"]) == set_id), None)
    if s is None:
        return {"sets": _sets()}
    if not ref_criteria.can_delete(s):
        return _err(403, "forbidden", "Only the creator or a superuser can delete this criteria set.")
    ref_criteria.delete(set_id)
    return {"sets": _sets()}
