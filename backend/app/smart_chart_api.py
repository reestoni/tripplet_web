"""smart_chart_api.py - Smart Chart (/tools/smart-chart) and Dashboards (/tools/dashboards) in the browser.

The dashboard surface is the desktop page itself (ui/smart_dashboard_html.py, Nutzerentscheid 2026-11-13:
embed, not rebuild); only its transport is swapped: qwebchannel.js -> /report-assets/smart_bridge.js, which
sends the bridge calls to POST /api/smart/{sid}/call and runs the answer ("commands" = page functions).
State and answers: ui/smart_dashboard_core.DashboardSession (the desktop widget uses the same class);
computing: ui/smart_dashboard_engine.py; saved views: db/smart_chart_views.py.

Server state per open page = a session (sid made by the browser, bound to the user): its own TrialDataset
(calculated fields are per dashboard) over trials loaded once per process; field values are shared by all
sessions (the per-dashboard calculated fields stay in the session). Reload = load the trials again.
The React page around it does the Qt dialogs of the desktop (filters, calculated fields, colours, fairness,
views, sharing) on the endpoints below."""
from __future__ import annotations

import datetime
import io
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse, Response
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import can_use, current_user

from db import smart_chart_views as views  # noqa: E402
from db import trial_explorer as te  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from ui import smart_dashboard_core as sc  # noqa: E402
from ui import smart_dashboard_engine as en  # noqa: E402

router = APIRouter(prefix="/api/smart")

MAX_SESSIONS = 40
IDLE_SECONDS = 6 * 3600


def _err(status: int, code: str, detail: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, **extra})


# ------------------------------------------------------------------ trials, loaded once per process
class _Base:
    """The trials once per process - without reference samples, and (when a dashboard asks) with them."""

    def __init__(self, refs: bool, catalog: Optional[List[te.Field]] = None) -> None:
        self.refs = refs
        self.catalog = catalog if catalog is not None else te.build_catalog()
        self.trials = te._load_trials(include_refs=refs)
        self.values: Dict[str, Dict[int, Any]] = {}     # field values shared by the sessions
        self.loaded = datetime.datetime.now()


_bases: Dict[bool, _Base] = {}
_base_lock = threading.Lock()


def _get_base(refs: bool = False, force: bool = False) -> _Base:
    with _base_lock:
        if force:
            _bases.clear()          # Reload: new catalog, the other variant is loaded again when needed
        if refs not in _bases:
            other = _bases.get(not refs)
            _bases[refs] = _Base(refs, other.catalog if other else None)   # same catalog = no new page init
        return _bases[refs]


class _SharedCache(dict):
    """TrialDataset._cache: calculated fields (calc_…) stay in the session, everything else is shared."""

    def __init__(self, shared: Dict[str, Any]):
        super().__init__()
        self.shared = shared

    def _local(self, key) -> bool:
        return str(key).startswith("calc_")

    def __contains__(self, key):
        return super().__contains__(key) if self._local(key) else key in self.shared

    def __getitem__(self, key):
        return super().__getitem__(key) if self._local(key) else self.shared[key]

    def __setitem__(self, key, value):
        if self._local(key):
            super().__setitem__(key, value)
        else:
            self.shared[key] = value

    def pop(self, key, *default):
        return super().pop(key, *default) if self._local(key) else (default[0] if default else None)


def _dataset(base: _Base) -> te.TrialDataset:
    ds = te.TrialDataset(base.catalog, trials=base.trials, include_refs=base.refs)
    ds._cache = _SharedCache(base.values)
    return ds


# ------------------------------------------------------------------ sessions
class Host:
    """What DashboardSession needs from its screen (desktop: SmartChartScreen / DashboardsScreen)."""

    def __init__(self, username: str, read_only: bool):
        self.username = username
        self.read_only = read_only
        self.base = _get_base()
        self.ds = _dataset(self.base)
        self.catalog = self.base.catalog
        self.filters: List[Dict[str, Any]] = []
        self.ply_scope = "any"
        self.session = sc.DashboardSession(self, read_only)
        self.view: Optional[Dict[str, Any]] = None
        self.pdf_job: Optional[Dict[str, Any]] = None
        self.files: Dict[str, Any] = {}
        self.used = time.time()
        self.lock = threading.RLock()
        self.saved_sig = ""          # the dashboard as opened / saved - anything else is unsaved
        self.folder = ""

    @property
    def include_refs(self) -> bool:
        return self.base.refs

    def reload(self, force: bool, refs: Optional[bool] = None) -> None:
        self.base = _get_base(self.base.refs if refs is None else bool(refs), force)
        self.ds = _dataset(self.base)
        self.catalog = self.base.catalog
        known = set(self.ds.fields)
        self.filters = [f for f in self.filters if f.get("key") in known]

    def config(self) -> Dict[str, Any]:
        return sc.view_settings(self.filters, self.ply_scope, self.session.spec, self.include_refs, self.folder)

    def _sig(self) -> str:
        import json
        cfg = self.config()
        cfg.pop("folder", None)
        cfg["dashboard"] = {k: v for k, v in (cfg.get("dashboard") or {}).items() if k != "active"}  # page tab
        return json.dumps(cfg, sort_keys=True, default=str)

    def mark_saved(self) -> None:
        self.saved_sig = self._sig()

    def summary(self) -> Dict[str, Any]:
        res = self.ds.apply(self.filters, self.ply_scope)
        s = self.ds.summary(res)
        return {**s, "filters": en.describe_filters(self.ds, list(self.filters)), "ply_scope": self.ply_scope,
                "refs": self.include_refs, "dirty": not self.read_only and self._sig() != self.saved_sig,
                "pages": len(self.session.spec.get("pages") or []), "visuals": len(en.active_page(self.session.spec)["visuals"])}


_sessions: Dict[str, Host] = {}
_sessions_lock = threading.Lock()


def _username(user: Dict[str, Any]) -> str:
    return str(user.get("username") or "")


def _host(sid: str, user: Dict[str, Any]) -> Host:
    h = _sessions.get(sid)
    if h is None or h.username != _username(user):
        raise HTTPException(status_code=404, detail="This dashboard is no longer open - please reload the page.")
    h.used = time.time()
    return h


def _edit_host(sid: str, user: Dict[str, Any]) -> Host:
    h = _host(sid, user)
    if h.read_only:
        raise HTTPException(status_code=403, detail="This dashboard is open read-only.")
    return h


def _check(user: Dict[str, Any], read_only: bool) -> None:
    if not (can_use(user, "smart_chart") or (read_only and can_use(user, "dashboards"))):
        raise HTTPException(status_code=403, detail="You are not allowed to use this.")


def _cmds(cmds) -> List[List[Any]]:
    return [[name, arg] for name, arg in cmds or []]


def _answer(h: Host, cmds, **extra) -> Dict[str, Any]:
    return {"cmds": _cmds(cmds), "summary": h.summary(), **extra}


def _view_info(v: Optional[Dict[str, Any]], favs: Optional[set] = None) -> Optional[Dict[str, Any]]:
    if not v:
        return None
    when = v.get("UpdatedAt") or v.get("CreatedAt")
    cfg = views.config_of(v)
    return {"id": int(v["ID"]), "name": str(v.get("Name") or ""), "owner": v.get("OwnerName") or "",
            "folder": sc.view_folder(cfg), "favourite": int(v["ID"]) in (favs or set()),
            "right": v.get("MyRight"), "shared": bool(int(v.get("IsShared") or 0)),
            "when": when.strftime("%Y-%m-%d") if hasattr(when, "strftime") else "",
            "kind": sc.view_kind(cfg), "dashboard": cfg.get("mode") == "dashboard",
            "can_change": views.can_change(v), "can_delete": views.can_delete(v), "can_share": views.can_share(v)}


# ------------------------------------------------------------------ the page
_QT_SCRIPT = '<script src="qrc:///qtwebchannel/qwebchannel.js"></script>'
_PLOTLY_SCRIPT = '<script src="plotly-2.32.0.min.js"></script>'


@router.get("/page", response_class=HTMLResponse)     # under /api: the Vite dev proxy forwards it
def dashboard_page(user: Dict[str, Any] = Depends(current_user)) -> HTMLResponse:
    from ui.smart_dashboard_html import DASHBOARD_HTML
    html = DASHBOARD_HTML
    if _QT_SCRIPT not in html or _PLOTLY_SCRIPT not in html:
        raise RuntimeError("dashboard page changed - update app/smart_chart_api.py")
    html = html.replace(_PLOTLY_SCRIPT, '<script src="/report-assets/plotly-2.32.0.min.js"></script>')
    html = html.replace(_QT_SCRIPT, '<script src="/report-assets/smart_bridge.js"></script>')
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})


# ------------------------------------------------------------------ open / new / reload
class OpenBody(BaseModel):
    sid: str
    read_only: bool = False
    view_id: Optional[int] = None
    template: Optional[str] = None      # "" = empty page, None = example page, else a template key


@router.post("/open")
def open_session(body: OpenBody, user: Dict[str, Any] = Depends(current_user)):
    _check(user, body.read_only)
    if not body.sid or len(body.sid) > 64:
        raise HTTPException(status_code=400, detail="bad session id")
    with _sessions_lock:
        old = sorted(_sessions.items(), key=lambda kv: kv[1].used)
        for k, h in old:
            if time.time() - h.used > IDLE_SECONDS or len(_sessions) >= MAX_SESSIONS:
                _sessions.pop(k, None)
        h = Host(_username(user), body.read_only)
        _sessions[body.sid] = h
    h.user_id = user.get("id")
    missing: List[str] = []
    if body.view_id is not None:
        v = views.get_view(int(body.view_id))
        if v is None:
            return _err(404, "view_gone", "This view no longer exists or is no longer shared with you.")
        missing = _apply_view(h, v)
        log_usage_event("feature", "dashboards_view" if body.read_only else "smart_chart_view_open",
                        ("own" if v.get("MyRight") == views.RIGHT_OWNER else "shared") if body.read_only else "")
    else:
        h.session.start_from(body.template if body.template is not None else None)
        h.mark_saved()
        if not body.read_only:
            log_usage_event("feature", "smart_dashboard_open", "web")
    return {"summary": h.summary(), "view": _view_info(h.view), "missing": missing, "user": _username(user)}


def _apply_config(h: Host, cfg: Dict[str, Any]) -> List[str]:
    if sc.view_refs(cfg) != h.include_refs:
        h.reload(False, sc.view_refs(cfg))
    h.filters, h.ply_scope, spec, missing = sc.read_view_settings(cfg, set(h.ds.fields))
    h.folder = sc.view_folder(cfg)
    h.session.set_spec(spec)
    return missing


def _apply_view(h: Host, v: Dict[str, Any]) -> List[str]:
    missing = _apply_config(h, views.config_of(v))
    h.view = v
    h.mark_saved()
    return missing


class NewBody(BaseModel):
    template: Optional[str] = None


@router.post("/{sid}/new")
def new_dashboard(sid: str, body: NewBody, user: Dict[str, Any] = Depends(current_user)):
    """New dashboard: empty, example or template (the filters on all pages stay - they belong to Find trials)."""
    h = _edit_host(sid, user)
    if body.template and body.template not in en.TEMPLATES:
        return _err(400, "bad_template", "Unknown template.")
    with h.lock:
        h.view = None
        h.folder = ""
        h.session.start_from(body.template if body.template is not None else None)
        h.mark_saved()
        return _answer(h, h.session.init_cmds(), view=None)


@router.get("/templates")
def templates(user: Dict[str, Any] = Depends(current_user)):
    return {"templates": [{"key": k, "label": t["label"], "tip": t["tip"]} for k, t in en.TEMPLATES.items()]}


@router.post("/{sid}/reload")
def reload(sid: str, user: Dict[str, Any] = Depends(current_user)):
    h = _host(sid, user)
    with h.lock:
        h.reload(force=True)
        h.session.clear_results()
        return _answer(h, h.session.refresh_cmds())


@router.get("/{sid}/state")
def state(sid: str, user: Dict[str, Any] = Depends(current_user)):
    h = _host(sid, user)
    return {"summary": h.summary(), "view": _view_info(h.view)}


@router.get("/{sid}/config")
def config(sid: str, user: Dict[str, Any] = Depends(current_user)):
    """What a saved view would store - the browser keeps it as a draft while it is unsaved."""
    h = _edit_host(sid, user)
    with h.lock:
        return {"config": h.config(), "view_id": int(h.view["ID"]) if h.view else None,
                "view_name": str((h.view or {}).get("Name") or ""), "dirty": h.summary()["dirty"]}


class RestoreBody(BaseModel):
    config: Dict[str, Any]
    view_id: Optional[int] = None


@router.post("/{sid}/restore")
def restore(sid: str, body: RestoreBody, user: Dict[str, Any] = Depends(current_user)):
    """Bring back an unsaved draft (after a reload / a server restart). With view_id it continues that view."""
    h = _edit_host(sid, user)
    with h.lock:
        v = views.get_view(int(body.view_id)) if body.view_id else None
        if v is not None:
            _apply_view(h, v)          # saved state first (for "unsaved" afterwards)
        else:
            h.view = None
        missing = _apply_config(h, body.config if isinstance(body.config, dict) else {})
        if v is None:
            h.saved_sig = ""
        log_usage_event("feature", "smart_dashboard_draft_restore", "view" if v else "new")
        return _answer(h, h.session.init_cmds(), view=_view_info(h.view), missing=missing)


# ------------------------------------------------------------------ the page's bridge
class CallBody(BaseModel):
    method: str
    args: List[Any] = []


@router.post("/{sid}/call")
def call(sid: str, body: CallBody, user: Dict[str, Any] = Depends(current_user)):
    """A call of the dashboard page (bridge.xxx) -> commands for the page."""
    h = _host(sid, user)
    s, a, m = h.session, body.args, body.method

    def arg(i, default=None):
        return a[i] if len(a) > i else default

    with h.lock:
        if m == "ready":
            return _answer(h, s.init_cmds(arg(0) or {}, arg(1) or {}))
        if m == "updateSpec":
            if h.read_only:      # read-only: page tabs / slicers change the spec, nothing is saved
                pass
            return _answer(h, s.refresh_cmds() if s.update_spec(arg(0)) else [])
        if m == "visualClick":
            return _answer(h, s.refresh_cmds() if s.click(str(arg(0)), arg(1)) else [])
        if m == "clearCross":
            s.clear(str(arg(0)))
            return _answer(h, s.refresh_cmds())
        if m == "visualSelect":
            s.select(str(arg(0)), arg(1))
            return _answer(h, s.refresh_cmds())
        if m == "drillThrough":
            return _answer(h, s.drill_through(str(arg(0)), arg(1), str(arg(2))))
        if m == "drillBack":
            return _answer(h, s.drill_back(bool(arg(0))))
        if m == "modelFields":
            return _answer(h, s.model_fields(str(arg(0))))
        if m == "focusRows":
            return _answer(h, s.focus_rows(str(arg(0))))
        if m == "removeFilter":
            if s.remove_filter(str(arg(0)), str(arg(1) or ""), int(arg(2, -1))):
                return _answer(h, s.refresh_cmds() if arg(0) == "all" else s.spec_cmds())
            return _answer(h, [])
        if m == "setIncludeRefs":
            if not h.read_only and bool(arg(0)) != h.include_refs:
                h.reload(False, bool(arg(0)))
                log_usage_event("feature", "smart_dashboard_refs", "on" if arg(0) else "off")
            return _answer(h, s.refresh_cmds())
        if m == "setPlyScope":
            if not h.read_only and arg(0) in te.PLY_SCOPES:
                h.ply_scope = arg(0)
            return _answer(h, s.refresh_cmds())
        if m == "imagesReady":
            job, h.pdf_job = h.pdf_job, None
            if job is None:
                return _answer(h, [])
            buf = io.BytesIO()
            s.write_pdf_job(buf, job, arg(0) or "{}")
            token = uuid.uuid4().hex
            h.files = {token: (job["filename"], buf.getvalue(), "application/pdf")}
            return _answer(h, [], download=f"/api/smart/{sid}/file/{token}")
    return _err(400, "bad_call", f"Unknown call {m}.")


# ------------------------------------------------------------------ filters (desktop AddFilterDialog)
class FilterRef(BaseModel):
    scope: str
    vid: str = ""
    index: int = -1


def _filter_ctx(h: Host, ref: FilterRef):
    if ref.scope not in sc.FILTER_SCOPES:
        raise HTTPException(status_code=400, detail="bad scope")
    others, edit = h.session.filter_context(ref.scope, ref.vid, ref.index)
    if others is None:
        raise HTTPException(status_code=404, detail="This visual no longer exists.")
    return others, edit


@router.post("/{sid}/filter/fields")
def filter_fields(sid: str, ref: FilterRef, user: Dict[str, Any] = Depends(current_user)):
    """The field tree of the editor (and the edited filter)."""
    h = _edit_host(sid, user)
    with h.lock:
        _others, edit = _filter_ctx(h, ref)
        cat = h.session.catalog()
        return {"tree": [[top, subs] for top, subs in te.group_tree(cat)],
                "fields": [{"key": f.key, "label": f.label, "group": f.group} for f in cat],
                "edit": edit, "ply_scope": h.ply_scope}


class FieldBody(FilterRef):
    key: str
    lo: Optional[float] = None
    hi: Optional[float] = None


@router.post("/{sid}/filter/field")
def filter_field(sid: str, body: FieldBody, user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    with h.lock:
        others, _edit = _filter_ctx(h, body)
        if body.key not in h.ds.fields:
            return _err(404, "unknown_field", "This field does not exist (any more).")
        return sc.field_overview(h.ds, body.key, others, h.ply_scope)


@router.post("/{sid}/filter/values")
def filter_values(sid: str, body: FieldBody, user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    with h.lock:
        others, _edit = _filter_ctx(h, body)
        if body.key not in h.ds.fields:
            return _err(404, "unknown_field", "This field does not exist (any more).")
        return {"values": sc.number_values(h.ds, body.key, others, h.ply_scope, body.lo, body.hi)}


class FilterBody(FilterRef):
    key: str
    raw: Dict[str, Any] = {}


def _made(h: Host, body: FilterBody):
    f = h.ds.fields.get(body.key)
    if f is None:
        raise HTTPException(status_code=404, detail="unknown field")
    return sc.make_filter(f, body.raw)


@router.post("/{sid}/filter/hits")
def filter_hits(sid: str, body: FilterBody, user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    with h.lock:
        others, _edit = _filter_ctx(h, body)
        return sc.filter_hits(h.ds, others, _made(h, body), h.ply_scope)


@router.post("/{sid}/filter/put")
def filter_put(sid: str, body: FilterBody, user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    with h.lock:
        _others, edit = _filter_ctx(h, body)
        flt = _made(h, body)
        if flt is None:
            return _err(400, "empty_filter", "Tick at least one value.")
        if not h.session.put_filter(body.scope, body.vid, body.index if edit is not None else -1, flt):
            return _err(400, "not_saved", "The filter could not be set.")
        return _answer(h, h.session.refresh_cmds() if body.scope == "all" else h.session.spec_cmds())


# ------------------------------------------------------------------ calculated fields (desktop CalcFieldDialog)
@router.get("/{sid}/calc")
def calc_get(sid: str, key: str = "", user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    with h.lock:
        s = h.session
        s.apply_calc()
        existing = s.calc_def(key)
        k = key if existing else s.next_calc_key()
        from db import formula as fm
        library = [] if existing else sc.calc_library(h.ds, views.list_views() if views.available() else [],
                                                       s.spec.get("calc") or [])
        return {"key": k, "exists": existing is not None, "name": (existing or {}).get("name") or "",
                "unit": (existing or {}).get("unit") or "",
                "formula": fm.to_display((existing or {}).get("formula") or "", h.ds.fields),
                "fields": sc.calc_fields_for(h.ds, k), "library": library}


class CalcBody(BaseModel):
    key: str
    name: str = ""
    unit: str = ""
    text: str = ""


@router.post("/{sid}/calc/preview")
def calc_preview(sid: str, body: CalcBody, user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    with h.lock:
        return sc.calc_preview(h.ds, body.text, body.key, h.filters, h.ply_scope)


@router.post("/{sid}/calc/save")
def calc_save(sid: str, body: CalcBody, user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    if not body.key.startswith("calc_"):
        return _err(400, "bad_key", "bad key")
    from db import formula as fm
    with h.lock:
        try:
            d = sc.calc_definition(h.ds, body.key, body.name, body.unit, body.text)
        except fm.FormulaError as e:
            return _err(400, "formula", str(e))
        except ValueError:
            return _err(400, "no_name", "Please enter a name.")
        h.session.save_calc(body.key, d)
        return _answer(h, h.session.init_cmds())


@router.post("/{sid}/calc/delete")
def calc_delete(sid: str, body: CalcBody, user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    with h.lock:
        h.session.save_calc(body.key, None)
        return _answer(h, h.session.init_cmds())


# ------------------------------------------------------------------ colour, fairness, trial, Excel, PDF
class ColourBody(BaseModel):
    vid: str
    label: str = ""
    colour: str


@router.post("/{sid}/colour")
def colour(sid: str, body: ColourBody, user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    import re
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", body.colour or ""):
        return _err(400, "bad_colour", "Colour expected (#RRGGBB).")
    with h.lock:
        return _answer(h, h.session.spec_cmds() if h.session.set_colour(body.vid, body.label, body.colour) else [])


@router.get("/{sid}/fair/{vid}")
def fair(sid: str, vid: str, user: Dict[str, Any] = Depends(current_user)):
    h = _host(sid, user)
    with h.lock:
        return {"fair": sc.fairness_json(h.session.fairness(vid)), "read_only": h.read_only}


@router.post("/{sid}/fair/{vid}/fix")
def fair_fix(sid: str, vid: str, user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    with h.lock:
        return _answer(h, h.session.spec_cmds() if h.session.apply_fair_fix(vid) else [])


@router.get("/{sid}/trial/{tid}")
def trial(sid: str, tid: int, user: Dict[str, Any] = Depends(current_user)):
    h = _host(sid, user)
    t = h.session.trial_target(tid)
    if t is None:
        return _err(404, "no_trial", "This trial has no experiment.")
    return t


def _stamp() -> str:
    return datetime.date.today().strftime("%Y%m%d")


@router.get("/{sid}/excel")
def excel(sid: str, vid: str = Query(""), user: Dict[str, Any] = Depends(current_user)):
    """Excel of one visual (vid) or of every visual of the active page."""
    h = _host(sid, user)
    if h.read_only:
        raise HTTPException(status_code=403, detail="No Excel export on the Dashboards page.")
    with h.lock:
        page = en.active_page(h.session.spec)
        vs = [v for v in page["visuals"] if not vid or v.get("id") == vid]
        if not vs:
            return _err(400, "no_visuals", "This page has no visuals.")
        buf = io.BytesIO()
        h.session.write_excel(buf, vs)
    log_usage_event("feature", "smart_dashboard_excel", "visual" if vid else "page")
    name = f"SmartChart_{'visual' if vid else 'dashboard'}_{_stamp()}.xlsx"
    return Response(buf.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


class PdfBody(BaseModel):
    all_pages: bool = False
    title: str = ""


@router.post("/{sid}/pdf")
def pdf(sid: str, body: PdfBody, user: Dict[str, Any] = Depends(current_user)):
    """Step 1: the page renders the chart images (exportImages) and sends them back (call imagesReady)."""
    h = _host(sid, user)
    with h.lock:
        job, jobs = h.session.pdf_job(body.all_pages, body.title)
        safe = "".join(ch if ch.isalnum() or ch in "-_ " else "_" for ch in (body.title or "SmartChart_dashboard"))
        h.pdf_job = {**job, "filename": f"{safe.strip() or 'Dashboard'}_{_stamp()}.pdf"}
        return _answer(h, [("exportImages", jobs)])


@router.get("/{sid}/file/{token}")
def file(sid: str, token: str, user: Dict[str, Any] = Depends(current_user)):
    h = _host(sid, user)
    f = h.files.pop(token, None)
    if f is None:
        raise HTTPException(status_code=404, detail="File no longer available.")
    name, data, mime = f
    return Response(data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ------------------------------------------------------------------ saved views
@router.get("/views")
def list_views(kind: str = Query(""), user: Dict[str, Any] = Depends(current_user)):
    if not views.available():
        return {"available": False, "views": [], "smart_chart": can_use(user, "smart_chart")}
    from db.display_settings import smart_favourites
    rows = views.list_views(kind="dashboard" if kind == "dashboard" else None)
    favs = set(smart_favourites(user.get("id")))
    return {"available": True, "shares": views.shares_available(), "views": [_view_info(v, favs) for v in rows],
            "folders": sc.folders_of(views.list_views()), "smart_chart": can_use(user, "smart_chart")}


@router.post("/views/{view_id}/favourite")
def favourite(view_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Star / unstar a view (stored with the user's display settings, same as the desktop)."""
    if views.get_view(view_id) is None:
        return _err(404, "view_gone", "This view no longer exists or is no longer shared with you.")
    from db.display_settings import toggle_smart_favourite
    on = toggle_smart_favourite(user.get("id"), view_id)
    if on is None:
        return _err(400, "not_saved", "The favourite could not be saved.")
    return {"favourite": on}


class OpenViewBody(BaseModel):
    id: int


@router.post("/{sid}/view/open")
def view_open(sid: str, body: OpenViewBody, user: Dict[str, Any] = Depends(current_user)):
    h = _host(sid, user)
    v = views.get_view(int(body.id))
    if v is None:
        return _err(404, "view_gone", "This view no longer exists or is no longer shared with you.")
    with h.lock:
        missing = _apply_view(h, v)
        log_usage_event("feature", "dashboards_view" if h.read_only else "smart_chart_view_open",
                        ("own" if v.get("MyRight") == views.RIGHT_OWNER else "shared") if h.read_only else "")
        return _answer(h, h.session.init_cmds(), view=_view_info(v), missing=missing)


class SaveViewBody(BaseModel):
    name: str
    shared: bool = False
    as_new: bool = True
    folder: str = ""


@router.post("/{sid}/view/save")
def view_save(sid: str, body: SaveViewBody, user: Dict[str, Any] = Depends(current_user)):
    h = _edit_host(sid, user)
    name = (body.name or "").strip()
    if not name:
        return _err(400, "no_name", "Please enter a name.")
    if not views.available():
        return _err(400, "unavailable", "Saved views are not available in this database yet.")
    with h.lock:
        cur = h.view
        overwrite = not body.as_new and cur is not None and views.can_change(cur)
        shared: Optional[bool] = body.shared
        if overwrite and not views.is_owner(cur):
            shared = None              # edit share: the creator's sharing stays
        elif not overwrite and cur is not None and not views.is_owner(cur):
            shared = body.shared
        h.folder = (body.folder or "").strip()[:60]
        try:
            vid = views.save_view(name, h.config(), shared, view_id=int(cur["ID"]) if overwrite else None)
        except ValueError as e:
            return _err(400, "too_big", str(e))
        h.view = views.get_view(vid)
        h.mark_saved()
    log_usage_event("feature", "smart_chart_view_save",
                    "shared" if shared else "private" if shared is not None else "edit share")
    return {"view": _view_info(h.view)}


@router.delete("/views/{view_id}")
def view_delete(view_id: int, user: Dict[str, Any] = Depends(current_user)):
    v = views.get_view(view_id)
    if v is None or not views.can_delete(v):
        return _err(403, "not_allowed", "You cannot delete this view.")
    views.delete_view(view_id)
    for h in list(_sessions.values()):
        if h.view and int(h.view["ID"]) == int(view_id):
            h.view = None
    return {"ok": True}


@router.get("/views/{view_id}/share")
def share_get(view_id: int, user: Dict[str, Any] = Depends(current_user)):
    v = views.get_view(view_id)
    if v is None or not views.can_share(v):
        return _err(403, "not_owner", "Only the person who created this view can share it.")
    if not views.shares_available():
        return _err(400, "no_shares", "Sharing with single people and groups is not available in this database yet.")
    t = views.share_targets()
    return {"everybody": bool(int(v.get("IsShared") or 0)),
            "entries": [{"user_id": s.get("UserID"), "group_id": s.get("AccessRightID"),
                         "can_edit": bool(int(s.get("CanEdit") or 0)), "name": s.get("Name") or "?"}
                        for s in views.get_shares(view_id)],
            "people": [{"id": int(p["ID"]), "name": p["Name"]} for p in t.get("people") or []],
            "groups": [{"id": int(g["ID"]), "name": g["Name"]} for g in t.get("groups") or []]}


class ShareEntry(BaseModel):
    user_id: Optional[int] = None
    group_id: Optional[int] = None
    can_edit: bool = False


class ShareBody(BaseModel):
    everybody: bool = False
    entries: List[ShareEntry] = []


@router.post("/views/{view_id}/share")
def share_set(view_id: int, body: ShareBody, user: Dict[str, Any] = Depends(current_user)):
    v = views.get_view(view_id)
    if v is None or not views.can_share(v):
        return _err(403, "not_owner", "Only the person who created this view can share it.")
    t = views.share_targets()
    people = {int(p["ID"]) for p in t.get("people") or []}
    groups = {int(g["ID"]) for g in t.get("groups") or []}
    entries = []
    for e in body.entries:
        if (e.user_id is None) == (e.group_id is None):
            continue
        if (e.user_id is not None and e.user_id not in people) or (e.group_id is not None and e.group_id not in groups):
            return _err(400, "bad_target", "Unknown person or group.")
        entries.append({"UserID": e.user_id, "AccessRightID": e.group_id, "CanEdit": e.can_edit})
    views.set_shares(view_id, body.everybody, entries)
    log_usage_event("feature", "smart_chart_share", f"{len(entries)} entries" + (" + all" if body.everybody else ""))
    for h in list(_sessions.values()):
        if h.view and int(h.view["ID"]) == int(view_id):
            h.view = views.get_view(view_id)
    return {"ok": True}
