"""admin_jets.py - Manage Jets / New Jet in the browser (desktop ui/screen_manage_jets.py, ui/screen_new_jet.py).

Data and rules: db/jets_admin.py (shared with the desktop). Viewing = feature key "manage_jets";
writing = Admin card right (jets_admin.can_edit: AccessLevel >= 3 or tblUser.AdminBox), like the desktop's
_require_admin_box_write. "Created by / creation date" only for superusers (desktop _AUDIT_COLS). The
browser sends column names + values; columns are checked against the table (never free SQL names),
FK values against the master lists, numbers against the column type.
"""
from __future__ import annotations

import datetime
import mimetypes
import os
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db import jets_admin as ja  # noqa: E402
from db.connection import fetch_all  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from ui.text_normalize import canon_with_id_strip as _canon  # noqa: E402

router = APIRouter(prefix="/api/admin/jets")
SCREEN_KEY = "manage_jets"
SUPERUSER = 4
NUMERIC_TYPES = {"TINYINT", "SMALLINT", "MEDIUMINT", "INT", "INTEGER", "BIGINT", "DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL"}


def _err(status: int, code: str, detail: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, **extra})


def _superuser(user: Dict[str, Any]) -> bool:
    return int(user.get("access_level") or 0) >= SUPERUSER


def _numeric_columns() -> set:
    """Number columns of tblDTYJets from the MySQL schema (typos are refused instead of written)."""
    try:
        rows = fetch_all("SELECT COLUMN_NAME AS c, DATA_TYPE AS d FROM information_schema.COLUMNS "
                         "WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER('" + ja.TABLE + "')", [])
        # literal on purpose: db.connection maps legacy table names (tblDTYJets -> tbljets) in the SQL text
    except Exception:
        return set()
    return {r["c"] for r in rows if str(r.get("d") or "").upper() in NUMERIC_TYPES}


def _plain(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat(sep=" ")[:19] if isinstance(v, datetime.datetime) else v.isoformat()
    if isinstance(v, (bytes, bytearray)):
        return None
    return v


def _fk_by_column(maps: Dict[str, Dict], columns: List[str]) -> Dict[str, List]:
    """{column name: [[id, label]]} for the FK columns among ``columns``."""
    out = {}
    for c in columns:
        m = maps.get(_canon(c))
        if m and m.get("items") is not None and _canon(c) != "createdby":
            out[c] = [[i, n] for i, n in m["items"]]
    return out


@router.get("")
def jets(user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    rows = ja.load_jets()
    columns = list(rows[0].keys()) if rows else [ja.ID_COL]
    if not _superuser(user):
        columns = [c for c in columns if _canon(c) not in ja.AUDIT_COLS]
    columns = [c for c in columns if c != "has_files"]
    maps = ja.fk_maps()
    from db.user_column_order import load_column_order
    created_by = maps.get("createdby", {}).get("id_to_name", {})
    return {
        "columns": columns,
        "editable": ja.editable_columns(columns),
        "form_columns": [c for c in columns if c.lower() not in ja.HIDDEN_IN_FORM and c.lower() != ja.ID_COL.lower()
                         and _canon(c) not in ja.AUDIT_COLS],
        "bool_columns": [c for c in columns if ja.is_bool_column(c)],
        "numeric_columns": sorted(_numeric_columns() & set(columns)),
        "fk": _fk_by_column(maps, columns),
        "rows": [{**{c: _plain(r.get(c)) for c in columns},
                  "has_files": bool(r.get("has_files")),
                  **({"CreatedByName": created_by.get(r.get("CreatedBy"))} if _superuser(user) else {})}
                 for r in rows],
        "can_edit": ja.can_edit(user),
        "column_order": load_column_order(SCREEN_KEY) or [],
    }


def _convert(col: str, value: Any, numeric: set, maps: Dict[str, Dict]) -> Any:
    """Browser value -> DB value with the desktop's rules (FK id from the list, bool 0/1, empty -> NULL);
    numbers are checked so a typo is refused instead of being written as text."""
    if ja.is_bool_column(col):
        return 1 if value in (True, 1, "1", "true", "True", -1) else 0
    m = maps.get(_canon(col))
    if m and _canon(col) != "createdby":
        if value in (None, ""):
            return None
        ids = {str(i) for i, _n in m["items"]}
        if str(value) not in ids:
            raise ValueError(f"{col}: unknown choice")
        return next(i for i, _n in m["items"] if str(i) == str(value))
    if isinstance(value, str):
        value = value.strip()
    if value in (None, ""):
        return None
    if col in numeric:
        try:
            f = float(str(value).replace(",", "."))
        except ValueError:
            raise ValueError(f"{col}: number expected")
        return int(f) if f.is_integer() and "." not in str(value) and "," not in str(value) else f
    return value


def _clean(data: Dict[str, Any], allowed: List[str]) -> Dict[str, Any]:
    numeric = _numeric_columns()
    maps = ja.fk_maps()
    out = {}
    for col, v in data.items():
        if col not in allowed:
            raise ValueError(f"{col}: column cannot be changed")
        out[col] = _convert(col, v, numeric, maps)
    return out


def _guard_write(user: Dict[str, Any]) -> Optional[JSONResponse]:
    if not ja.can_edit(user):
        return _err(403, "read_only", "Read-only access: you don't have permission to modify this table.")
    return None


class Change(BaseModel):
    id: int
    values: Dict[str, Any]


class SaveBody(BaseModel):
    rows: List[Change]


def _columns() -> List[str]:
    rows = ja.load_jets()
    return list(rows[0].keys()) if rows else [ja.ID_COL]


@router.post("/save")
def save(body: SaveBody, user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    """Changed cells of the table (desktop: dirty rows -> Save)."""
    bad = _guard_write(user)
    if bad:
        return bad
    editable = ja.editable_columns(_columns())
    try:
        rows = [{ja.ID_COL: ch.id, **_clean(ch.values, editable)} for ch in body.rows if ch.values]
    except ValueError as e:
        return _err(400, "bad_value", str(e))
    for r in rows:
        name = r.get("Jet")
        if "Jet" in r and (not name or not ja.jet_name_available(str(name), r[ja.ID_COL])):
            return _err(400, "name_taken" if name else "name_missing", f"Jet name '{name}' is not available.",
                        vars={"name": name or ""})
    n = ja.save_changes(rows)
    log_usage_event("feature", "web_manage_jets_save", str(len(rows)))
    return {"saved": n}


class FormBody(BaseModel):
    values: Dict[str, Any]


@router.post("/new")
def new(body: FormBody, user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    """New Jet form / copy: "Jet" required and unique."""
    bad = _guard_write(user)
    if bad:
        return bad
    cols = _columns()
    allowed = [c for c in ja.editable_columns(cols) if c.lower() not in ja.HIDDEN_IN_FORM]
    try:
        # like the desktop form (_collect_values): every form field is written, empty ones as NULL
        # (bool 0) - otherwise column defaults apply (JetTypeID = 0 breaks its FK)
        data = _clean({**{c: None for c in allowed}, **body.values}, allowed)
    except ValueError as e:
        return _err(400, "bad_value", str(e))
    name = str(data.get("Jet") or "").strip()
    if not name:
        return _err(400, "name_missing", "Please enter a name in the 'Jet' field.")
    if not ja.jet_name_available(name):
        return _err(400, "name_taken", f"A jet named '{name}' exists already.", vars={"name": name})
    new_id = ja.insert_jet(data, user.get("id"))
    log_usage_event("feature", "web_new_jet", str(new_id))
    return {"id": new_id}


@router.post("/{jet_id}/update")
def update(jet_id: int, body: FormBody, user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    """"Edit in Form": all form fields of one jet (name unique among the other jets)."""
    bad = _guard_write(user)
    if bad:
        return bad
    allowed = [c for c in ja.editable_columns(_columns()) if c.lower() not in ja.HIDDEN_IN_FORM]
    try:
        data = _clean(body.values, allowed)
    except ValueError as e:
        return _err(400, "bad_value", str(e))
    name = str(data.get("Jet") or "").strip()
    if "Jet" in data and not name:
        return _err(400, "name_missing", "Please enter a name in the 'Jet' field.")
    if name and not ja.jet_name_available(name, jet_id):
        return _err(400, "name_taken", f"A jet named '{name}' exists already.", vars={"name": name})
    ja.save_changes([{ja.ID_COL: jet_id, **data}])
    return {"ok": True}


class DeleteBody(BaseModel):
    ids: List[int]


@router.post("/delete")
def delete(body: DeleteBody, user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    bad = _guard_write(user)
    if bad:
        return bad
    try:
        n = ja.delete_jets(body.ids)
    except Exception as e:     # e.g. a FK of tbltrial still points to the jet
        return _err(409, "delete_failed", f"Could not delete: {e}")
    log_usage_event("feature", "web_manage_jets_delete", str(n))
    return {"deleted": n}


@router.get("/name-check")
def name_check(name: str, except_id: Optional[int] = None, _user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    return {"available": ja.jet_name_available(name.strip(), except_id)}


class QuickAdd(BaseModel):
    column: str
    name: str


@router.post("/fk")
def quick_add(body: QuickAdd, user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    """"+" next to a FK dropdown: new master value, returns its id and the new list."""
    bad = _guard_write(user)
    if bad:
        return bad
    if not body.name.strip():
        return _err(400, "name_missing", "Please enter a name.")
    if not any(fk_col == body.column or _canon(fk_col) == _canon(body.column) for _k, fk_col, *_r in ja.FK_DEF):
        return _err(400, "bad_column", "Not a list column.")
    new_id = ja.quick_add_fk_value(body.column, body.name)
    maps = ja.fk_maps()
    return {"id": new_id, "items": _fk_by_column(maps, [body.column]).get(body.column, [])}


@router.get("/{jet_id}/usage")
def usage(jet_id: int, _user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    return {"series": ja.jet_usage(jet_id)}


class OrderBody(BaseModel):
    columns: List[str]


@router.post("/column-order")
def column_order(body: OrderBody, _user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    from db.user_column_order import save_column_order
    save_column_order(SCREEN_KEY, [c for c in body.columns if isinstance(c, str)][:200])
    return {"ok": True}


# ------------------------------------------------------------------ files
@router.get("/{jet_id}/files")
def files(jet_id: int, _user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    root = ja.files_root()
    return {"files": [{"id": f["ID"], "name": f.get("FileName") or f.get("StoredName") or "", "type": f.get("FileType"),
                       "kb": f.get("FileSizeKB"), "notes": f.get("Notes") or "",
                       "exists": bool(f.get("RelativePath")) and os.path.isfile(os.path.join(root, f["RelativePath"]))}
                      for f in ja.list_files(jet_id)]}


@router.post("/{jet_id}/files")
async def upload(jet_id: int, files: List[UploadFile] = File(...),
                 user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    bad = _guard_write(user)
    if bad:
        return bad
    errors = []
    for f in files:
        try:
            ja.add_file(jet_id, f.filename or "file", await f.read(), user.get("id"))
        except Exception as e:
            errors.append(f"{f.filename}: {e}")
    return {"errors": errors}


@router.get("/files/{file_id}")
def file(file_id: int, _user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    path = ja.file_path(file_id)
    if not path or not os.path.isfile(path):
        return _err(404, "file_missing", "File not found.")
    return FileResponse(path, media_type=mimetypes.guess_type(path)[0] or "application/octet-stream",
                        filename=os.path.basename(path).split("_", 2)[-1], content_disposition_type="inline")


@router.delete("/files/{file_id}")
def remove_file(file_id: int, user: Dict[str, Any] = Depends(require_feature("manage_jets"))):
    bad = _guard_write(user)
    if bad:
        return bad
    ja.remove_file(file_id)
    return {"ok": True}
