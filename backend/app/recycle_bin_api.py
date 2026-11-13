"""recycle_bin_api.py - Recycle Bin (/superuser/recycle-bin; desktop ui/widgets/recycle_bin_dialog.py +
ui/recycle_preview.py) on db/recycle_bin.py. Superusers only, like the desktop.

List (expired entries are purged first), restore, delete permanently, and the preview: the series is restored for
the time being and opens read only in Show Experiment with a banner (restore for good / back to the recycle bin /
delete permanently). Leaving the series page without a decision puts it back (desktop: closing the tab). The
open previews live in this process: after a server restart a series simply stays restored (desktop: crash) -
nothing is lost, it can be deleted again."""
from __future__ import annotations

import datetime
import threading
import time
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from . import core  # noqa: F401
from .deps import current_user

from db import recycle_bin as rb  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/superuser/recycle-bin")
SUPERUSER = 4

_lock = threading.Lock()
_previews: Dict[int, Dict[str, Any]] = {}      # series id -> {bin_id, info, user, started}


def _err(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _guard(user: Dict[str, Any]) -> Optional[JSONResponse]:
    if int(user.get("access_level") or 0) < SUPERUSER:
        return _err(403, "superuser_only", "Superusers only.")
    if not rb.available():
        return _err(404, "not_available", "The recycle bin is not set up in this database.")
    return None


def _when(v: Any) -> Any:
    return v.isoformat(sep=" ")[:16] if isinstance(v, datetime.datetime) else v


def preview_for(series_id: int, user: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Banner data if this user has the series open as a recycle bin preview (app/series_view.py)."""
    p = _previews.get(int(series_id))
    if not p or p["user"] != user.get("id"):
        return None
    return {"deleted_at": _when(p["info"].get("DeletedAt")), "deleted_by": p.get("deleted_by_name") or ""}


@router.get("")
def entries(user: Dict[str, Any] = Depends(current_user)):
    bad = _guard(user)
    if bad:
        return bad
    try:
        rb.purge_expired()
    except Exception:
        pass
    open_bins = {p["bin_id"] for p in _previews.values()}
    return {"retention_days": rb.RETENTION_DAYS,
            "entries": [{"id": e["ID"], "deleted_at": _when(e.get("DeletedAt")), "user": e.get("UserName") or "",
                         "type": e.get("ObjectType") or "", "object_id": e.get("ObjectID"), "label": e.get("Label") or "",
                         "summary": e.get("Summary") or ""} for e in rb.list_entries() if e["ID"] not in open_bins],
            "previews": [{"series_id": sid, "label": p["info"].get("Label") or "", "mine": p["user"] == user.get("id")}
                         for sid, p in _previews.items()]}


@router.post("/{bin_id}/restore")
def restore(bin_id: int, user: Dict[str, Any] = Depends(current_user)):
    bad = _guard(user)
    if bad:
        return bad
    try:
        label = rb.restore(bin_id)
    except rb.RecycleBinError as e:
        return _err(409, "restore_failed", str(e))
    except Exception as e:
        return _err(500, "restore_failed", str(e))
    return {"label": label}


@router.delete("/{bin_id}")
def delete(bin_id: int, user: Dict[str, Any] = Depends(current_user)):
    bad = _guard(user)
    if bad:
        return bad
    rb.delete_permanently(bin_id)
    return {"ok": True}


@router.post("/{bin_id}/preview")
def preview(bin_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Takes a deleted series out for a look -> {series_id}; the series page shows the banner."""
    bad = _guard(user)
    if bad:
        return bad
    entry = next((e for e in rb.list_entries() if e["ID"] == bin_id), None)
    if entry is None or (entry.get("ObjectType") or "") != "trial series":
        return _err(404, "not_found", "Only deleted trial series can be opened.")
    try:
        info = rb.preview_start(bin_id)
    except rb.RecycleBinError as e:
        return _err(409, "restore_failed", str(e))
    sid = int(info["ObjectID"])
    with _lock:
        _previews[sid] = {"bin_id": bin_id, "info": info, "user": user.get("id"), "started": time.time(),
                          "deleted_by_name": entry.get("UserName") or ""}
    log_usage_event("feature", "recycle_bin_preview", str(sid))
    return {"series_id": sid}


def _take(series_id: int, user: Dict[str, Any]):
    with _lock:
        p = _previews.get(series_id)
        if not p:
            return None
        del _previews[series_id]
        return p


@router.post("/preview/{series_id}/{action}")
def decide(series_id: int, action: str, user: Dict[str, Any] = Depends(current_user)):
    """keep = restore for good, back = back to the recycle bin (original date/user), delete = permanently."""
    bad = _guard(user)
    if bad:
        return bad
    if action not in ("keep", "back", "delete"):
        return _err(400, "bad_action", "Unknown action.")
    p = _take(series_id, user)
    if p is None:
        return {"ok": True, "gone": True}
    try:
        if action == "back":
            rb.preview_back(p["info"], p["bin_id"])
        elif action == "delete":
            rb.preview_delete(p["info"], p["bin_id"])
    except Exception as e:
        return _err(409, "back_failed", f"The series could not be put back into the recycle bin - it stays restored. {e}")
    log_usage_event("feature", f"recycle_bin_preview_{action}", str(series_id))
    return {"ok": True}
