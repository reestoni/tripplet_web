"""canvas_api.py - Canvas boards in the database (/api/canvas/boards...) on db/canvas_boards.py (shared with the
desktop Canvas, same tblCanvasBoard rows and board format).

The page sends the board document; items may still point at things only this browser session knows - an upload
of this user ({"kind": "upload", "token"}) or a clipboard picture ({"kind": "clip", "data": data-URL}). Before
storing, the server copies those into the board's folder ({"kind": "file"}), so every user and the desktop can
open the board. Series images / PDFs stay references (tblTrialSeriesImage / tblTrialSeriesPDF IDs) and are read
through series_attachments.file_for_download like everywhere else."""
from __future__ import annotations

import base64
import binascii
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from . import core  # noqa: F401
from .deps import can_use, current_user
from .image_compare_api import _local_path, _render

from db import canvas_boards as cb  # noqa: E402
from ui import doc_render as dr  # noqa: E402

router = APIRouter(prefix="/api/canvas")
CLIP_RE = re.compile(r"^data:image/(png|jpeg|gif|webp);base64,(.+)$", re.S)


def _feature(user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    if not can_use(user, "canvas"):
        raise HTTPException(status_code=403, detail="You are not allowed to use this.")
    return user


def _err(code: str, detail: str, status: int = 400, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, **extra})


def _ready() -> Optional[JSONResponse]:
    return None if cb.table_ready() else _err("no_table", "Boards are not available on this database yet.", 503)


def _row(r: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": int(r["ID"]), "title": r["Title"], "series_id": r.get("TrialSeriesID"),
            "series": str(r.get("SeriesName") or ""), "experiment": str(r.get("ExperimentID") or ""),
            "version": int(r["Version"]), "created_by": r.get("CreatedBy"), "created_by_name": r.get("CreatedByName") or "",
            "updated_by_name": r.get("UpdatedByName") or "",
            "updated": r["UpdatedAt"].isoformat(sep=" ", timespec="minutes") if r.get("UpdatedAt") else ""}


def _store_sources(board_id: int, content: Dict[str, Any], user: Dict[str, Any]) -> Dict[str, Any]:
    """Uploads / clipboard pictures of this browser -> files of the board."""
    items: List[Dict[str, Any]] = []
    for it in content.get("items") or []:
        if not isinstance(it, dict):
            continue
        src = it.get("src") or {}
        kind = src.get("kind") if isinstance(src, dict) else None
        if kind == "upload":
            p = _local_path(user, str(src.get("token") or ""))
            if p is None:
                raise cb.BoardError("upload_gone", f"The file {src.get('name') or ''} is no longer available - add it again.")
            it = {**it, "src": {"kind": "file", "file": cb.add_file(board_id, p.name.split("_", 1)[-1], p.read_bytes())}}
        elif kind == "clip":
            m = CLIP_RE.match(str(src.get("data") or ""))
            if not m:
                continue
            try:
                data = base64.b64decode(m.group(2), validate=True)
            except (binascii.Error, ValueError):
                continue
            ext = "jpg" if m.group(1) == "jpeg" else m.group(1)
            it = {**it, "src": {"kind": "file", "file": cb.add_file(board_id, f"clipboard.{ext}", data)}}
        items.append(it)
    return {**content, "items": items}


@router.get("/boards")
def boards(series: Optional[int] = None, user: Dict[str, Any] = Depends(_feature)):
    if not cb.table_ready():
        return {"ready": False, "boards": [], "can_edit": False}
    return {"ready": True, "can_edit": cb.can_edit(user), "boards": [_row(r) for r in cb.list_boards(series)]}


@router.get("/boards/{board_id}")
def board(board_id: int, user: Dict[str, Any] = Depends(_feature)):
    if (e := _ready()) is not None:
        return e
    b = cb.get_board(board_id)
    if b is None:
        return _err("not_found", "The board does not exist (any more).", 404)
    return {**_row(b), "content": b["content"], "can_edit": cb.can_edit(user), "can_delete": cb.can_delete(b, user)}


@router.post("/boards")
def create(body: Dict[str, Any], user: Dict[str, Any] = Depends(_feature)):
    if (e := _ready()) is not None:
        return e
    try:
        bid = cb.create_board(str(body.get("title") or ""), body.get("series_id") or None)
        content = _store_sources(bid, body.get("content") or cb.empty_content(), user)
        version = cb.save_board(bid, content, 1)
    except cb.BoardError as ex:
        return _err(ex.code, str(ex), 403 if ex.code == "no_right" else 400)
    return {"id": bid, "version": version}


@router.put("/boards/{board_id}")
def save(board_id: int, body: Dict[str, Any], user: Dict[str, Any] = Depends(_feature)):
    if (e := _ready()) is not None:
        return e
    try:
        content = _store_sources(board_id, body.get("content") or {}, user)
        kw: Dict[str, Any] = {}
        if "series_id" in body:
            kw["series_id"] = body.get("series_id") or None
        version = cb.save_board(board_id, content, int(body.get("version") or 0),
                                title=body.get("title") if body.get("title") is not None else None, **kw)
    except cb.BoardConflict as ex:
        return _err("conflict", str(ex), 409, version=ex.current_version, by=ex.updated_by)
    except cb.BoardError as ex:
        return _err(ex.code, str(ex), 403 if ex.code == "no_right" else 404 if ex.code == "not_found" else 400)
    b = cb.get_board(board_id)
    return {"version": version, "content": b["content"] if b else None}


@router.delete("/boards/{board_id}")
def delete(board_id: int, user: Dict[str, Any] = Depends(_feature)):
    if (e := _ready()) is not None:
        return e
    try:
        cb.delete_board(board_id)
    except cb.BoardError as ex:
        return _err(ex.code, str(ex), 403)
    return {"ok": True}


@router.get("/boards/{board_id}/files/{name}/info")
def file_info(board_id: int, name: str, user: Dict[str, Any] = Depends(_feature)):
    p = cb.file_path(board_id, name)
    if not p:
        return _err("not_found", "File not found.", 404)
    return dr.info(p)


@router.get("/boards/{board_id}/files/{name}")
def file(board_id: int, name: str, page: int = 0, sheet: int = 0, channel: str = "",
         max: int = Query(0, ge=0, le=6000), user: Dict[str, Any] = Depends(_feature)):
    p = cb.file_path(board_id, name)
    if not p:
        return _err("not_found", "File not found.", 404)
    return _render(p, os.path.basename(p).split("_", 1)[-1], page, sheet, channel, max)
