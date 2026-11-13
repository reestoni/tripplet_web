"""kb.py - Knowledge Base in the browser (desktop: ui/screen_onboarding.py, internally "onboarding").

The module pages are the same self-contained web pages as on the desktop (assets/onboarding/
<key>.html + <key>_texts.js, served here under /kb-assets/). The list comes from
ui/onboarding_catalog.py (Qt-free). Quiz results = usage log `feature/onboarding_quiz` like the
desktop (the Lernnachweis); the tick in the list is the best result of the logged-in user from
that log (the desktop keeps it per PC in QSettings).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import core
from .deps import current_user

from ui import onboarding_catalog as cat  # noqa: E402  (Qt-free)
from db.connection import fetch_all  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/kb")
assets_router = APIRouter()

ASSETS_DIR = core.CORE_PATH / "assets" / "onboarding"
_QUIZ_DETAIL = re.compile(r"^(\S+)\s+(\d+)/(\d+)\b")


def _lang(lang: str) -> str:
    return lang if lang in cat.LANGS else "en"


def best_quiz_results(user_id: Any) -> Dict[str, Tuple[int, int]]:
    """{module: (right, total)} - best result per module from the usage log (a passed quiz stays passed)."""
    if user_id is None:
        return {}
    try:
        rows = fetch_all("SELECT Detail FROM tblUsageLog WHERE UserID = ? AND EventType = 'feature' "
                         "AND EventName = 'onboarding_quiz'", [int(user_id)])
    except Exception:
        return {}
    best: Dict[str, Tuple[int, int]] = {}
    for r in rows:
        m = _QUIZ_DETAIL.match(str(r.get("Detail") or ""))
        if not m:
            continue
        key, right, total = m.group(1), int(m.group(2)), int(m.group(3))
        if total <= 0:
            continue
        old = best.get(key)
        if old is None or right / total > old[0] / old[1]:
            best[key] = (right, total)
    return best


def _module_json(m: cat.Module, lang: str, quiz: Dict[str, Tuple[int, int]]) -> Dict[str, Any]:
    res = quiz.get(m.key)
    return {"key": m.key, "title": cat.text(m.title, lang), "summary": cat.text(m.summary, lang),
            "minutes": m.minutes,
            "quiz": None if res is None else {"right": res[0], "total": res[1], "passed": cat.quiz_passed(*res)}}


@router.get("/catalog")
def catalog(lang: str = "en", user: Dict[str, Any] = Depends(current_user)):
    """List of the Knowledge Base like the desktop tree: start page, then areas > categories > (folders) > modules."""
    lang = _lang(lang)
    quiz = best_quiz_results(user.get("id"))
    start = next((m for m in cat.MODULES if m.key == cat.START_MODULE), None)
    areas: List[Dict[str, Any]] = []
    by_area: Dict[str, Dict[str, Any]] = {}
    for ckey, names in cat.CATEGORIES.items():
        mods = [m for m in cat.MODULES if m.category == ckey]
        if not mods:
            continue
        akey = cat.CATEGORY_AREA.get(ckey, "")
        area = by_area.get(akey)
        if area is None:
            area = {"key": akey, "title": cat.text(cat.AREAS.get(akey, {"en": akey}), lang), "categories": []}
            by_area[akey] = area
            areas.append(area)
        groups: Dict[str, Dict[str, Any]] = {}
        for m in mods:
            if m.group and m.group not in groups:
                groups[m.group] = {"key": m.group, "title": cat.text(cat.GROUPS.get(m.group, {"en": m.group}), lang),
                                   "modules": []}
            if m.group:
                groups[m.group]["modules"].append(_module_json(m, lang, quiz))
        area["categories"].append({
            "key": ckey, "title": cat.text(names, lang),
            "modules": [_module_json(m, lang, quiz) for m in mods if not m.group],
            "groups": list(groups.values()),
        })
    return {"lang": lang, "start": _module_json(start, lang, quiz) if start else None, "areas": areas,
            "ui": {k: cat.text(v, lang) for k, v in cat.UI.items()}}


@router.get("/module/{key}")
def module(key: str, lang: str = "en", _user: Dict[str, Any] = Depends(current_user)):
    """Title, summary and scene tabs (+ "Quiz") of one module; logs the open like the desktop."""
    lang = _lang(lang)
    m = next((x for x in cat.MODULES if x.key == key), None)
    if m is None or not (ASSETS_DIR / f"{m.key}.html").is_file():
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": cat.text(cat.UI["missing"], lang)})
    return {"key": m.key, "title": cat.text(m.title, lang), "summary": cat.text(m.summary, lang),
            "scenes": cat.scene_names(m.key, lang), "url": f"/kb-assets/{m.key}.html"}


class Opened(BaseModel):
    key: str


@router.post("/opened")
def opened(body: Opened, _user: Dict[str, Any] = Depends(current_user)):
    if any(m.key == body.key for m in cat.MODULES):
        log_usage_event("feature", "onboarding_module", body.key)
    return {"ok": True}


class Quiz(BaseModel):
    key: str
    right: int
    total: int
    lang: str = "en"


@router.post("/quiz")
def quiz(body: Quiz, user: Dict[str, Any] = Depends(current_user)):
    """Page reported "quiz:<right>:<total>" - same usage-log entry as the desktop (record_quiz_result)."""
    if not any(m.key == body.key for m in cat.MODULES):
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "Unknown module."})
    if body.total <= 0 or not 0 <= body.right <= body.total:
        return JSONResponse(status_code=400, content={"code": "invalid", "detail": "Invalid result."})
    passed = cat.quiz_passed(body.right, body.total)
    log_usage_event("feature", "onboarding_quiz",
                    f"{body.key} {body.right}/{body.total} {'passed' if passed else 'failed'} ({_lang(body.lang)})")
    best = best_quiz_results(user.get("id")).get(body.key, (body.right, body.total))
    return {"passed": passed, "best": {"right": best[0], "total": best[1], "passed": cat.quiz_passed(*best)}}


_ASSET_NAME = re.compile(r"^[A-Za-z0-9_\-]+\.(html|js|css|svg|png|jpg|webp)$")
_TYPES = {"html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css",
          "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


@assets_router.get("/kb-assets/{name}")
def asset(name: str, _user: Dict[str, Any] = Depends(current_user)):
    """The module pages and their texts - only for logged-in users, only plain file names of that folder."""
    if not _ASSET_NAME.match(name) or not (ASSETS_DIR / name).is_file():
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "Not found."})
    return FileResponse(ASSETS_DIR / name, media_type=_TYPES[name.rsplit(".", 1)[1]],
                        headers={"Cache-Control": "no-cache"})
