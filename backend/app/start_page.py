"""start_page.py - where the user lands after login: the start screen from the desktop
Settings (tblUser.DisplaySettings "start", same key as ui/display_prefs.py), default Backlog;
if that is not allowed or not in the web yet: the first allowed of LANDING_ORDER that is."""
from __future__ import annotations

import json
from typing import Any, Dict

from . import core  # noqa: F401
from .deps import can_use

from db import feature_access as fa  # noqa: E402
from db.connection import fetch_all  # noqa: E402

# feature key -> web route (only screens that exist in the web)
WEB_ROUTES = {"backlog": "/backlog", "all_experiments": "/experiments", "my_requests": "/requests",
              "yarn_stock": "/tools/yarn-stock", "manage_jets": "/admin/jets", "manage_yarn": "/admin/yarn"}


def preferred_start(user_id: Any) -> str:
    try:
        rows = fetch_all("SELECT DisplaySettings FROM tblUser WHERE ID = ?", [user_id])
        raw = rows[0].get("DisplaySettings") if rows else None
        prefs = json.loads(raw) if raw else {}
        return str(prefs.get("start") or "backlog")
    except Exception:
        return "backlog"


def start_route(user: Dict[str, Any]) -> str:
    pref = preferred_start(user.get("id"))
    if pref in WEB_ROUTES and can_use(user, pref):
        return WEB_ROUTES[pref]
    for key in ("backlog",) + tuple(k for k in fa.LANDING_ORDER if k != "backlog") + ("my_requests",):
        if key in WEB_ROUTES and can_use(user, key):
            return WEB_ROUTES[key]
    return "/requests"
