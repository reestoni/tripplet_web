"""user_admin_api.py - Manage User for superusers (desktop ui/screen_manage_user.py + ui/widgets/feature_access_dialog.py)
on db/user_admin.py and db/feature_access.py.

Superusers only (AccessLevel >= 4), like the desktop sidebar entry. Password columns are never read into the
page; new / reset passwords go straight into the Argon2 hash. Deliberately not in the web: the AI API key
(Athena / "Ask AI" stay desktop-only) and the token columns; DisplaySettings belongs to the user's own settings.
Stricter than the desktop: user names must be unique and fit the column, the own account cannot be deleted.
"""
from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user

from db import feature_access as fa  # noqa: E402
from db import user_admin as ua  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/superuser/users")
SUPERUSER = 4
HIDDEN = {"api_key_enc", "token_limit", "tokens_used", "tokens_reset", "displaysettings"}
WELCOME_MAX = 45


def _err(status: int, code: str, detail: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, **extra})


def _guard(user: Dict[str, Any]) -> Optional[JSONResponse]:
    if int(user.get("access_level") or 0) < SUPERUSER:
        return _err(403, "superuser_only", "Only superusers can manage users.")
    return None


def _plain(v: Any) -> Any:
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()
    return v


def _visible(headers: List[str]) -> List[str]:
    return [h for h in headers if h.lower() not in HIDDEN]


def _editable(headers: List[str], roles: Dict[str, Optional[str]]) -> List[str]:
    return [h for h in headers if h != roles["id"]]


@router.get("")
def users(user: Dict[str, Any] = Depends(current_user)):
    bad = _guard(user)
    if bad:
        return bad
    rows = ua.load_users()
    headers = _visible(list(rows[0].keys()) if rows else ["ID"])
    roles = ua.column_roles(headers)
    bools = [h for h in headers if h.lower() in ("active", "adminbox")]
    colours = [h for h in headers if h.lower() in ("colour", "color", "accentcolour")]
    rights = ua.access_rights()
    return {
        "columns": headers, "roles": roles, "editable": _editable(headers, roles), "bool_columns": bools,
        "colour_columns": colours,
        "fk": {roles["access"]: [[i, n] for i, n, _l in rights]} if roles["access"] else {},
        "rows": [{h: _plain(r.get(h)) for h in headers} for r in rows],
        "me": user.get("id"), "username_max": ua.username_max_len(),
        "suggested_username": ua.next_username(rows), "access_available": fa.available(),
    }


def _clean(values: Dict[str, Any], headers: List[str], roles: Dict[str, Optional[str]], rights: set,
           own_id: Optional[int], taken: Dict[str, int], max_len: int) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    allowed = set(_editable(headers, roles))
    for col, v in values.items():
        if col not in allowed:
            raise ValueError(f"{col}: column cannot be changed")
        low = col.lower()
        if low in ("active", "adminbox"):
            out[col] = 1 if v in (True, 1, "1", "true", "True") else 0
        elif col == roles["access"]:
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise ValueError(f"{col}: unknown access right")
            if v not in rights:
                raise ValueError(f"{col}: unknown access right")
            out[col] = v
        elif low in ("colour", "color", "accentcolour"):
            c = ua.normalize_colour(v)
            if v not in (None, "") and not c:
                raise ValueError(f"{col}: colour expected (#RRGGBB)")
            out[col] = c
        elif col == roles["username"]:
            name = str(v or "").strip()
            if not name:
                raise ValueError(f"{col}: user name missing")
            if max_len and len(name) > max_len:
                raise ValueError(f"{col}: at most {max_len} characters")
            other = taken.get(name.lower())
            if other is not None and other != own_id:
                raise ValueError(f"{col}: user name '{name}' exists already")
            out[col] = name
        elif low == "welcomemessage":
            out[col] = (str(v or "").strip()[:WELCOME_MAX]) or None
        else:
            out[col] = None if v in (None, "") else (v.strip() if isinstance(v, str) else v)
    return out


class Change(BaseModel):
    id: int
    values: Dict[str, Any]


class SaveBody(BaseModel):
    rows: List[Change]


@router.post("/save")
def save(body: SaveBody, user: Dict[str, Any] = Depends(current_user)):
    bad = _guard(user)
    if bad:
        return bad
    rows = ua.load_users()
    headers = _visible(list(rows[0].keys()) if rows else ["ID"])
    roles = ua.column_roles(headers)
    rights = {i for i, _n, _l in ua.access_rights()}
    taken = {str(r.get(roles["username"]) or "").strip().lower(): int(r[roles["id"]]) for r in rows if roles["username"]}
    try:
        clean = [{roles["id"]: ch.id, **_clean(ch.values, headers, roles, rights, ch.id, taken, ua.username_max_len())}
                 for ch in body.rows if ch.values]
    except ValueError as e:
        return _err(400, "bad_value", str(e))
    n = ua.save_changes(clean, roles["id"])
    log_usage_event("feature", "web_manage_user_save", str(len(clean)))
    return {"saved": n}


class NewUser(BaseModel):
    username: str
    first: str = ""
    last: str = ""
    access_id: Optional[int] = None
    password: str
    repeat: str


@router.post("/new")
def new_user(body: NewUser, user: Dict[str, Any] = Depends(current_user)):
    bad = _guard(user)
    if bad:
        return bad
    name = body.username.strip()
    max_len = ua.username_max_len()
    if not name:
        return _err(400, "name_missing", "Please enter a user name.")
    if max_len and len(name) > max_len:
        return _err(400, "name_too_long", f"At most {max_len} characters.", vars={"n": max_len})
    if name.lower() in ua.existing_usernames():
        return _err(400, "name_taken", f"User name '{name}' exists already.", vars={"name": name})
    if body.access_id is not None and body.access_id not in {i for i, _n, _l in ua.access_rights()}:
        return _err(400, "bad_value", "Unknown access right.")
    problem = ua.check_new_password(name, body.password, body.repeat)
    if problem:
        return _err(400, "bad_password", problem)
    new_id = ua.create_user(name, body.password, body.first, body.last, body.access_id)
    log_usage_event("feature", "web_manage_user_new", str(new_id))
    return {"id": new_id, "username": name}


class PasswordBody(BaseModel):
    password: str
    repeat: str


@router.post("/{user_id}/password")
def reset_password(user_id: int, body: PasswordBody, user: Dict[str, Any] = Depends(current_user)):
    bad = _guard(user)
    if bad:
        return bad
    rows = [r for r in ua.load_users() if int(r.get("ID") or 0) == user_id]
    if not rows:
        return _err(404, "not_found", "User not found.")
    roles = ua.column_roles(list(rows[0].keys()))
    username = str(rows[0].get(roles["username"]) or "").strip()
    if not username:
        return _err(400, "no_username", "Selected row has no username.")
    problem = ua.check_new_password(username, body.password, body.repeat)
    if problem:
        return _err(400, "bad_password", problem)
    if not ua.reset_password(username, body.password):
        return _err(500, "reset_failed", "Password could not be updated.")
    log_usage_event("feature", "web_manage_user_password", str(user_id))
    return {"ok": True, "username": username}


class DeleteBody(BaseModel):
    ids: List[int]


@router.post("/delete")
def delete(body: DeleteBody, user: Dict[str, Any] = Depends(current_user)):
    bad = _guard(user)
    if bad:
        return bad
    if user.get("id") in body.ids:
        return _err(400, "delete_self", "You cannot delete your own account.")
    try:
        n = ua.delete_users(body.ids)
    except ua.UserHasData as e:
        return _err(409, "has_data", f"The user still has data ({', '.join(e.tables)}) - deactivate the account instead.")
    except Exception as e:
        return _err(409, "delete_failed", f"Could not delete: {e}")
    log_usage_event("feature", "web_manage_user_delete", str(n))
    return {"deleted": n}


# ------------------------------------------------------------------ Access… (tools / screens per group or person)
@router.get("/access")
def access(user: Dict[str, Any] = Depends(current_user)):
    bad = _guard(user)
    if bad:
        return bad
    if not fa.available():
        return {"available": False}
    from .nav import SECTIONS
    route = {key: r for _s, _i, items in SECTIONS for key, _l, _ic, r, _b in items if key}
    data = fa.load_all()
    groups = [g for g in data["groups"] if int(g.get("Level") or 0) < fa.SUPERUSER_LEVEL]
    level_of = {int(g["ID"]): int(g.get("Level") or 0) for g in data["groups"]}
    users = [u for u in data["users"]
             if level_of.get(int(u["GroupID"]) if u.get("GroupID") is not None else -1, 0) < fa.SUPERUSER_LEVEL]
    return {
        "available": True,
        "features": [{"key": f.key, "label": f.label, "section": f.section, "min_level": f.min_level,
                      "route": route.get(f.key)} for f in fa.FEATURES],
        "groups": [{"id": int(g["ID"]), "name": g["Name"], "level": int(g.get("Level") or 0)} for g in groups],
        "users": [{"id": int(u["ID"]), "name": u["Name"], "group": int(u["GroupID"]) if u.get("GroupID") is not None else None}
                  for u in users],
        "group_rules": {str(k): v for k, v in data["group_rules"].items()},
        "user_rules": {str(k): v for k, v in data["user_rules"].items()},
    }


class AccessBody(BaseModel):
    group_rules: Dict[int, Dict[str, bool]]
    user_rules: Dict[int, Dict[str, bool]]


@router.post("/access")
def save_access(body: AccessBody, user: Dict[str, Any] = Depends(current_user)):
    bad = _guard(user)
    if bad:
        return bad
    if not fa.available():
        return _err(409, "unavailable", "Switching tools on and off is not available in this database yet.")
    fa.save_all(body.group_rules, body.user_rules)
    log_usage_event("feature", "feature_access_save", "web")
    return {"ok": True}
