"""deps.py - FastAPI dependencies: logged-in user and feature rights (db/feature_access.py)."""
from __future__ import annotations

from typing import Any, Callable, Dict

from fastapi import Depends, HTTPException

from . import core  # noqa: F401
from . import user_context

from db import feature_access as fa  # noqa: E402


def current_user() -> Dict[str, Any]:
    user = user_context.get_user()
    if not user:
        raise HTTPException(status_code=401, detail="Not logged in")
    return user


def can_use(user: Dict[str, Any], key: str) -> bool:
    uid = user.get("id")
    level = int(user.get("access_level") or 0)
    rules = fa.rules_for(int(uid) if uid is not None else None, level)
    return fa.decide(key, level, rules["user"], rules["groups"])


def require_feature(key: str) -> Callable[..., Dict[str, Any]]:
    """Same rule as the desktop's MainWindow._install_feature_guards()."""
    def dep(user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
        if not can_use(user, key):
            raise HTTPException(status_code=403, detail="You are not allowed to use this.")
        return user
    return dep
