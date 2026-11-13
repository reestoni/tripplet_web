"""notifications_api.py - the bell (desktop ui/widgets/notification_panel.py + main.py refresh_bell) on
ui/notifications.py (Qt-free: get_unread_count, get_notifications, mark_as_read, mark_all_as_read).

Every user sees only their own notifications (RecipientUserID = the logged-in user); "mark as read" checks that the
notification belongs to the user (the desktop module marks by ID only)."""
from __future__ import annotations

import datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends

from . import core  # noqa: F401
from .deps import current_user

from db.connection import fetch_all  # noqa: E402
from ui import notifications as nt  # noqa: E402

router = APIRouter(prefix="/api/notifications")
SERIES_TYPES_WITHOUT_SERIES = ("yarn_stock", "experiment_request", "experiment_request_changed")


def _when(v: Any) -> Any:
    return v.isoformat(sep=" ")[:16] if isinstance(v, datetime.datetime) else v


@router.get("/count")
def count(user: Dict[str, Any] = Depends(current_user)):
    return {"unread": nt.get_unread_count(int(user["id"]))}


@router.get("")
def items(user: Dict[str, Any] = Depends(current_user)):
    rows = nt.get_notifications(int(user["id"]), limit=50)
    out = []
    for n in rows:
        typ = str(n.get("NotificationType") or "series")
        out.append({"id": n["ID"], "type": typ, "unread": n.get("ReadAt") is None, "created": _when(n.get("CreatedAt")),
                    "title": str(n.get("Message") or "") if typ in SERIES_TYPES_WITHOUT_SERIES
                    else str(n.get("SeriesName") or f"Series {n.get('TrialSeriesID')}"),
                    "experiment": str(n.get("ExperimentIDTxt") or ""), "series_id": n.get("TrialSeriesID"),
                    "yarn_id": n.get("PayloadYarnID"), "charge": n.get("PayloadCharge") or "",
                    "request_id": n.get("PayloadExperimentRequestID"),
                    "archived_version_id": n.get("PayloadArchivedVersionID")})
    return {"items": out, "unread": sum(1 for x in out if x["unread"])}


@router.post("/{notification_id}/read")
def read(notification_id: int, user: Dict[str, Any] = Depends(current_user)):
    mine = fetch_all("SELECT ID FROM tblNotification WHERE ID = ? AND RecipientUserID = ?", [notification_id, int(user["id"])])
    if mine:
        nt.mark_as_read(notification_id)
    return {"unread": nt.get_unread_count(int(user["id"]))}


@router.post("/read-all")
def read_all(user: Dict[str, Any] = Depends(current_user)):
    nt.mark_all_as_read(int(user["id"]))
    return {"unread": 0}
