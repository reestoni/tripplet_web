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
    ("machine", "Machine Data"),
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
