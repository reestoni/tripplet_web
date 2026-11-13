"""admin_master.py - the small Admin master tables in the browser: Order Type, Product Groups, Material, Top Plates
(desktop ui/screen_manage_order_types.py, ui/screen_manage_product_groups.py, ui/screen_manage_material.py,
ui/screen_manage_top_plates.py + ui/screen_new_top_plate.py) on db/master_tables.py (shared with the desktop).

Viewing = the table's feature key; writing = Admin card right (master_tables.can_edit, like the desktop's
_require_admin_box_write). The browser sends column names + values: columns are checked against the table's real
columns, numbers against the MySQL type (whole-number columns refuse 1.5 instead of rounding it silently)."""
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
from .deps import can_use, current_user

from db import master_tables as mt  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/admin/master")
INT_TYPES = {"tinyint", "smallint", "mediumint", "int", "integer", "bigint"}
NUMERIC_TYPES = INT_TYPES | {"decimal", "numeric", "float", "double", "real"}


def _err(status: int, code: str, detail: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, **extra})


def _kind(kind: str, user: Dict[str, Any]):
    """(Kind, None) or (None, error response): unknown table or feature not allowed."""
    k = mt.KINDS.get(kind)
    if k is None:
        return None, _err(404, "not_found", "Unknown table.")
    if not can_use(user, k.feature):
        return None, _err(403, "forbidden", "You are not allowed to use this.")
    return k, None


def _guard_write(user: Dict[str, Any]) -> Optional[JSONResponse]:
    if not mt.can_edit(user):
        return _err(403, "read_only", "Read-only access: you don't have permission to modify this table.")
    return None


def _plain(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()[:19]
    if isinstance(v, (bytes, bytearray)):
        return None
    return v


def _types(k) -> Dict[str, str]:
    return dict(mt.real_columns(k))


def _clean(k, values: Dict[str, Any], types: Dict[str, str]) -> Dict[str, Any]:
    editable = set(mt.editable_columns(k, list(types)))
    out = {}
    for col, v in values.items():
        if col not in editable:
            raise ValueError(f"{col}: column cannot be changed")
        if isinstance(v, str):
            v = v.strip()
        if v in (None, ""):
            # the name column keeps '' (desktop New writes ''), all others NULL
            out[col] = "" if mt._canon(col) in k.name_cols and v == "" else None
            continue
        t = types.get(col, "")
        if t in NUMERIC_TYPES:
            try:
                f = float(str(v).replace(",", "."))
            except ValueError:
                raise ValueError(f"{col}: number expected")
            if t in INT_TYPES:
                if not f.is_integer():
                    raise ValueError(f"{col}: whole number expected")
                v = int(f)
            else:
                v = f
        out[col] = v
    return out


@router.get("/{kind}")
def table(kind: str, user: Dict[str, Any] = Depends(current_user)):
    k, bad = _kind(kind, user)
    if bad:
        return bad
    types = _types(k)
    rows = mt.load_rows(k)
    columns = [c for c in (list(rows[0].keys()) if rows else list(types)) if mt._canon(c) not in
               {mt._canon(x) for x in k.hidden} and c not in ("has_files", "__has_files__")]
    from db.user_column_order import load_column_order
    log_usage_event("feature", f"web_manage_{k.key}_open", "web")
    return {
        "columns": columns,
        "editable": mt.editable_columns(k, columns),
        "numeric_columns": [c for c in columns if types.get(c) in NUMERIC_TYPES],
        "int_columns": [c for c in columns if types.get(c) in INT_TYPES],
        "bool_columns": ["UsedInYarn"] if k.key == "material" else [],
        "name_column": next((c for c in columns if mt._canon(c) in k.name_cols), None),
        "rows": [{**{c: _plain(r.get(c)) for c in columns}, "has_files": bool(r.get("has_files"))} for r in rows],
        "can_edit": mt.can_edit(user),
        "column_order": load_column_order(k.screen_key) or [],
    }


class Change(BaseModel):
    id: int
    values: Dict[str, Any]


class SaveBody(BaseModel):
    rows: List[Change]


@router.post("/{kind}/save")
def save(kind: str, body: SaveBody, user: Dict[str, Any] = Depends(current_user)):
    k, bad = _kind(kind, user)
    if bad or (bad := _guard_write(user)):
        return bad
    types = _types(k)
    try:
        rows = [{mt.ID_COL: ch.id, **_clean(k, ch.values, types)} for ch in body.rows if ch.values]
    except ValueError as e:
        return _err(400, "bad_value", str(e))
    if k.key == "top_plates":
        for r in rows:
            if "Name" in r and (not r["Name"] or not mt.name_available(k, str(r["Name"]), r[mt.ID_COL])):
                return _err(400, "name_taken" if r["Name"] else "name_missing", "Name not available.",
                            vars={"name": r["Name"] or ""})
    try:
        n = mt.save_changes(k, rows)
    except Exception as e:
        return _err(400, "save_failed", f"Save failed: {e}")
    log_usage_event("feature", f"web_manage_{k.key}_save", str(len(rows)))
    return {"saved": n}


class NewBody(BaseModel):
    values: Dict[str, Any] = {}


@router.post("/{kind}/new")
def new(kind: str, body: NewBody, user: Dict[str, Any] = Depends(current_user)):
    """New row (desktop "New"); Top Plates: form / copy with a required, unique Name."""
    k, bad = _kind(kind, user)
    if bad or (bad := _guard_write(user)):
        return bad
    data = None
    if k.key == "top_plates":
        try:
            data = _clean(k, body.values, _types(k))
        except ValueError as e:
            return _err(400, "bad_value", str(e))
        name = str(data.get("Name") or "").strip()
        if not name:
            return _err(400, "name_missing", "Please enter a name.")
        if not mt.name_available(k, name):
            return _err(400, "name_taken", f"A top plate named '{name}' exists already.", vars={"name": name})
    try:
        new_id = mt.create(k, data)
    except Exception as e:
        return _err(400, "create_failed", f"Create failed: {e}")
    return {"id": new_id}


class DeleteBody(BaseModel):
    ids: List[int]


@router.post("/{kind}/delete")
def delete(kind: str, body: DeleteBody, user: Dict[str, Any] = Depends(current_user)):
    k, bad = _kind(kind, user)
    if bad or (bad := _guard_write(user)):
        return bad
    try:
        n = mt.delete(k, body.ids)
    except Exception as e:          # a FK still points to the row
        return _err(409, "delete_failed", f"Could not delete: {e}")
    log_usage_event("feature", f"web_manage_{k.key}_delete", str(n))
    return {"deleted": n}


class OrderBody(BaseModel):
    columns: List[str]


@router.post("/{kind}/column-order")
def column_order(kind: str, body: OrderBody, user: Dict[str, Any] = Depends(current_user)):
    k, bad = _kind(kind, user)
    if bad:
        return bad
    from db.user_column_order import save_column_order
    save_column_order(k.screen_key, [c for c in body.columns if isinstance(c, str)][:200])
    return {"ok": True}


@router.get("/material/{material_id}/usage")
def material_usage(material_id: int, user: Dict[str, Any] = Depends(current_user)):
    k, bad = _kind("material", user)
    if bad:
        return bad
    return {"yarns": [{"id": y["id"], "label": y["label"]} for y in mt.material_usage(material_id)]}


# ------------------------------------------------------------------ top plate files
@router.get("/top_plates/{plate_id}/files")
def files(plate_id: int, user: Dict[str, Any] = Depends(current_user)):
    k, bad = _kind("top_plates", user)
    if bad:
        return bad
    root = mt.files_root()
    return {"files": [{"id": f["ID"], "name": f.get("FileName") or f.get("StoredName") or "", "type": f.get("FileType"),
                       "kb": f.get("FileSizeKB"), "notes": f.get("Notes") or "",
                       "exists": bool(f.get("RelativePath")) and os.path.isfile(os.path.join(root, f["RelativePath"]))}
                      for f in mt.list_files(plate_id)]}


@router.post("/top_plates/{plate_id}/files")
async def upload(plate_id: int, files: List[UploadFile] = File(...), user: Dict[str, Any] = Depends(current_user)):
    k, bad = _kind("top_plates", user)
    if bad or (bad := _guard_write(user)):
        return bad
    errors = []
    for f in files:
        try:
            mt.add_file(plate_id, f.filename or "file", await f.read(), user.get("id"))
        except Exception as e:
            errors.append(f"{f.filename}: {e}")
    return {"errors": errors}


@router.get("/top_plates/files/{file_id}")
def file(file_id: int, user: Dict[str, Any] = Depends(current_user)):
    k, bad = _kind("top_plates", user)
    if bad:
        return bad
    path = mt.file_path(file_id)
    if not path or not os.path.isfile(path):
        return _err(404, "file_missing", "File not found.")
    return FileResponse(path, media_type=mimetypes.guess_type(path)[0] or "application/octet-stream",
                        filename=os.path.basename(path).split("_", 2)[-1], content_disposition_type="inline")


@router.delete("/top_plates/files/{file_id}")
def remove_file(file_id: int, user: Dict[str, Any] = Depends(current_user)):
    k, bad = _kind("top_plates", user)
    if bad or (bad := _guard_write(user)):
        return bad
    mt.remove_file(file_id)
    return {"ok": True}
