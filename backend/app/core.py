"""core.py - connects the web backend to the TrippleT desktop code (the "core").

The web app does NOT copy any business logic: db/ and the Qt-free logic
modules are imported straight from the desktop project. This module must be
imported before anything from the core (it sets TRIPPLET_MODE and sys.path).

Phase 1 (2026-11-13): only dev_local is allowed - the backend refuses to
start against dev or prod.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

CORE_PATH = Path(os.environ.get("TRIPPLET_CORE_PATH", r"C:\python\tripplet_project")).resolve()

# Phase 1: only the local development database. Widen deliberately later.
ALLOWED_MODES = {"dev_local"}

MODE = os.environ.setdefault("TRIPPLET_MODE", "dev_local")
if MODE not in ALLOWED_MODES:
    raise RuntimeError(f"TRIPPLET_MODE={MODE!r} is not allowed for the web app (allowed: {sorted(ALLOWED_MODES)})")
if not (CORE_PATH / "db" / "connection.py").is_file():
    raise RuntimeError(f"TrippleT core not found at {CORE_PATH} (set TRIPPLET_CORE_PATH)")
if str(CORE_PATH) not in sys.path:
    sys.path.insert(0, str(CORE_PATH))

from db import connection as db  # noqa: E402  (core import after sys.path)

if not db.is_dev_local_mode():
    raise RuntimeError("db.connection is not in dev_local mode - refusing to start")

import app_meta  # noqa: E402

from .user_context import install_user_proxy  # noqa: E402

install_user_proxy(app_meta)

IMAGES_DIR = CORE_PATH / "assets" / "images"

# Server settings (deploy/web.env on the VM). HTTPS = the reverse proxy in front speaks HTTPS ->
# the session cookie is sent over HTTPS only.
HTTPS = os.environ.get("TRIPPLET_WEB_HTTPS", "").strip().lower() in ("1", "true", "yes")
INSTANCE = os.environ.get("TRIPPLET_WEB_INSTANCE", "").strip()   # e.g. "test" - shown in the sidebar
# release built by deploy/build_release.ps1 (both commits); empty when running from the repos
_REL = Path(__file__).resolve().parents[2] / "RELEASE.txt"
RELEASE = _REL.read_text(encoding="utf-8-sig").strip() if _REL.is_file() else ""
APP_VERSION = app_meta.APP_VERSION
DB_NAME = db.current_db_name()
