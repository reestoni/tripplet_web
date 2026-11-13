"""settings_api.py - the user's own settings (desktop ui/widgets/user_settings_dialog.py + ui/screen_change_pw.py)
on db/user_account.py and db/display_settings.py.

Same stored values as the desktop (tblUser.WelcomeMessage, AccentColour, DisplaySettings JSON), so a setting
made in one app also applies in the other: welcome line, start screen, accent colour, text size, the table
display options of Show Experiment (contrast, crosshair, reading bar, warning symbols, colour-blind colours,
table zoom). Password change with the desktop checks (codes PW_* of db/user_account).
Also: the forced change at login when the password is the user name (desktop ScreenChangePw)."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from . import auth, user_context
from .deps import can_use, current_user
from .start_page import WEB_ROUTES

from db import display_settings as ds  # noqa: E402
from db import feature_access as fa  # noqa: E402
from db import user_account as ua  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/settings")
PREF_KEYS = ("contrast", "crosshair", "readbar", "alert_marks", "cb_colours", "app_scale", "scale")


def _err(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def display_prefs(user_id: Any) -> Dict[str, Any]:
    prefs = ds.load(user_id) or dict(ds.DEFAULTS)
    return {k: prefs.get(k) for k in PREF_KEYS + ("start",)}


@router.get("")
def settings(user: Dict[str, Any] = Depends(current_user)):
    prefs = display_prefs(user.get("id"))
    from .nav import SECTIONS
    nav_route = {key: r for _s, _i, items in SECTIONS for key, _l, _ic, r, _b in items if key}
    # nav_route = label (sidebar text); web = whether the web opens it (else the web starts on Backlog etc.)
    starts = [{"key": k, "nav_route": nav_route.get(k), "web": k in WEB_ROUTES}
              for k in fa.START_SCREENS if can_use(user, k)]
    return {"welcome": ua.load_welcome_message(user.get("id")), "welcome_max": ua.WELCOME_MAX_LEN,
            "first_name": user.get("first_name") or "", "accent": user.get("accent_colour") or ua.DEFAULT_ACCENT,
            "default_accent": ua.DEFAULT_ACCENT, "prefs": prefs, "start_options": starts,
            "app_scales": list(ds.APP_SCALE_CHOICES), "scale_range": [ds.SCALE_MIN, ds.SCALE_MAX, ds.SCALE_STEP],
            "can_store": ds.has_column()}


class SettingsBody(BaseModel):
    welcome: Optional[str] = None
    accent: Optional[str] = None
    start: Optional[str] = None
    prefs: Dict[str, Any] = {}


@router.post("")
def save(body: SettingsBody, user: Dict[str, Any] = Depends(current_user)):
    uid = user.get("id")
    if body.welcome is not None:
        ua.save_welcome_message(uid, body.welcome)
    if body.accent is not None:
        if not ua.is_valid_colour(body.accent):
            return _err(400, "bad_colour", "Colour expected (#RRGGBB).")
        ua.save_accent(user.get("username"), body.accent)
        auth.forget(user.get("username"))          # profile cache: the new accent applies at once
    changes = {k: v for k, v in body.prefs.items() if k in PREF_KEYS}
    if body.start is not None:
        if body.start not in fa.START_SCREENS or not can_use(user, body.start):
            return _err(400, "bad_start", "This start screen is not available.")
        changes["start"] = body.start
    prefs = ds.update(uid, **changes) if changes else ds.load(uid)
    log_usage_event("feature", "user_settings", "web " + " ".join(f"{k}={v}" for k, v in sorted(changes.items())))
    return {"prefs": {k: (prefs or {}).get(k) for k in PREF_KEYS + ("start",)}}


class PrefsBody(BaseModel):
    prefs: Dict[str, Any]


@router.post("/prefs")
def save_prefs(body: PrefsBody, user: Dict[str, Any] = Depends(current_user)):
    """Quiet single change (e.g. the table zoom with Ctrl + mouse wheel)."""
    changes = {k: v for k, v in body.prefs.items() if k in PREF_KEYS}
    prefs = ds.update(user.get("id"), **changes) if changes else None
    return {"prefs": {k: (prefs or {}).get(k) for k in PREF_KEYS + ("start",)} if prefs else None}


class PasswordBody(BaseModel):
    old: str
    new: str
    repeat: str


@router.post("/password")
def change_password(body: PasswordBody, user: Dict[str, Any] = Depends(current_user)):
    code = ua.change_password(user.get("username") or "", body.old, body.new, body.repeat)
    if code:
        return _err(400, code, "Password not changed.")
    log_usage_event("feature", "change_password", "web")
    return {"ok": True}


# ------------------------------------------------------------------ forced change at login (password = user name)
class InitialBody(BaseModel):
    username: str
    old: str
    new: str
    repeat: str


auth_router = APIRouter(prefix="/api/auth")


@auth_router.post("/initial-password")
def initial_password(body: InitialBody, response: Response):
    """Login refused with code "insecure_password" -> the user sets a new password here (same checks as the
    desktop change screen, the old password must be right) and is logged in with it."""
    code = ua.change_password(body.username, body.old, body.new, body.repeat)
    if code:
        return _err(400, code, "Password not changed.")
    try:
        profile = auth.attempt_login(body.username, body.new)
    except auth.LoginError as e:
        return _err(401, e.code, e.message)
    token = user_context.set_user(profile)
    try:
        log_usage_event("feature", "change_password", "web initial")
        log_usage_event("login", "login", "web")
    finally:
        user_context.reset(token)
    response.set_cookie(auth.COOKIE_NAME, auth.make_cookie(profile["username"]), max_age=auth.SESSION_MAX_AGE,
                        httponly=True, samesite="lax", path="/")
    return {"user": profile}
