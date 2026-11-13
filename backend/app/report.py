"""report.py - the desktop's series Report page in the browser.

The page itself (ui/report_html_template.py, built by db/report_service.series_report_page)
is used unchanged; only its transport is swapped: the Qt QWebChannel script is replaced
by /report-assets/web_bridge.js, which sends every bridge call to POST /api/report/slot/<name>
and hands the answer to the page's own receiveXxx(...) function - the same answer the
desktop gives (db/report_service.handle).

Web-only hardening: the page's free fields and visual-query filters are put into SQL by
the shared code (harmless on a desktop, not over HTTP), so their inputs are checked here.
"""
from __future__ import annotations

import datetime
import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from pydantic import BaseModel

from . import core
from .deps import current_user

from db import report_service as rs  # noqa: E402
from db.connection import get_columns_map, table_exists  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter()

_STATIC = Path(__file__).resolve().parent / "static"
_CORE_JS = core.CORE_PATH / "assets" / "js"

_QT_SCRIPT = '<script src="qrc:///qtwebchannel/qwebchannel.js"></script>'
_PLOTLY_SCRIPT = '<script src="plotly-2.32.0.min.js"></script>'


def _web_page(html: str) -> str:
    if _QT_SCRIPT not in html or _PLOTLY_SCRIPT not in html:
        raise RuntimeError("report page template changed - update app/report.py")
    html = html.replace(_PLOTLY_SCRIPT, '<script src="/report-assets/plotly-2.32.0.min.js"></script>')
    return html.replace(_QT_SCRIPT, '<script src="/report-assets/web_bridge.js"></script>')


@router.get("/report/series/{series_pk}", response_class=HTMLResponse)
def report_page(series_pk: int, report_id: Optional[int] = Query(None),
                user: Dict[str, Any] = Depends(current_user)) -> HTMLResponse:
    page = rs.series_report_page(series_pk, report_id, user=user)
    return HTMLResponse(_web_page(page["html"]), headers={"Cache-Control": "no-store"})


@router.get("/report-assets/{name}")
def report_asset(name: str) -> FileResponse:
    if name == "web_bridge.js":
        return FileResponse(_STATIC / "web_bridge.js", media_type="text/javascript",
                            headers={"Cache-Control": "no-store"})
    if name == "plotly-2.32.0.min.js":
        return FileResponse(_CORE_JS / name, media_type="text/javascript",
                            headers={"Cache-Control": "max-age=86400"})
    raise HTTPException(status_code=404)


# --------------------------------------------------------------------------- input checks
_OPS = {"=", "!=", "<>", "<", ">", "<=", ">=", "IN"}
_COND = re.compile(r"^\s*`?\[?[A-Za-z_][A-Za-z0-9_ ]*\]?`?\s*(=|<>|!=|<=|>=|<|>)\s*"
                   r"('[^';\\]*'|-?\d+(\.\d+)?)\s*$")


def _check_slot_args(slot: str, args: List[Any]) -> Optional[str]:
    """None = ok, otherwise why the call is refused."""
    if slot == "loadFreeField":
        if len(args) != 5:
            return "bad arguments"
        table, field, condition = (str(a or "") for a in args[:3])
        if not re.fullmatch(r"[A-Za-z0-9_]+", table) or not table_exists(table):
            return "unknown table"
        if field not in get_columns_map(table).values():
            return "unknown field"
        if condition.strip() and not _COND.match(condition):
            return "condition not allowed"
    elif slot == "runVisualQuery":
        try:
            filters = json.loads(args[2] or "[]") if len(args) > 2 else []
            adv = json.loads(args[3] or "[]") if len(args) > 3 else []
        except (TypeError, ValueError):
            return "bad arguments"
        for f in filters or []:
            if str((f or {}).get("op", "=")).upper() not in _OPS:
                return "operator not allowed"
        for f in adv or []:
            if str((f or {}).get("op", "=")).upper() not in _OPS:
                return "operator not allowed"
    return None


class SlotBody(BaseModel):
    args: List[Any] = []
    series_pk: Optional[int] = None


@router.post("/api/report/slot/{slot}")
def report_slot(slot: str, body: SlotBody, user: Dict[str, Any] = Depends(current_user)):
    if slot not in rs.SLOTS:
        return JSONResponse(status_code=404, content={"code": "unknown_slot", "detail": slot})
    args = ["" if a is None else (a if isinstance(a, str) else json.dumps(a) if isinstance(a, (dict, list)) else str(a))
            for a in body.args]
    why = _check_slot_args(slot, args)
    if why:
        return JSONResponse(status_code=400, content={"code": "refused", "detail": why})
    res = rs.handle(slot, args, user=user, series_pk=body.series_pk)
    if res is None:
        return {"receiver": None, "args": []}
    receiver, out = res
    return Response(json.dumps({"receiver": receiver, "args": out}, default=str), media_type="application/json")


class PdfBody(BaseModel):
    payload: str


@router.post("/api/report/pdf")
def report_pdf(body: PdfBody, user: Dict[str, Any] = Depends(current_user)) -> Response:
    payload = json.loads(body.payload)
    now = datetime.datetime.now()
    pdf = rs.build_report_pdf(payload, now)
    log_usage_event("feature", "pdf_export", "web")
    name = rs.pdf_default_filename(payload, now)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


class JsErrorBody(BaseModel):
    message: str


@router.post("/api/report/js-error")
def report_js_error(body: JsErrorBody, user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    import logging
    logging.getLogger("tripplet_web.report").error("JS ERROR (%s): %s", user.get("username"), body.message[:2000])
    return {"ok": True}
