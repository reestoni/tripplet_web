"""user_context.py - the logged-in user per request instead of per process.

The desktop app keeps the user in the global dict ``app_meta.current_user``,
and several core modules read it (change_log, usage_log, series_permissions,
recycle_bin, ...). In a web server many requests run at the same time, so
``app_meta.current_user`` is replaced by a proxy that reads a ContextVar. The
core modules keep working unchanged and see the user of *their* request.
"""
from __future__ import annotations

from collections.abc import MutableMapping
from contextvars import ContextVar
from typing import Any, Dict, Iterator, Optional

_current: ContextVar[Optional[Dict[str, Any]]] = ContextVar("tripplet_current_user", default=None)


class UserProxy(MutableMapping):
    """Behaves like the old dict; empty (falsy) when nobody is logged in."""

    def _d(self) -> Dict[str, Any]:
        return _current.get() or {}

    def __getitem__(self, key: str) -> Any:
        return self._d()[key]

    def __setitem__(self, key: str, value: Any) -> None:
        d = _current.get()
        if d is None:
            d = {}
            _current.set(d)
        d[key] = value

    def __delitem__(self, key: str) -> None:
        del self._d()[key]

    def __iter__(self) -> Iterator[str]:
        return iter(self._d())

    def __len__(self) -> int:
        return len(self._d())

    def __repr__(self) -> str:
        return f"UserProxy({self._d()!r})"


def install_user_proxy(app_meta_module) -> None:
    if not isinstance(getattr(app_meta_module, "current_user", None), UserProxy):
        app_meta_module.current_user = UserProxy()


def set_user(user: Optional[Dict[str, Any]]):
    """Returns the token for reset()."""
    return _current.set(dict(user) if user else None)


def reset(token) -> None:
    _current.reset(token)


def get_user() -> Optional[Dict[str, Any]]:
    return _current.get()
