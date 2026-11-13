"""admin_yarn.py - Manage Yarn / New Yarn in the browser (desktop ui/screen_manage_yarn.py, ui/screen_new_yarn.py).

Data and rules: db/yarn_admin.py (shared with the desktop). Rights like the desktop (no all-or-nothing
read-only): everyone with the feature "manage_yarn" may edit and create, MinStock only superusers,
delete only with the Admin card right. Every save runs the duplicate check (identical or one field
different) - the browser has to confirm with ``confirmed: true`` (desktop "Save anyway?" dialog).
The browser sends column names + values; columns are checked against the table, list values against
the master lists, numbers against the MySQL column type.
"""
from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db import yarn_admin as ya  # noqa: E402
from db.connection import fetch_all  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from db.yarn_colours import colour_css  # noqa: E402
from ui.text_normalize import canon_simple as _canon  # noqa: E402

router = APIRouter(prefix="/api/admin/yarn")
SCREEN_KEY = "manage_yarn"
INT_TYPES = {"TINYINT", "SMALLINT", "MEDIUMINT", "INT", "INTEGER", "BIGINT"}
NUMERIC_TYPES = {"TINYINT", "SMALLINT", "MEDIUMINT", "INT", "INTEGER", "BIGINT", "DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL"}
NOT_IN_WEB_EDIT = {"globalid"}     # the desktop table lets you overwrite GlobalID; the web does not


def _err(status: int, code: str, detail: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, **extra})


def _superuser(user: Dict[str, Any]) -> bool:
    return int(user.get("access_level") or 0) >= 4


def _numeric_columns() -> set:
    try:
        rows = fetch_all("SELECT COLUMN_NAME AS c, DATA_TYPE AS d FROM information_schema.COLUMNS "
                         "WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER('" + ya.TABLE + "')", [])
        # literal on purpose: db.connection maps legacy table names in the SQL text
    except Exception:
        return set()
    return {r["c"] for r in rows if str(r.get("d") or "").upper() in NUMERIC_TYPES}


def _int_columns() -> set:
    """Whole-number columns (MySQL would round 99.5 silently - refused instead)."""
    try:
        rows = fetch_all("SELECT COLUMN_NAME AS c, DATA_TYPE AS d FROM information_schema.COLUMNS "
                         "WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER('" + ya.TABLE + "')", [])
    except Exception:
        return set()
    return {r["c"] for r in rows if str(r.get("d") or "").upper() in INT_TYPES}


def _plain(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, datetime.datetime):
        return v.isoformat(sep=" ")[:19]
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray)):
        return None
    return v


def _editable(headers: List[str], user: Dict[str, Any]) -> List[str]:
    return [c for c in ya.editable_columns(headers, ya.can_edit_minstock(user)) if _canon(c) not in NOT_IN_WEB_EDIT]


def _fk(headers: List[str]) -> Dict[str, List]:
    return {c: [[i, n] for i, n in items] for c, items in ya.fk_lists(headers).items()}


@router.get("")
def yarns(user: Dict[str, Any] = Depends(require_feature("manage_yarn"))):
    rows = ya.load_yarns()
    headers = list(rows[0].keys()) if rows else ya.all_columns()
    columns = ya.visible_columns(headers, _superuser(user))
    sp = ya.special_columns(columns)
    fk = _fk(columns)
    colour_col = sp["colour"]
    colour_names = {str(i): n for i, n in fk.get(colour_col, [])} if colour_col else {}
    created_by = {}
    if sp["createdby"]:
        try:
            from db.user_directory import load_user_id_to_name
            created_by = load_user_id_to_name()
        except Exception:
            pass
    out_rows = []
    for r in rows:
        row = {c: _plain(r.get(c)) for c in columns}
        if sp["dpf"]:
            d = ya.compute_dpf(r.get(sp["endtiter"]) if sp["endtiter"] else None,
                               r.get(sp["filaments"]) if sp["filaments"] else None)
            row[sp["dpf"]] = None if d is None else round(d, 3)
        if sp["createdby"]:
            row["CreatedByName"] = created_by.get(r.get(sp["createdby"]))
        out_rows.append(row)
    from db.user_column_order import load_column_order
    form_cols = [c for c in ya.all_columns() if _canon(c) not in ya.HIDDEN_IN_FORM and c.lower() != ya.ID_COL.lower()
                 and _canon(c) not in ya.AUDIT]
    return {
        "columns": columns,
        "labels": {c: ya.DISPLAY_LABELS[_canon(c)] for c in columns if _canon(c) in ya.DISPLAY_LABELS},
        "special": sp,
        "editable": _editable(columns, user),
        "form_columns": form_cols,
        "numeric_columns": sorted(_numeric_columns() & set(columns) | ({sp["dpf"], sp["stockkg"]} - {None})),
        "fk": fk,
        "colour_css": {i: colour_css(n) for i, n in colour_names.items()},
        "rows": out_rows,
        "can_delete": ya.can_delete(user),
        "can_edit_minstock": ya.can_edit_minstock(user),
        "column_order": load_column_order(SCREEN_KEY) or [],
    }


def _convert(col: str, value: Any, numeric: set, fk: Dict[str, List], ints: set = frozenset()) -> Any:
    items = fk.get(col)
    if items is not None:
        if value in (None, ""):
            return None
        hit = next((i for i, _n in items if str(i) == str(value)), None)
        if hit is None:
            raise ValueError(f"{col}: unknown choice")
        return hit
    if isinstance(value, str):
        value = value.strip()
    if value in (None, ""):
        return None
    if col in numeric:
        s = str(value).replace(",", ".")
        try:
            f = float(s)
        except ValueError:
            raise ValueError(f"{col}: number expected")
        if col in ints:
            if not f.is_integer():
                raise ValueError(f"{col}: whole number expected")
            return int(f)
        return int(f) if f.is_integer() and "." not in s else f
    return value


def _clean(data: Dict[str, Any], allowed: List[str], headers: List[str]) -> Dict[str, Any]:
    numeric = _numeric_columns()
    ints = _int_columns()
    fk = _fk(headers)
    out = {}
    for col, v in data.items():
        if col not in allowed:
            raise ValueError(f"{col}: column cannot be changed")
        out[col] = _convert(col, v, numeric, fk, ints)
    return out


def _duplicate(fields: Dict[str, Any], exclude_id: Optional[int]) -> Optional[JSONResponse]:
    match = ya.find_duplicate_yarn(fields, exclude_id)
    if not match:
        return None
    info = ya.duplicate_info(match)
    code = "duplicate_identical" if info["identical"] else "duplicate_similar"
    return _err(409, code, info["text"], vars={"name": info["name"], "id": info["id"], "diff": info["diff_label"],
                                               "same": info["same_labels"]})


def _headers() -> List[str]:
    return ya.all_columns()


def _current(yarn_id: int) -> Optional[Dict[str, Any]]:
    rows = fetch_all("SELECT * FROM tblYarn WHERE ID = ?", [yarn_id])
    return rows[0] if rows else None


class Change(BaseModel):
    id: int
    values: Dict[str, Any]


class SaveBody(BaseModel):
    rows: List[Change]
    confirmed: bool = False


@router.post("/save")
def save(body: SaveBody, user: Dict[str, Any] = Depends(require_feature("manage_yarn"))):
    """Changed table cells; the duplicate check runs for every changed row before anything is written."""
    headers = _headers()
    try:
        rows = [(ch.id, _clean(ch.values, _editable(headers, user), headers)) for ch in body.rows if ch.values]
    except ValueError as e:
        return _err(400, "bad_value", str(e))
    if not body.confirmed:
        for yid, vals in rows:
            cur = _current(yid)
            if cur is None:
                continue
            dup = _duplicate({**cur, **vals}, yid)
            if dup:
                return dup
    n = ya.save_changes([{ya.ID_COL: yid, **vals} for yid, vals in rows], ya.can_edit_minstock(user))
    log_usage_event("feature", "web_manage_yarn_save", str(len(rows)))
    return {"saved": n}


class FormBody(BaseModel):
    values: Dict[str, Any]
    confirmed: bool = False


def _form_allowed(user: Dict[str, Any]) -> List[str]:
    return [c for c in _editable(_headers(), user) if _canon(c) not in ya.HIDDEN_IN_FORM]


@router.post("/new")
def new(body: FormBody, user: Dict[str, Any] = Depends(require_feature("manage_yarn"))):
    """New yarn from the form (desktop _go_new_yarn_form): all form fields written, empty = NULL."""
    allowed = _form_allowed(user)
    try:
        data = _clean({**{c: None for c in allowed}, **body.values}, allowed, _headers())
    except ValueError as e:
        return _err(400, "bad_value", str(e))
    if not body.confirmed:
        dup = _duplicate(data, None)
        if dup:
            return dup
    new_id = ya.insert_yarn(data, user.get("id"), ya.can_edit_minstock(user))
    log_usage_event("feature", "web_new_yarn", str(new_id))
    return {"id": new_id}


@router.post("/{yarn_id}/update")
def update(yarn_id: int, body: FormBody, user: Dict[str, Any] = Depends(require_feature("manage_yarn"))):
    """"Edit in Form" of one yarn (only the changed fields are sent)."""
    cur = _current(yarn_id)
    if cur is None:
        return _err(404, "not_found", "Yarn not found.")
    try:
        data = _clean(body.values, _form_allowed(user), _headers())
    except ValueError as e:
        return _err(400, "bad_value", str(e))
    if not body.confirmed:
        dup = _duplicate({**cur, **data}, yarn_id)
        if dup:
            return dup
    ya.update_yarn(yarn_id, data, ya.can_edit_minstock(user))
    return {"ok": True}


class DeleteBody(BaseModel):
    ids: List[int]


@router.post("/delete")
def delete(body: DeleteBody, user: Dict[str, Any] = Depends(require_feature("manage_yarn"))):
    if not ya.can_delete(user):
        return _err(403, "no_delete", "Read-only access – you don't have permission to delete records.")
    try:
        n = ya.delete_yarns(body.ids)
    except Exception as e:     # still used in a ply row / spool (FK)
        return _err(409, "delete_failed", f"Could not delete: {e}")
    log_usage_event("feature", "web_manage_yarn_delete", str(n))
    return {"deleted": n}


class ColourBody(BaseModel):
    name: str
    force: bool = False


@router.post("/colour")
def add_colour(body: ColourBody, _user: Dict[str, Any] = Depends(require_feature("manage_yarn"))):
    """"+ Add new colour…": same name -> the existing colour; similar name -> 409 colour_similar
    (browser asks: use it / create anyway via force); else new tblColour row."""
    name = body.name.strip()
    if not name:
        return _err(400, "name_missing", "Please enter a name.")
    hit = ya.colour_exact(name)
    if hit is None and not body.force:
        sim = ya.colour_similar(name)
        if sim:
            return _err(409, "colour_similar", f'"{name}" looks similar to the existing colour "{sim[1]}".',
                        vars={"name": name, "match": sim[1]}, match={"id": sim[0], "name": sim[1]})
    if hit is None:
        new_id = ya.insert_colour(name)
        hit = (new_id, name)
    col = ya.special_columns(_headers())["colour"]
    items = _fk(_headers()).get(col, []) if col else []
    return {"id": hit[0], "name": hit[1], "items": items, "css": colour_css(hit[1])}


@router.get("/{yarn_id}/usage")
def usage(yarn_id: int, _user: Dict[str, Any] = Depends(require_feature("manage_yarn"))):
    return {"series": ya.yarn_usage(yarn_id)}


class OrderBody(BaseModel):
    columns: List[str]


@router.post("/column-order")
def column_order(body: OrderBody, _user: Dict[str, Any] = Depends(require_feature("manage_yarn"))):
    from db.user_column_order import save_column_order
    save_column_order(SCREEN_KEY, [c for c in body.columns if isinstance(c, str)][:200])
    return {"ok": True}
