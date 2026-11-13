"""label_generator_api.py - Label Generator (/tools/label-generator; desktop ui/screen_label_generator.py) on
ui/label_designer.py (elements, designs, preview, label list) and db/label_sheets.py (sheet template + PDF).

The browser holds the element list (the desktop's JSON) and lets you drag / resize; the server renders the
preview with the same code as the PDF, loads the trial data and writes designs (tblLabelDesign) and the sheet
template "CustomLabel" (tblLabelTemplate) exactly like the desktop. The web never creates tblLabelDesign."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db import label_sheets as ls  # noqa: E402
from db.connection import table_exists  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from ui import label_designer as ld  # noqa: E402
from ui.label_generator_fields import FIELD_REGISTRY  # noqa: E402

ld.ENSURE_TABLE = False
router = APIRouter(prefix="/api/label-generator")
_feature = require_feature("label_generator")
MAX_ELEMENTS = 60


def _err(code: str, detail: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _template() -> Dict[str, Any]:
    t = ls.load_label_template(ld.TEMPLATE_NAME)
    return {k: float(t.get(k) if t.get(k) is not None else ls.DEFAULT_TEMPLATE[k]) for k, _l in ls.TEMPLATE_FIELDS}


def _clean_elements(els: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for el in (els or [])[:MAX_ELEMENTS]:
        if not isinstance(el, dict) or el.get("type") not in ("text", "logo", "table"):
            continue
        el = ld.normalize_element(el)
        for k in ("x_mm", "y_mm", "w_mm", "h_mm", "font_size"):
            if k in el:
                try:
                    el[k] = max(0.0, min(1000.0, float(el[k])))
                except (TypeError, ValueError):
                    el.pop(k, None)
        if el["type"] == "table":
            el["rows"] = max(1, min(50, int(el.get("rows") or 1)))
            el["cols"] = max(1, min(20, int(el.get("cols") or 1)))
            ld.resize_table_cells(el)
        out.append(el)
    return out


@router.get("/meta")
def meta(user: Dict[str, Any] = Depends(_feature)):
    log_usage_event("feature", "label_generator_open", "web")
    return {"designs": ld.list_designs(), "designs_available": table_exists(ld.DESIGN_TABLE),
            "template": _template(), "template_fields": [{"key": k, "label": lab} for k, lab in ls.TEMPLATE_FIELDS],
            "fields": FIELD_REGISTRY, "px_per_mm": ld.PX_PER_MM}


@router.get("/series/{series_id}")
def series(series_id: int, user: Dict[str, Any] = Depends(_feature)):
    ctx = ld.series_context(series_id)
    return {"header": ctx["header"], "trials": ctx["trials"], "fields": ctx["fields"]}


@router.get("/series/{series_id}/trial/{trial_nr}")
def trial(series_id: int, trial_nr: int, user: Dict[str, Any] = Depends(_feature)):
    ctx = ld.series_context(series_id)
    if not ctx["header"] or trial_nr not in ctx["trials"]:
        return _err("not_found", "Trial not found.", 404)
    return {"values": ld.trial_values(ctx, trial_nr)}


class PreviewBody(BaseModel):
    elements: List[Dict[str, Any]] = []
    w_mm: float = 60.0
    h_mm: float = 30.0
    values: Optional[Dict[str, Any]] = None
    fields: Dict[str, str] = {}
    scale: float = ld.PX_PER_MM


@router.post("/preview")
def preview(body: PreviewBody, user: Dict[str, Any] = Depends(_feature)):
    w, h = max(5.0, min(500.0, body.w_mm)), max(5.0, min(500.0, body.h_mm))
    png = ld.preview_png(_clean_elements(body.elements), w, h,
                         ld.preview_item(body.values, body.fields or FIELD_REGISTRY), max(2.0, min(16.0, body.scale)))
    return Response(png, media_type="image/png", headers={"Cache-Control": "no-store"})


class SizeBody(BaseModel):
    w_mm: float
    h_mm: float


@router.post("/label-size")
def label_size(body: SizeBody, user: Dict[str, Any] = Depends(_feature)):
    """Like the desktop: the label size is stored in the "CustomLabel" sheet template right away."""
    tpl = _template()
    tpl["LabelWidthMm"] = max(5.0, min(500.0, body.w_mm))
    tpl["LabelHeightMm"] = max(5.0, min(500.0, body.h_mm))
    ls.save_label_template(ld.TEMPLATE_NAME, tpl)
    return {"template": _template()}


@router.get("/designs/{name}")
def design(name: str, user: Dict[str, Any] = Depends(_feature)):
    els = ld.load_design(name)
    if els is None:
        return _err("not_found", "Design not found.", 404)
    return {"name": name, "elements": [ld.new_element(e.get("type") or "text", i, e) for i, e in enumerate(els)]}


class DesignBody(BaseModel):
    name: str
    elements: List[Dict[str, Any]]


@router.post("/designs")
def save_design(body: DesignBody, user: Dict[str, Any] = Depends(_feature)):
    if not table_exists(ld.DESIGN_TABLE):
        return _err("unavailable", "Saving designs is not available in this database.")
    name = (body.name or "").strip()[:120]
    if not name:
        return _err("no_name", "Please enter a name.")
    ld.save_design(name, _clean_elements(body.elements))
    log_usage_event("feature", "label_generator_save_design", "web")
    return {"designs": ld.list_designs(), "name": name}


class PdfBody(BaseModel):
    elements: List[Dict[str, Any]]
    mode: str = "copies"            # copies | range
    copies: int = 1
    series_id: Optional[int] = None
    trial_nr: Optional[int] = None  # the loaded trial (mode copies)
    frm: int = 0
    to: int = 0
    template: Dict[str, float] = {}
    start_index: int = 0
    save_template: bool = False


@router.post("/pdf")
def pdf(body: PdfBody, user: Dict[str, Any] = Depends(_feature)):
    els = _clean_elements(body.elements)
    ctx = ld.series_context(body.series_id) if body.series_id else None
    loaded = None
    if ctx and ctx["header"] and body.trial_nr is not None and body.trial_nr in ctx["trials"]:
        loaded = ld.trial_values(ctx, body.trial_nr)
    items, err = ld.build_items(els, "range" if body.mode == "range" else "copies", body.copies, ctx, loaded, body.frm, body.to)
    if err:
        return _err(err, "No labels to print.")
    tpl = _template()
    for k, _l in ls.TEMPLATE_FIELDS:
        if k in body.template:
            try:
                tpl[k] = float(body.template[k])
            except (TypeError, ValueError):
                return _err("bad_template", "Invalid sheet value.")
    if tpl["ColumnCount"] < 1 or tpl["RowCount"] < 1 or tpl["LabelWidthMm"] <= 0 or tpl["LabelHeightMm"] <= 0:
        return _err("bad_template", "Invalid sheet value.")
    tpl["ColumnCount"], tpl["RowCount"] = int(tpl["ColumnCount"]), int(tpl["RowCount"])
    if body.save_template:
        ls.save_label_template(ld.TEMPLATE_NAME, tpl)
    start = max(0, min(int(body.start_index), tpl["ColumnCount"] * tpl["RowCount"] - 1))
    data = ls.label_sheet_pdf_bytes(items, tpl, start, draw_cell=ld.make_draw_cell(els))
    log_usage_event("feature", "label_generator_pdf", f"web {len(items)}")
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": 'attachment; filename="labels.pdf"'})
