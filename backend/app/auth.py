"""auth.py - login against tblUser (same rules as the desktop login) + session cookie.

Session = signed cookie (itsdangerous) holding only the username and the login
time. The full profile (access level, names, ...) is read again from the DB
(cached for PROFILE_TTL seconds), so a changed access level applies quickly.
"""
from __future__ import annotations

import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from . import core  # noqa: F401  (core first: sys.path + mode)
from . import user_context

from db.connection import check_credentials, is_user_active, verify_user_password  # noqa: E402
from db.user_profile import load_profile  # noqa: E402

COOKIE_NAME = "tripplet_session"
SESSION_MAX_AGE = 12 * 3600          # seconds; log in again after a working day
PROFILE_TTL = 60                     # seconds


def _secret_key() -> str:
    """Per installation, outside the repo (%LOCALAPPDATA%\\TrippleT\\web_secret.key)."""
    env = os.environ.get("TRIPPLET_WEB_SECRET")
    if env:
        return env
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "TrippleT"
    path = base / "web_secret.key"
    if not path.is_file():
        base.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_urlsafe(48), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip()


_serializer = URLSafeTimedSerializer(_secret_key(), salt="tripplet-web-session")

_profile_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_cache_lock = threading.Lock()


class LoginError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def attempt_login(username: str, password: str) -> Dict[str, Any]:
    """Same checks as ui/screen_login.py::_attempt_login. Raises LoginError."""
    username = (username or "").strip()
    if not username or not password:
        raise LoginError("missing", "Please enter username and password.")
    if username.lower() == password.lower():
        # the page then offers the change (desktop ScreenChangePw): /api/auth/initial-password
        raise LoginError("insecure_password",
                         "The password must not be the same as the username. Please set a new password.")
    if not check_credentials(username, password):
        try:
            if verify_user_password(username, password) and not is_user_active(username):
                raise LoginError("inactive", "This user is inactive. Please contact an administrator.")
        except LoginError:
            raise
        except Exception:
            pass
        raise LoginError("invalid", "Wrong username or password.")
    profile = load_profile(username)
    if profile.get("id") is None:
        raise LoginError("invalid", "Wrong username or password.")
    with _cache_lock:
        _profile_cache[username.lower()] = (time.monotonic(), profile)
    return profile


def make_cookie(username: str) -> str:
    return _serializer.dumps({"u": username, "t": int(time.time())})


def read_cookie(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        data = _serializer.loads(value, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    return data.get("u") if isinstance(data, dict) else None


def profile_for(username: str) -> Optional[Dict[str, Any]]:
    key = username.lower()
    now = time.monotonic()
    with _cache_lock:
        hit = _profile_cache.get(key)
    if hit and now - hit[0] < PROFILE_TTL:
        return hit[1]
    try:
        if not is_user_active(username):
            return None
        profile = load_profile(username)
    except Exception:
        return hit[1] if hit else None
    if profile.get("id") is None:
        return None
    with _cache_lock:
        _profile_cache[key] = (now, profile)
    return profile


def forget(username: Optional[str]) -> None:
    if username:
        with _cache_lock:
            _profile_cache.pop(username.lower(), None)


class SessionMiddleware:
    """Pure ASGI: reads the cookie and puts the user into the ContextVar for the
    whole request (sync endpoints run in a thread pool that copies the context)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        username = None
        for name, value in scope.get("headers") or []:
            if name == b"cookie":
                for part in value.decode("latin-1").split(";"):
                    k, _, v = part.strip().partition("=")
                    if k == COOKIE_NAME:
                        username = read_cookie(v)
        user = None
        if username:
            from starlette.concurrency import run_in_threadpool
            user = await run_in_threadpool(profile_for, username)
        token = user_context.set_user(user)
        try:
            await self.app(scope, receive, send)
        finally:
            user_context.reset(token)
