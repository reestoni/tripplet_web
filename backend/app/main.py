"""TrippleT web backend (FastAPI).

Start (development): see start_dev.ps1 in the project root, or
    python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload   (in backend/)
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import whats_new_api, search_api, notifications_api, recycle_bin_api, admin_master, quick_scan_api, process_playground_api, tdms_inspector, label_generator_api, image_compare_api, air_supply_api, core
from . import jet_roi_api, yarn_count_api, admin_jets, admin_yarn, auth, create_api, help, kb, nav, report, requests_api, series_actions, series_edit, series_manage, series_tools, series_lists, series_view, settings_api, smart_chart_api, stock_take_api, user_admin_api, user_context, yarn_stock_api, yarnscope, yarnscope_aty
from .deps import current_user

from db.usage_log import log_usage_event  # noqa: E402

app = FastAPI(title="TrippleT Web", version=core.APP_VERSION, docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(auth.SessionMiddleware)
app.include_router(series_lists.router)
app.include_router(series_view.router)
app.include_router(report.router)
app.include_router(yarnscope.router)
app.include_router(yarnscope_aty.router)
app.include_router(requests_api.router)
app.include_router(requests_api.links_router)
app.include_router(create_api.router)
app.include_router(help.router)
app.include_router(admin_jets.router)
app.include_router(admin_yarn.router)
app.include_router(yarn_stock_api.router)
app.include_router(stock_take_api.router)
app.include_router(user_admin_api.router)
app.include_router(settings_api.router)
app.include_router(whats_new_api.router)
app.include_router(search_api.router)
app.include_router(notifications_api.router)
app.include_router(recycle_bin_api.router)
app.include_router(admin_master.router)
app.include_router(quick_scan_api.router)
app.include_router(process_playground_api.router)
app.include_router(tdms_inspector.router)
app.include_router(label_generator_api.router)
app.include_router(image_compare_api.router)
app.include_router(air_supply_api.router)
app.include_router(jet_roi_api.router)
app.include_router(yarn_count_api.router)
app.include_router(settings_api.auth_router)
app.include_router(smart_chart_api.router)
app.include_router(series_edit.router)
app.include_router(series_actions.router)
app.include_router(series_manage.router)
app.include_router(series_tools.router)
app.include_router(kb.router)
app.include_router(kb.assets_router)
from . import uploads  # noqa: E402
app.include_router(uploads.router)
from . import schema  # noqa: E402
app.include_router(schema.router)


class LoginBody(BaseModel):
    username: str
    password: str


@app.get("/api/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "mode": core.MODE, "db": core.DB_NAME, "version": core.APP_VERSION}


@app.post("/api/auth/login")
def login(body: LoginBody, response: Response) -> Dict[str, Any]:
    try:
        profile = auth.attempt_login(body.username, body.password)
    except auth.LoginError as e:
        return JSONResponse(status_code=401, content={"code": e.code, "detail": e.message})
    except Exception:
        return JSONResponse(status_code=503, content={"code": "db",
                                                      "detail": "TrippleT could not connect to the database."})
    token = user_context.set_user(profile)       # usage log writes UserID/Username of this user
    try:
        log_usage_event("login", "login", "web")
    finally:
        user_context.reset(token)
    response.set_cookie(auth.COOKIE_NAME, auth.make_cookie(profile["username"]), max_age=auth.SESSION_MAX_AGE,
                        httponly=True, samesite="lax", path="/")
    return {"user": profile}


@app.post("/api/auth/logout")
def logout(response: Response) -> Dict[str, Any]:
    user = user_context.get_user()
    auth.forget(user.get("username") if user else None)
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/me")
def me(user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    from .start_page import start_route
    from .settings_api import display_prefs
    return {"user": user, "mode": core.MODE, "db": core.DB_NAME, "version": core.APP_VERSION,
            "start_route": start_route(user), "display": display_prefs(user.get("id"))}


@app.get("/api/nav")
def get_nav(user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    return nav.build_nav(user)


_IMAGE_NAME = re.compile(r"^[A-Za-z0-9_.-]+\.(png|svg|ico)$")


@app.get("/api/img/{name}")
def image(name: str) -> FileResponse:
    """Icons/logos straight from the desktop project's assets/images (no copy)."""
    if not _IMAGE_NAME.match(name):
        raise HTTPException(status_code=404)
    path = core.IMAGES_DIR / name
    if not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(path, headers={"Cache-Control": "max-age=3600"})


# --- built frontend (npm run build) - in development Vite serves it instead ---
_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404)
        f = (_DIST / path).resolve()
        if path and f.is_file() and _DIST in f.parents:
            return FileResponse(f)
        return FileResponse(_DIST / "index.html")
