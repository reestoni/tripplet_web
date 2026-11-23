"""tdms_inspector.py - TDMS Inspector (/tools/tdms-inspector; desktop ui/screen_tdms_inspector.py).

Any .tdms file from this computer, analysed with DTY and/or ATY YarnScope - no experiment, nothing read from
or written to the database. The web uploads the file into a temporary folder per user (kept one day) and
gives it a NEGATIVE series number; app/yarnscope.py and app/yarnscope_aty.py answer such numbers from here
(one pseudo trial, id 0) with exactly the same analysis and views. Save / Batch / Compare are refused for them,
like in the desktop inspector."""
from __future__ import annotations

import itertools
import os
import re
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import JSONResponse

from . import core  # noqa: F401
from . import user_context
from .deps import require_feature

from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/tdms-inspector")
_feature = require_feature("tdms_inspector")
UPLOAD_ROOT = Path(tempfile.gettempdir()) / "tripplet_web" / "tdms_inspector"
MAX_UPLOAD = 1024 * 1024 * 1024       # TDMS files can be big
KEEP_SECONDS = 24 * 3600
_files: Dict[int, Dict[str, Any]] = {}        # negative series number -> {user, path, name, time}
_counter = itertools.count(1)
_lock = threading.Lock()


def is_inspector(series_id: int) -> bool:
    return int(series_id) < 0


def file_for(series_id: int) -> Optional[Path]:
    """The uploaded file of a negative series number - only for the user who uploaded it."""
    f = _files.get(int(series_id))
    user = user_context.get_user() or {}
    if f is None or f["user"] != str(user.get("username") or "") or not f["path"].exists():
        return None
    return f["path"]


def label(series_id: int) -> str:
    f = _files.get(int(series_id))
    return f["name"] if f else "TDMS"


def refused() -> JSONResponse:
    return JSONResponse(status_code=400, content={"code": "inspector", "detail": "Not available for a single file."})


def _cleanup() -> None:
    now = time.time()
    with _lock:
        for k, f in list(_files.items()):
            if now - f["time"] > KEEP_SECONDS:
                if f.get("own", True):            # only uploads are ours to delete, never a measured file
                    try:
                        f["path"].unlink()
                    except OSError:
                        pass
                _files.pop(k, None)


def register(path: Path, name: str, username: str) -> int:
    """Opens a file that is already on the server (a measurement of "📏 Messen" in the inspector) like an upload:
    negative number for the YarnScope views, only for this user - the file itself is never deleted."""
    _cleanup()
    n = next(_counter)
    with _lock:
        _files[-n] = {"user": str(username or ""), "path": Path(path), "name": name, "time": time.time(), "own": False}
    return -n


@router.post("/upload")
async def upload(file: UploadFile = File(...), user: Dict[str, Any] = Depends(_feature)):
    name = os.path.basename(file.filename or "file.tdms")
    if not name.lower().endswith(".tdms"):
        return JSONResponse(status_code=400, content={"code": "not_tdms", "detail": "Please choose a .tdms file."})
    _cleanup()
    folder = UPLOAD_ROOT / re.sub(r"[^A-Za-z0-9_-]", "_", str(user.get("username") or "user"))
    folder.mkdir(parents=True, exist_ok=True)
    n = next(_counter)
    path = folder / f"{n}_{re.sub(r'[^A-Za-z0-9._ -]', '_', name)[:120]}"
    size = 0
    with open(path, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD:
                out.close()
                path.unlink(missing_ok=True)
                return JSONResponse(status_code=400, content={"code": "too_big", "detail": "The file is too big (max. 1 GB)."})
            out.write(chunk)
    with _lock:
        _files[-n] = {"user": str(user.get("username") or ""), "path": path, "name": name, "time": time.time()}
    log_usage_event("feature", "tdms_inspector_open", "web")
    return {"series_id": -n, "name": name, "size": size}
