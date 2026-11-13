"""Machine path schema above Machine Data (DTY / ATY), read only.

Same data as the desktop panel (ui/dty_schema_panel.py + ui/aty_schema.py):
both build it with db/machine_schema.py from the Machine Data of the series
(db/machine_data.build_machine_data); the page draws it as SVG
(frontend/src/components/SchemaPanel.tsx).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from . import core  # noqa: F401
from .deps import current_user

from db import machine_data as mdm  # noqa: E402
from db import machine_schema as ms  # noqa: E402
from db import series_tables as stb  # noqa: E402

router = APIRouter(prefix="/api")

_PLY_FIELDS = ("idx", "label", "ply", "pos", "yarn", "path", "role", "into", "at", "auto",
               "is_elastane", "values", "tips")


def _kb(target) -> Optional[Dict[str, Any]]:
    if not target:
        return None
    return {"module": target[0], "scene": target[1], "station": target[2] if len(target) > 2 else None}


def _stations_meta(profile: str, row_keys: List[Optional[str]]) -> Dict[str, Any]:
    """Every station of the profile: names, per ply, its Machine Data rows (by row key), KB target."""
    mod = ms.station_module(profile)
    short = mod.SHORT if profile == "aty" else ms.SHORT
    out: Dict[str, Any] = {}
    for key, label, per_ply in mod.STATIONS:
        out[key] = {"label": label, "short": short.get(key, key), "per_ply": bool(per_ply),
                    "rows": [row_keys[r] for r in ms.station_rows(row_keys, key, profile)],
                    "kb": _kb(ms.kb_target(key, profile))}
    return out


@router.get("/series/{series_id}/schema")
def schema(series_id: int, mode: str = "single", trial: int = 0, _user: Dict[str, Any] = Depends(current_user)):
    """Schema of one trial (`trial` = TrialID, default the first). profile None = no schema
    (not a DTY machine with the DTY Process row, not an ATY machine)."""
    if stb.series_header(series_id) is None:
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "This series does not exist."})
    if mode not in mdm.VIEW_MODES:
        mode = "single"
    st = stb.load_trials(series_id)
    if not st.trials:
        return {"profile": None}
    cache = mdm.load_machine_cache(st.series_id, st.trial_ids)
    md = mdm.build_machine_data(st, mode, cache)
    if md.message or not md.col_specs:
        return {"profile": None}
    profile = ms.profile(cache, md.row_keys)
    if profile is None:
        return {"profile": None}
    jets = mdm.load_jets_lookup()
    housing = mdm.load_housing_lookup()
    src = ms.MachineDataSource(md, jets.map, housing.map)

    trials: List[Dict[str, Any]] = []
    for i, cs in enumerate(md.col_specs):
        if not trials or trials[-1]["trial_id"] != cs["trial_id"]:
            label = (md.columns[i] if i < len(md.columns) else {}).get("trial_label") or ""
            trials.append({"trial_id": cs["trial_id"], "label": label, "col": i})
    col = next((t["col"] for t in trials if trial and t["trial_id"] == trial), 0)
    if profile == "aty":
        d = ms.build_aty_path(src, col)
    else:
        d = ms.build_dty_path(src, col, ms.load_yarn_types(md.col_specs))
        d["profile"] = "dty"
    plies = [{k: pl.get(k) for k in _PLY_FIELDS} for pl in d.get("plies") or []]
    out = {
        "profile": profile, "trials": trials, "trial_id": d.get("trial_id"),
        "title": d.get("title") or "", "process": d.get("process") or "",
        "process_id": None if d.get("process_id") in (None, "") else str(d.get("process_id")),
        "plies": plies, "order": d.get("order") or [], "main": d.get("main"),
        "stations": d.get("stations") or [], "values": d.get("values") or {}, "tips": d.get("tips") or {},
        "warnings": d.get("warnings") or [],
        "meta": _stations_meta(profile, list(md.row_keys or [])),
    }
    return jsonable_encoder(out)
