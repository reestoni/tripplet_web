"""uploads.py - upload / rename / delete images and PDFs of a trial series (Show Experiment).

All rules live in db/series_uploads.py (shared with the desktop's "Upload images" /
"Upload PDFs" buttons and attachment viewers); this module only maps them to HTTP.
Desktop rules: every logged-in user may upload (also AccessLevel 1) and rename, delete
only the uploader or a superuser. The kind (image / PDF) is taken from the file content.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user

from db import series_uploads as su  # noqa: E402

router = APIRouter(prefix="/api/series")

MAX_FILE_BYTES = 50 * 1024 * 1024     # per file
MAX_FILES = 50                        # per request


def _json(obj: Any, status: int = 200) -> Response:
    return Response(json.dumps(obj, default=str), media_type="application/json", status_code=status)


def _err(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


@router.post("/{series_id}/attachments")
async def upload(series_id: int, files: List[UploadFile] = File(...), user: Dict[str, Any] = Depends(current_user)):
    if len(files) > MAX_FILES:
        return _err(400, "too_many", f"At most {MAX_FILES} files per upload.")
    data, too_big = [], []
    for f in files:
        name = f.filename or "file"
        content = await f.read(MAX_FILE_BYTES + 1)
        if len(content) > MAX_FILE_BYTES:
            too_big.append(f"{name}: larger than {MAX_FILE_BYTES // (1024 * 1024)} MB")
        else:
            data.append((name, content))
    try:
        res = su.add_files(user, series_id, data) if data else {"images": 0, "pdfs": 0, "errors": []}
    except LookupError as e:
        return _err(404, "not_found", str(e))
    except RuntimeError as e:          # target folder could not be created
        return _err(500, "folder", str(e))
    res["errors"] = too_big + res["errors"]
    return _json(res)


class RenameBody(BaseModel):
    name: str


@router.post("/{series_id}/attachments/{kind}/{attachment_id}/rename")
def rename(series_id: int, kind: str, attachment_id: int, body: RenameBody,
           user: Dict[str, Any] = Depends(current_user)):
    try:
        new_name = su.rename(user, kind, series_id, attachment_id, body.name)
    except LookupError as e:
        return _err(404, "not_found", str(e))
    except RuntimeError as e:
        return _err(409, "not_updated", str(e))
    if new_name is None:
        return _err(400, "empty", "Please enter a name.")
    return _json({"name": new_name})


class DeleteBody(BaseModel):
    ids: List[int]


@router.post("/{series_id}/attachments/{kind}/delete")
def delete(series_id: int, kind: str, body: DeleteBody, user: Dict[str, Any] = Depends(current_user)):
    try:
        res = su.delete(user, kind, series_id, body.ids)
    except LookupError as e:
        return _err(404, "not_found", str(e))
    if res.get("skipped") and not res["deleted"]:
        return _err(403, "forbidden", "You can only delete your own uploads (or need superuser rights).")
    return _json(res)
