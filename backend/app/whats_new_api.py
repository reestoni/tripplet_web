"""whats_new_api.py - "Fresh off the Spool" (desktop ui/whats_new.py) on ui/whats_new_data.py + the texts of
ui/widgets/whats_new_texts.py (EN / DE / ES; Chinese falls back to English like the help texts).

Versions newest first with their feature cards grouped by section heading, the search over all versions and
languages (help-search synonyms), and "seen": the newest version is stored per user in DisplaySettings
("whats_new_seen", the same value as the desktop) - the page opens the window once after login if it is new."""
from __future__ import annotations

import os
import re
from typing import Any, Dict

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, JSONResponse

from . import core  # noqa: F401
from .deps import current_user

from db import display_settings as ds  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from ui import whats_new_data as wd  # noqa: E402
from ui.widgets import whats_new_texts as wt  # noqa: E402

router = APIRouter(prefix="/api/whats-new")
LANGS = ("en", "de", "es")
SKETCH_DIR = str(core.CORE_PATH / "assets" / "images" / "whats_new")


def _lang(lang: str) -> str:
    return lang if lang in LANGS else "en"


def _seen(user: Dict[str, Any]) -> str:
    return str((ds.load(user.get("id")) or {}).get("whats_new_seen") or "")


def _card(block, ri: int, bi: int) -> Dict[str, Any]:
    _k, title, text, where, sketch = (list(block) + [None] * 5)[:5]
    return {"id": f"{ri}:{bi}", "title": title, "text": text, "where": where or "", "sketch": sketch or None}


@router.get("")
def releases(lang: str = "en", user: Dict[str, Any] = Depends(current_user)):
    lang = _lang(lang)
    unseen = set(wd.unseen_versions(_seen(user), wt.RELEASES))
    out = []
    for ri, r in enumerate(wt.RELEASES):
        blocks = r["texts"][lang]
        sections, cur = [], None
        for bi, b in enumerate(blocks):
            if b[0] == "h":
                cur = {"title": str(b[1]), "features": []}
                sections.append(cur)
            elif b[0] == "feature":
                if cur is None:
                    cur = {"title": "", "features": []}
                    sections.append(cur)
                cur["features"].append(_card(b, ri, bi))
        v = wd.release_version(r)
        out.append({"index": ri, "version": v, "when": wd.release_when(r, lang), "unseen": v in unseen,
                    "current": r.get("version") == "current", "sections": [s for s in sections if s["features"]]})
    labels = {k: getattr(wt, k)[lang] for k in ("WINDOW_TITLE", "SUBTITLE", "VERSIONS_TITLE", "NEW_BADGE", "WHERE_LABEL",
                                                "VERSION_LABEL", "CURRENT_LABEL", "CLOSE", "SEARCH_PLACEHOLDER",
                                                "SEARCH_RESULTS", "SEARCH_NONE", "HITS_LABEL")}
    return {"lang": lang, "releases": out, "labels": labels, "has_unseen": bool(unseen)}


@router.get("/status")
def status(user: Dict[str, Any] = Depends(current_user)):
    return {"has_unseen": wd.has_unseen(_seen(user), wt.RELEASES), "current": wd.current_release_id(wt.RELEASES)}


@router.get("/search")
def search(q: str, lang: str = "en", user: Dict[str, Any] = Depends(current_user)):
    lang = _lang(lang)
    hits = []
    for ri, bi in wd.search_features(q[:200], wt.RELEASES):
        r = wt.RELEASES[ri]
        hits.append({"release": ri, "version": wd.release_version(r), **_card(r["texts"][lang][bi], ri, bi)})
    log_usage_event("feature", "whats_new_search" if hits else "whats_new_noresult", q[:120])
    return {"hits": hits}


@router.post("/seen")
def seen(body: Dict[str, Any] = None, user: Dict[str, Any] = Depends(current_user)):
    cur = wd.current_release_id(wt.RELEASES)
    if cur and ds.has_column() and _seen(user) != cur:
        ds.update(user.get("id"), whats_new_seen=cur)
        if (body or {}).get("auto"):
            log_usage_event("feature", "whats_new_auto", str(cur))
    return {"ok": True}


@router.get("/sketch/{name}")
def sketch(name: str, user: Dict[str, Any] = Depends(current_user)):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+\.(svg|png)", name or ""):
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "Not found."})
    path = os.path.join(SKETCH_DIR, name)
    if not os.path.isfile(path):
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "Not found."})
    return FileResponse(path, media_type="image/svg+xml" if name.endswith(".svg") else "image/png",
                        headers={"Cache-Control": "private, max-age=3600"})
