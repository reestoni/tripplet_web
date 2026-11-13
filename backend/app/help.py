"""help.py - context help and help search (F1) like the desktop.

Content = the desktop's pure data modules (ui/widgets/help_texts_<screen>.py, EN/DE/ES), never
copied. Search, synonyms, ranking and KB hits = ui/help_index.py + ui/kb_search.py (Qt-free,
shared). Usage events are the desktop's help_* events, so Usage Stats -> Help shows both apps.
"Ask AI" of the desktop is deliberately NOT in the web app (user decision 2026-11-13).
"""
from __future__ import annotations

import base64
import importlib
import re
from typing import Any, Dict
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from . import core
from .deps import current_user

from ui import help_index as hi  # noqa: E402  (Qt-free)
from ui import kb_search  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/help")

HELP_LANGS = ("en", "de", "es")

# desktop screen key -> web route ("Take me there"); show_experiment/report need an open
# series -> All Experiments, like the desktop (help_index.NEEDS_SERIES)
WEB_ROUTES: Dict[str, str] = {
    "all_experiments": "/experiments", "backlog": "/backlog", "show_experiment": "/experiments",
    "report": "/experiments", "create_experiment": "/experiments/new", "dashboards": "/tools/dashboards",
    "smart_chart": "/tools/smart-chart", "manage_yarn": "/admin/yarn", "manage_jets": "/admin/jets",
    "process_playground": "/tools/process-playground", "yarn_stock": "/tools/yarn-stock",
}

# help windows without a search entry (own format on the desktop)
EXTRA_HELP = {"experiment_request", "yarn_stock"}

LOG_EVENTS = {"help_search_open", "help_search_noclick", "help_search_noresult",
              "help_feedback_up", "help_feedback_down"}


def help_lang(lang: str) -> str:
    """Help texts exist in EN/DE/ES (desktop decision) - Chinese falls back to English."""
    return lang if lang in HELP_LANGS else "en"


def _web_ready(route: str) -> bool:
    from .nav import WEB_READY
    return route in WEB_READY


def _svg(rel_path: str, values: Dict[str, str]) -> str:
    """Sketch with {{key}} placeholders filled in (same as multilang_help.svg_widget), as data URL."""
    path = (core.CORE_PATH / rel_path).resolve()
    if core.CORE_PATH not in path.parents or not path.is_file():
        return ""
    src = path.read_text(encoding="utf-8")
    for k, v in (values or {}).items():
        src = src.replace("{{" + k + "}}", escape(v))
    return "data:image/svg+xml;base64," + base64.b64encode(src.encode("utf-8")).decode("ascii")


def block_json(block: tuple) -> Dict[str, Any]:
    """One help block (multilang_help BLOCKS) as JSON for the web dialog."""
    kind = block[0]
    if kind in ("p", "note", "warn"):
        return {"t": kind, "html": block[1]}
    if kind == "h":
        return {"t": "h", "text": block[1]}
    if kind == "task":
        return {"t": "task", "q": block[1], "steps": list(block[2]), "note": block[3] if len(block) > 3 else ""}
    if kind == "ul":
        return {"t": "ul", "items": list(block[1])}
    if kind == "areas":
        return {"t": "areas", "rows": [[a, b] for a, b in block[1]]}
    if kind == "table":
        return {"t": "table", "head": list(block[1]), "rows": [list(r) for r in block[2]]}
    if kind == "svg":
        _, path, values, w, h = block
        return {"t": "svg", "src": _svg(path, values), "w": w, "h": h}
    raise ValueError(f"Unknown help block type: {kind!r}")


def _module(screen: str):
    mods = {k: (m, f) for k, _n, m, f in hi.SOURCES}
    if screen not in mods or mods[screen][1] != "multilang":
        return None
    return importlib.import_module(mods[screen][0])


def _experiment_request_help() -> Dict[str, Any]:
    """The Experiment Request help (English only on the desktop) in the same shape."""
    from ui.widgets import experiment_request_help_texts as er
    page = {"window_title": er.WINDOW_TITLE, "close": "Close", "tabs": [{"key": "flow", "title": "Experiment Requests",
            "blocks": [{"t": "p", "html": er.INTRO},
                       {"t": "svg", "src": _svg(er.SVG, {}), "w": er.SVG_W, "h": er.SVG_H},
                       {"t": "warn", "html": er.NOTE}]}]}
    return {lang: page for lang in HELP_LANGS}


def _yarn_stock_help() -> Dict[str, Any]:
    """The Yarn Stock help (desktop ui/widgets/yarn_stock_help_dialog.py, own format: tasks / screen guide with
    sketch / background with spool life cycle / stock take) in the block format of the web dialog - same texts
    (ui/widgets/yarn_stock_help_texts.py), same tab keys for the direct jump (tab="stocktake")."""
    from ui.widgets import yarn_stock_help_texts as ys
    muted = lambda html: {"t": "p", "html": f"<span class='muted'>{html}</span>"}  # noqa: E731
    out = {}
    for lang, t in ys.TEXTS.items():
        def task(q, steps, note):
            return {"t": "task", "q": q, "steps": list(steps), "note": note or ""}
        tasks = [{"t": "p", "html": t["tasks_intro"]}, {"t": "h", "text": t["h_find"]}]
        tasks += [task(*x) for x in t["tasks_find"]]
        tasks += [{"t": "h", "text": t["h_change"]}, muted(t["change_note"])]
        tasks += [task(*x) for x in t["tasks_change"]]
        screen = [{"t": "svg", "src": _svg("assets/images/yarn_stock_screen_map.svg", t["svg_map"]), "w": 940, "h": 470},
                  muted(t["screen_caption"]),
                  {"t": "areas", "rows": [[a, b] for a, b in t["screen_areas"]]},
                  {"t": "h", "text": t["h_elsewhere"]}, {"t": "p", "html": t["elsewhere"]}]
        background = [{"t": "h", "text": t["h_levels"]}, {"t": "p", "html": t["levels"]},
                      {"t": "h", "text": t["h_life"]},
                      {"t": "svg", "src": _svg("assets/images/yarn_stock_spool_flow.svg", t["svg_flow"]), "w": 940, "h": 250},
                      {"t": "note", "html": t["life_note"]},
                      {"t": "h", "text": t["h_status"]}, {"t": "p", "html": t["status"]},
                      {"t": "h", "text": t["h_good"]}, {"t": "p", "html": t["good"]}]
        stocktake = [{"t": "p", "html": t["st_intro"]}]
        for heading, html in t["stocktake"]:
            stocktake += [{"t": "h", "text": heading}, {"t": "p", "html": html}]
        stocktake.append({"t": "note", "html": t["st_note"]})
        out[lang] = {"window_title": t["window_title"], "close": t["close"], "tabs": [
            {"key": "tasks", "title": t["tab_tasks"], "blocks": tasks},
            {"key": "screen", "title": t["tab_screen"], "blocks": screen},
            {"key": "background", "title": t["tab_background"], "blocks": background},
            {"key": "stocktake", "title": t["tab_stocktake"], "blocks": stocktake}]}
    return out


@router.get("/screen/{screen}")
def screen_help(screen: str, _user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    """All languages at once - the flag switch needs no round trip."""
    if screen in EXTRA_HELP:
        texts = _yarn_stock_help() if screen == "yarn_stock" else _experiment_request_help()
        return {"screen": screen, "langs": list(texts), "texts": texts}
    mod = _module(screen)
    if mod is None:
        raise HTTPException(status_code=404, detail="No help for this screen")
    texts = {lang: {"window_title": t["window_title"], "close": t["close"],
                    "tabs": [{"key": tab["key"], "title": tab["title"],
                              "blocks": [block_json(b) for b in tab["blocks"]]} for tab in t["tabs"]]}
             for lang, t in mod.TEXTS.items()}
    return {"screen": screen, "langs": list(texts), "texts": texts}


def _entry_json(e: hi.HelpEntry) -> Dict[str, Any]:
    return {"q": e.question, "steps": list(e.steps), "note": e.note}


def hit_json(h: hi.SearchHit) -> Dict[str, Any]:
    by_lang = {lang: _entry_json(e) for lang, e in h.by_lang.items()}
    out: Dict[str, Any] = {"key": h.key, "screen": h.screen, "tab": h.tab, "best_lang": h.best_lang,
                           "by_lang": by_lang}
    if h.screen == kb_search.SCREEN:
        target = kb_search.parse_key(h.key)
        module, scene, station = target if target else ("", None, None)
        q = "&".join(x for x in (f"scene={scene}" if scene else "", f"station={station}" if station else "") if x)
        out.update(kb=True, route=f"/knowledge-base/{module}" + (f"?{q}" if q else ""), web_ready=True,
                   summary={lang: kb_search.summary(h.key, lang) for lang in by_lang})
        return out
    route = WEB_ROUTES.get(h.screen, "")
    text = " ".join(h.by_lang[h.best_lang].steps) + h.by_lang[h.best_lang].note
    out.update(kb=False, screen_name=hi.SCREEN_NAMES.get(h.screen, h.screen), route=route,
               web_ready=bool(route) and _web_ready(route), needs_series=h.screen in hi.NEEDS_SERIES,
               has_areas=bool(re.search(r"\(\d\)|\([A-F]\)", text)),
               full_help=_module(h.screen) is not None or h.screen in EXTRA_HELP)
    return out


@router.get("/search")
def search(q: str = "", _user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    q = (q or "").strip()
    hits = hi.search(q, with_kb=True) if q else []
    return {"q": q, "hits": [hit_json(h) for h in hits]}


class LogBody(BaseModel):
    event: str
    detail: str = ""


@router.post("/log")
def log(body: LogBody, _user: Dict[str, Any] = Depends(current_user)) -> Dict[str, Any]:
    """Same help_* usage events as the desktop (Usage Stats -> Help)."""
    if body.event not in LOG_EVENTS:
        raise HTTPException(status_code=400, detail="Unknown event")
    log_usage_event("feature", body.event, (body.detail or "")[:250])
    return {"ok": True}
