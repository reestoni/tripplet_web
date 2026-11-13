"""series_view.py - Show Experiment (read only): header, trial columns and the lab tabs
that already live in db/series_tables.py. Machine Data and the remaining tabs follow."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from . import core  # noqa: F401
from .deps import current_user

from db import series_tables as stb  # noqa: E402
from db.retest_flags import get_open_retest_flags_for_series_and_source  # noqa: E402
from db.trial_reference import format_trial_number  # noqa: E402

router = APIRouter(prefix="/api")

# desktop tabs that are not in the web version yet (shown greyed out)
PENDING_TABS = [
    ("jet_air", "Jet Air Consumption"),
    ("itemat", "Itemat Lab"),
    ("itemat_plus", "Itemat Plus"),
    ("dtyomat", "DTYoMat"),
    ("atyomat", "ATYoMat"),
]


def _text(v: Any) -> str:
    # desktop PivotEditModel.set_cell stores str(value), None -> ""
    return "" if v is None else str(v)


def _flags(series_id: int, lab_source: str, trial_col: Dict[int, int]) -> Dict[int, str]:
    """Column -> tooltip for open retest flags (same text as the desktop)."""
    out: Dict[int, str] = {}
    try:
        flags = get_open_retest_flags_for_series_and_source(int(series_id), lab_source)
    except Exception:
        return out
    for f in flags:
        try:
            col = trial_col.get(int(f.get("TrialID")))
        except Exception:
            col = None
        if col is None:
            continue
        vno = f.get("Versuchsnummer")
        label = format_trial_number(vno) if vno not in (None, "") else "?"
        note = (f.get("Note") or "").strip()
        who = f.get("CreatedByUsername") or ""
        tip = f"{label} — retest pending" + (f": {note}" if note else "")
        if who:
            tip += f" (flagged by {who})"
        out[col] = tip
    return out


def _tab_json(lt: stb.LabTab, p: stb.LabPivot, info: list, series_id: int, trial_col: Dict[int, int]) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = [
        {"title": title, "info": True, "cells": [{"v": _text(v)} for v in vals]} for title, vals in info
    ]
    for r, title in enumerate(p.row_titles):
        cells = []
        for c, (value, _binding) in enumerate(p.cells[r]):
            alert: Optional[str] = p.alerts.get((r, c))
            if stb.cv_limit_alert(title, _text(value)):
                alert = "red"
            cells.append({"v": _text(value), "alert": alert} if alert else {"v": _text(value)})
        rows.append({"title": title, "cells": cells})
    return {"key": lt.key, "title": lt.title, "rows": rows,
            "flags": {str(c): tip for c, tip in _flags(series_id, lt.lab_source, trial_col).items()}}


@router.get("/series/{series_id}")
def series(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    head = stb.series_header(series_id)
    if head is None:
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "This series does not exist."})
    st = stb.load_trials(series_id)
    trial_col = {int(t["ID"]): c for c, t in enumerate(st.trials)}
    info = stb.jet_info_rows(st.trial_ids)
    pivots = {lt.key: lt.build(st) for lt in stb.LAB_TABS}
    stb.apply_titer_to_stat_ds(pivots.get("titer"), pivots.get("stat_ds"))
    tabs = [_tab_json(lt, pivots[lt.key], info, series_id, trial_col) for lt in stb.LAB_TABS if pivots[lt.key]]
    trials = [{
        "id": int(t["ID"]),
        "label": st.labels[c],
        "number": t["Versuchsnummer"],
        "reference": st.reference_names.get(int(t["ID"])),
    } for c, t in enumerate(st.trials)]
    return {
        "series": {
            "id": int(head["SeriesID"]),
            "name": head.get("SeriesName") or "",
            "experiment_id": head.get("ExperimentID"),
            "experiment_pk": head.get("ExperimentPK"),
            "machine": head.get("Machine") or "",
            "machine_type": head.get("MachineType"),
            "status_id": head.get("StatusID"),
            "owner": head.get("Owner") or "",
            "creation_date": head.get("CreationDate"),
            "notes": head.get("Notes") or "",
        },
        "trials": trials,
        "tabs": tabs,
        "pending_tabs": [{"key": k, "title": t} for k, t in PENDING_TABS],
    }


# --------------------------------------------------------------------------- Machine Data
@router.get("/series/{series_id}/machine")
def machine_data(series_id: int, mode: str = "single", _user: Dict[str, Any] = Depends(current_user)):
    """Machine Data tab (read only) from db/machine_data.py - the desktop builds its model from the same data."""
    from db import machine_data as mdm
    if stb.series_header(series_id) is None:
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "This series does not exist."})
    if mode not in mdm.VIEW_MODES:
        mode = "single"
    st = stb.load_trials(series_id)
    md = mdm.build_machine_data(st, mode)
    has_groups = bool(md.has_groups)
    if md.message or not st.trials:
        return {"mode": mode, "has_groups": has_groups, "message": md.message, "columns": [], "rows": [], "spans": []}
    jets = mdm.load_jets_lookup()
    housing = mdm.load_housing_lookup()
    hidden = set(md.process_hidden_rows or ())
    if md.custom_group_row is not None:
        hidden.add(md.custom_group_row)          # desktop: Custom Group row off by default
    # compact = only the first column of each trial (desktop _apply_mat_column_filter)
    col_hidden = mdm.hidden_columns(md.col_specs, mode == "compact", mode == "groups", None)
    keep = [c for c in range(len(md.columns)) if not col_hidden[c]]
    columns = [{
        "filter": mdm.column_label(md.col_specs[i], mode == "groups"),
        "trial_id": c.get("trial_id"),
        "trial_label": c.get("trial_label"),
        "reference": c.get("reference"),
        "ply": c.get("ply_label"),
        "ply_tooltip": c.get("ply_tooltip") or "",
        "colour": c.get("yarn_colour_css"),
        "colour_name": c.get("yarn_colour") or "",
    } for i, c in enumerate(md.columns) if not col_hidden[i]]
    rows = []
    for r, title in enumerate(md.row_titles):
        if r in hidden:
            continue
        cells = []
        for c in keep:
            cell: Dict[str, Any] = {"v": mdm.display_text(md, r, c, jets.map, housing.map)}
            tip = md.cell_tooltips.get((r, c))
            if tip:
                cell["tip"] = tip
            alert = md.cell_alerts.get((r, c))
            if alert:
                cell["alert"] = alert
            cells.append(cell)
        rows.append({"title": title, "key": md.row_keys[r] if r < len(md.row_keys) else "",
                     "readonly": r in set(md.read_only_rows or ()), "cells": cells})
    return {"mode": mode, "has_groups": has_groups, "message": None, "columns": columns, "rows": rows,
            "filter_labels": list(md.filter_labels or []) if mode != "compact" else [],
            "multi_ply": bool(md.has_multi_ply)}
