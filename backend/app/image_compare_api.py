"""image_compare_api.py - Image Compare (/tools/image-compare; desktop ui/screen_image_compare.py) on
db/image_compare.py (series, images, ATY radar) and ui/doc_render.py (VK4 / PDF / Excel / Word as images).

Series images are read through db/series_attachments.file_for_download (only files inside the attachment
folders). Local files of the desktop = files uploaded from this computer: kept in a temporary folder per
user for one day, never written anywhere else. The web does NOT write rotated images back to the share
(the desktop does on double-click) - rotation is a view setting here (later server: read-only access)."""
from __future__ import annotations

import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from . import core  # noqa: F401
from .deps import require_feature

from db import image_compare as dbic  # noqa: E402
from db import series_attachments as sa  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from ui import doc_render as dr  # noqa: E402

router = APIRouter(prefix="/api/image-compare")
_feature = require_feature("image_compare")
UPLOAD_ROOT = Path(tempfile.gettempdir()) / "tripplet_web" / "image_compare"
MAX_UPLOAD = 100 * 1024 * 1024
KEEP_SECONDS = 24 * 3600
BROWSER_IMAGES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")


def _err(code: str, detail: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _user_dir(user: Dict[str, Any]) -> Path:
    name = re.sub(r"[^A-Za-z0-9_-]", "_", str(user.get("username") or "user"))
    d = UPLOAD_ROOT / name
    d.mkdir(parents=True, exist_ok=True)
    now = time.time()
    for f in d.iterdir():                       # one day is enough
        try:
            if now - f.stat().st_mtime > KEEP_SECONDS:
                f.unlink()
        except OSError:
            pass
    return d


def _local_path(user: Dict[str, Any], token: str) -> Optional[Path]:
    if not re.fullmatch(r"[0-9a-f]{32}", token or ""):
        return None
    for f in _user_dir(user).glob(token + "_*"):
        return f
    return None


def _series_path(series_id: int, image_id: int) -> Optional[str]:
    return sa.file_for_download("image", series_id, image_id)


def _render(path: str, name: str, page: int, sheet: int, channel: str, max_side: int):
    """The file as the browser shows it: browser images as they are, everything else as PNG."""
    if path.lower().endswith(BROWSER_IMAGES) and not max_side:
        return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})
    img, err = dr.render(path, channel, page, sheet, page, title=name)
    if img is None:
        return _err("unreadable", err or "The file could not be read.", 422)
    return Response(dr.to_png(img, max_side), media_type="image/png", headers={"Cache-Control": "private, max-age=600"})


@router.get("/series")
def series(user: Dict[str, Any] = Depends(_feature)):
    log_usage_event("feature", "image_compare_open", "web")
    return {"series": [{"id": int(r["TrialSeriesID"]), "name": str(r.get("SeriesName") or ""),
                        "experiment": str(r.get("ExperimentID") or "")} for r in dbic.fetch_series_groups()],
            "vk4_labels": dr.VK4_CH_LABELS}


@router.get("/series/{series_id}/images")
def images(series_id: int, user: Dict[str, Any] = Depends(_feature)):
    return {"images": [{"id": int(r["ID"]), "series_id": series_id,
                        "name": str(r.get("OriginalFilename") or r.get("StoredFilename") or "")}
                       for r in dbic.fetch_images_for_series(series_id)]}


@router.get("/series/{series_id}/images/{image_id}/info")
def image_info(series_id: int, image_id: int, user: Dict[str, Any] = Depends(_feature)):
    path = _series_path(series_id, image_id)
    if not path:
        return _err("not_found", "File not found.", 404)
    row = next((r for r in dbic.fetch_images_for_series(series_id) if int(r["ID"]) == image_id), {})
    radar = dbic.fetch_aty_radar_for_image({**row, "TrialSeriesID": series_id})
    return {**dr.info(path), "radar": radar}


@router.get("/series/{series_id}/images/{image_id}/file")
def image_file(series_id: int, image_id: int, page: int = 0, sheet: int = 0, channel: str = "",
               max: int = Query(0, ge=0, le=6000), user: Dict[str, Any] = Depends(_feature)):
    path = _series_path(series_id, image_id)
    if not path:
        return _err("not_found", "File not found.", 404)
    return _render(path, os.path.basename(path), page, sheet, channel, max)


@router.post("/upload")
async def upload(file: UploadFile = File(...), user: Dict[str, Any] = Depends(_feature)):
    name = os.path.basename(file.filename or "file")
    if not dr.supported(name):
        return _err("unsupported", "This file type cannot be shown.")
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        return _err("too_big", "The file is too big (max. 100 MB).")
    token = uuid.uuid4().hex
    safe = re.sub(r"[^A-Za-z0-9._ -]", "_", name)[:120]
    path = _user_dir(user) / f"{token}_{safe}"
    path.write_bytes(data)
    log_usage_event("feature", "image_compare_local", "web")
    return {"token": token, "name": name, **dr.info(str(path))}


@router.get("/local/{token}/file")
def local_file(token: str, page: int = 0, sheet: int = 0, channel: str = "", max: int = Query(0, ge=0, le=6000),
               user: Dict[str, Any] = Depends(_feature)):
    p = _local_path(user, token)
    if p is None:
        return _err("not_found", "This file is no longer available - add it again.", 404)
    return _render(str(p), p.name.split("_", 1)[-1], page, sheet, channel, max)
