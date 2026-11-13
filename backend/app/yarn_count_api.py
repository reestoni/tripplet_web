"""yarn_count_api.py - Yarn Count Converter (/tools/yarn-count; desktop ui/screen_yarn_count.py) on ui/yarn_count.py.

No database. The browser sends value + unit (+ filaments, plies, density) and gets every count system, the
filament values and the designation back; the notation reader ("167f48", "2x150D/48F") is the desktop's too.
Unit names, descriptions and densities are technical data and stay as in the desktop."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from ui import yarn_count as yc  # noqa: E402

router = APIRouter(prefix="/api/yarn-count")
_feature = require_feature("yarn_count")


@router.get("/meta")
def meta(user: Dict[str, Any] = Depends(_feature)):
    return {"units": [{"key": k, "label": lab, "kind": kind, "desc": desc, "formula": yc.formula(k)}
                      for k, lab, kind, _k, desc in yc.UNITS],
            "densities": [{"name": n, "rho": rho} for n, rho in yc.DENSITIES]}


class ConvertBody(BaseModel):
    value: str
    unit: str
    filaments: Optional[str] = None
    plies: Optional[str] = None
    density: float = 1.38


def _pos_int(txt: Optional[str]) -> Optional[int]:
    try:
        v = int(float(str(txt or "").strip().replace(",", ".").replace("'", "")))
        return v if v > 0 else None
    except ValueError:
        return None


@router.post("/convert")
def convert(body: ConvertBody, user: Dict[str, Any] = Depends(_feature)):
    if body.unit not in yc.UNIT:
        return JSONResponse(status_code=400, content={"code": "bad_unit", "detail": "Unknown unit."})
    txt = (body.value or "").strip().replace(",", ".").replace("'", "")
    tex = None
    if txt:
        try:
            tex = yc.to_tex(float(txt), body.unit)
        except (ValueError, ZeroDivisionError):
            tex = None
    values = {k: (yc.from_tex(tex, k) if tex else None) for k, *_ in yc.UNITS}
    fil = yc.filament_values(tex, _pos_int(body.filaments), _pos_int(body.plies) or 1, body.density or 1.38)
    show = lambda v: None if v is None else yc.fmt(v)
    return {"ok": tex is not None, "invalid": bool(txt) and tex is None,
            "values": {k: show(v) for k, v in values.items()},
            "raw": {k: v for k, v in values.items()},
            "filament": {k: (None if v is None else str(int(v)) if k == "total_fil" else
                             v if k == "designation" else yc.fmt(v)) for k, v in fil.items()}}


class NotationBody(BaseModel):
    text: str
    default_unit: str = "dtex"


@router.post("/notation")
def notation(body: NotationBody, user: Dict[str, Any] = Depends(_feature)):
    p = yc.parse_notation(body.text, body.default_unit if body.default_unit in yc.UNIT else "dtex")
    if not p:
        return {"ok": False}
    return {"ok": True, "count": yc.fmt(p["count"]).replace("'", ""), "unit": p["unit"],
            "unit_label": yc.UNIT[p["unit"]][1].split(" (")[0], "filaments": p["filaments"], "plies": p["plies"]}
