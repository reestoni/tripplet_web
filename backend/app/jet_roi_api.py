"""jet_roi_api.py - Jet ROI Calculator (/tools/jet-roi; desktop ui/screen_nozzle_calculator.py) on ui/jet_roi.py.

Single jet: competitor vs Heberlein (jet from tbljets or entered by hand); multi: several comparisons Jet A vs
Jet B. The browser sends the form (pressures as value + "bar"/"PSI"), the server validates, computes and makes
the PDF reports exactly like the desktop. Only reads tbljets (db/jets_admin.load_jets)."""
from __future__ import annotations

import datetime
import io
import math
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db import jets_admin  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from ui import jet_roi as jr  # noqa: E402

router = APIRouter(prefix="/api/jet-roi")
_feature = require_feature("jet_roi")


def _err(code: str, detail: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _jets() -> Dict[Any, Dict[str, Any]]:
    out = {}
    for r in jets_admin.load_jets():
        d = dict(r)
        d["_diam"] = jr.jet_diameter(r)
        out[r.get("ID")] = d
    return out


def _clean(v: Any) -> Any:
    """inf / nan -> None for JSON."""
    if isinstance(v, float) and (math.isinf(v) or math.isnan(v)):
        return None
    if isinstance(v, dict):
        return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_clean(x) for x in v]
    return v


@router.get("/meta")
def meta(user: Dict[str, Any] = Depends(_feature)):
    rows = jets_admin.load_jets()
    return {"currencies": [{"code": c, "sym": s} for c, s in jr.CURRENCIES], "default_cost": jr.DEFAULT_COST,
            "default_price": jr.DEFAULT_NOZZLE_PRICE, "psi_per_bar": jr.PSI_PER_BAR, "processes": list(jr.PROCESSES),
            "jets": {p: jr.jet_options(rows, p) for p in jr.PROCESSES}}


class Pressure(BaseModel):
    value: str = "4"
    unit: str = "bar"


def _bar(p: Pressure) -> Optional[float]:
    try:
        return jr.bar_g_from_input(float(str(p.value).replace(",", ".")), "PSI" if p.unit == "PSI" else "bar")
    except (TypeError, ValueError):
        return None


class SingleBody(BaseModel):
    process: str = "DTY"
    positions: str = "1"
    hours: str = "8000"
    currency: str = "CHF"
    cost_m3: str = "0.04"
    nozzle_px: str = "100"
    comp_type: str = ""
    comp_diam: str = "1.0"
    comp_holes: str = "1"
    comp_pressure: Pressure = Pressure()
    heb_mode: str = "product"
    heb_jet_id: Optional[int] = None
    heb_holes: str = "1"
    heb_type: str = ""
    heb_diam: str = ""
    heb_pressure: Pressure = Pressure()


def _single_inputs(b: SingleBody) -> Dict[str, Any]:
    jet = _jets().get(b.heb_jet_id) if b.heb_mode == "product" and b.heb_jet_id is not None else None
    if jet is not None and not jr.jet_matches_process(jet, b.process):
        jet = None
    sym = dict(jr.CURRENCIES).get(b.currency, b.currency)
    return {"process": b.process, "positions": b.positions, "hours": b.hours, "cost_m3": b.cost_m3,
            "nozzle_px": b.nozzle_px, "sym": sym, "comp_pressure": _bar(b.comp_pressure),
            "comp_p_unit": "PSI" if b.comp_pressure.unit == "PSI" else "bar", "comp_type": b.comp_type,
            "comp_diam": b.comp_diam, "comp_holes": b.comp_holes, "heb_pressure": _bar(b.heb_pressure),
            "heb_p_unit": "PSI" if b.heb_pressure.unit == "PSI" else "bar", "heb_mode": b.heb_mode, "heb_jet": jet,
            "heb_holes": b.heb_holes, "heb_type": (jet or {}).get("Jet") if jet else b.heb_type,
            "heb_diam": b.heb_diam}


@router.post("/single")
def single(body: SingleBody, user: Dict[str, Any] = Depends(_feature)):
    inp = _single_inputs(body)
    bad = jr.validate_single(inp)
    if bad:
        return _err(bad[0], bad[1])
    d = jr.calculate_single(inp)
    log_usage_event("feature", "jet_roi_calculate", f"web {body.process}")
    return _clean({"result": d, "chart": jr.single_chart(d["comp_cost_yr"], d["heb_cost_yr"], d["nozzle_px"], d["n_pos"])})


def _pdf_response(write, name: str) -> Response:
    buf = io.BytesIO()
    write(buf)
    return Response(buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/single/pdf")
def single_pdf(body: SingleBody, user: Dict[str, Any] = Depends(_feature)):
    inp = _single_inputs(body)
    bad = jr.validate_single(inp)
    if bad:
        return _err(bad[0], bad[1])
    d = jr.calculate_single(inp)
    log_usage_event("feature", "jet_roi_pdf", "web single")
    return _pdf_response(lambda f: jr.generate_pdf(f, d), f"Heberlein_JetROI_{datetime.date.today():%Y%m%d}.pdf")


class MultiRow(BaseModel):
    label: str = ""
    pos: str = "100"
    hours: str = ""
    a_jet_id: Optional[int] = None
    b_jet_id: Optional[int] = None
    a_price: str = ""
    b_price: str = ""
    a_pressure: Pressure = Pressure()
    b_pressure: Pressure = Pressure()


class MultiBody(BaseModel):
    process: str = "DTY"
    currency: str = "CHF"
    cost_m3: str = "0.04"
    rows: List[MultiRow] = []


def _multi(b: MultiBody):
    jets = _jets()
    try:
        cost = float(str(b.cost_m3 or "0.04").replace(",", "."))
    except ValueError:
        return None, _err("cost", "Air cost/Nm³: invalid number.")
    sym = dict(jr.CURRENCIES).get(b.currency, b.currency)
    rows = []
    for r in b.rows[:50]:
        def jet(i):
            j = jets.get(i) if i is not None else None
            return j if j is not None and jr.jet_matches_process(j, b.process) else None
        rows.append({"label": r.label, "pos": r.pos, "hours": r.hours, "a_jet": jet(r.a_jet_id), "b_jet": jet(r.b_jet_id),
                     "a_price": r.a_price, "b_price": r.b_price, "a_pressure": _bar(r.a_pressure) or 0.0,
                     "b_pressure": _bar(r.b_pressure) or 0.0})
    calc = jr.calculate_multi(rows, cost, sym)
    if calc is None:
        return None, _err("no_rows", "Please select Jet A and Jet B for at least one row.")
    return calc, None


@router.post("/multi")
def multi(body: MultiBody, user: Dict[str, Any] = Depends(_feature)):
    calc, err = _multi(body)
    if err:
        return err
    log_usage_event("feature", "jet_roi_calculate", f"web multi {len(calc['results'])}")
    return _clean({**calc, "chart": jr.multi_chart(calc["totals"]["saving"], calc["totals"]["invest"])})


@router.post("/multi/pdf")
def multi_pdf(body: MultiBody, user: Dict[str, Any] = Depends(_feature)):
    calc, err = _multi(body)
    if err:
        return err
    log_usage_event("feature", "jet_roi_pdf", "web multi")
    return _pdf_response(lambda f: jr.generate_multi_pdf(f, calc["results"], calc["totals"]),
                         f"Heberlein_MultiJet_{datetime.date.today():%Y%m%d}.pdf")
