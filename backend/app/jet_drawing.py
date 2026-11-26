"""jet_drawing.py - the drawing of a jet as a hover box (Nutzerwunsch 2026-11-26, web only).

Report legend (static/web_bridge.js) and the Jet row of Machine Data show the pictures stored with the jet in Manage Jets
(tblJetFile + JetFiles share, db/jets_admin.py): images as they are (BMP/TIFF converted to PNG), a PDF as its first page.
Newest first; the box pages through them. Everyone who can open the page sees them (user's decision 2026-11-26).
The browser sends only a jet id/name or a tblJetFile id - never a path.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse, JSONResponse, Response

from . import core  # noqa: F401  (sys.path, mode lock)
from .deps import current_user

from db import jets_admin as ja  # noqa: E402
from db.connection import fetch_all  # noqa: E402

router = APIRouter(prefix="/api")

_AS_IS = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}
_CONVERT = {".bmp", ".tif", ".tiff"}
SHOWN = set(_AS_IS) | _CONVERT | {".pdf"}
MAX_SIDE = 1600


def _jet_ids(jet: Optional[int], name: Optional[str]) -> List[Dict[str, Any]]:
    if jet:
        return fetch_all("SELECT ID, Jet FROM tbljets WHERE ID = ?", [jet])
    name = (name or "").strip()
    if not name or len(name) > 120:
        return []
    return fetch_all("SELECT ID, Jet FROM tbljets WHERE Jet = ? ORDER BY ID", [name])


def drawings(jet: Optional[int] = None, name: Optional[str] = None) -> Dict[str, Any]:
    """{jet_id, name, files: [{id, name, type}]} - pictures and PDFs of the jet, newest first."""
    rows = _jet_ids(jet, name)
    if not rows:
        return {"jet_id": None, "name": name or "", "files": []}
    root = ja.files_root()
    files = []
    for r in rows:
        for f in ja.list_files(r["ID"]):
            fname = str(f.get("FileName") or f.get("StoredName") or "")
            ext = os.path.splitext(fname)[1].lower()
            rel = f.get("RelativePath")
            if ext not in SHOWN or not rel or not os.path.isfile(os.path.join(root, rel)):
                continue
            files.append({"id": int(f["ID"]), "name": fname, "type": "pdf" if ext == ".pdf" else "image"})
    return {"jet_id": int(rows[0]["ID"]), "name": str(rows[0].get("Jet") or name or ""), "files": files}


@router.get("/jet-drawings")
def list_drawings(jet: Optional[int] = Query(None), name: Optional[str] = Query(None),
                  _user: Dict[str, Any] = Depends(current_user)):
    return drawings(jet, name)


def _not_found() -> JSONResponse:
    return JSONResponse(status_code=404, content={"code": "not_found", "detail": "No drawing."})


@router.get("/jet-drawings/file/{file_id}")
def drawing_file(file_id: int, _user: Dict[str, Any] = Depends(current_user)):
    path = ja.file_path(file_id)
    if not path or not os.path.isfile(path):
        return _not_found()
    ext = os.path.splitext(path)[1].lower()
    head = {"Cache-Control": "private, max-age=3600"}
    if ext in _AS_IS:
        return FileResponse(path, media_type=_AS_IS[ext], headers=head)
    try:
        from ui import doc_render
        if ext == ".pdf":
            img, err = doc_render.pdf_image(path, 0)
            if img is None:
                return _not_found()
        elif ext in _CONVERT:
            from PIL import Image
            img = Image.open(path)
        else:
            return _not_found()
        return Response(doc_render.to_png(img, MAX_SIDE), media_type="image/png", headers=head)
    except Exception:  # noqa: BLE001 - unreadable file: no box picture
        return _not_found()
