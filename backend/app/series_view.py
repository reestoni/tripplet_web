"""series_view.py - Show Experiment (read only): header, trial columns and the lab tabs
that already live in db/series_tables.py. Machine Data and the remaining tabs follow."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from . import core  # noqa: F401
from .deps import current_user

from db import cell_notes  # noqa: E402
from db import series_tables as stb  # noqa: E402
from db.retest_flags import get_open_retest_flags_for_series_and_source  # noqa: E402
from db.trial_reference import format_trial_number  # noqa: E402

router = APIRouter(prefix="/api")

# desktop tabs that are not in the web version yet (shown greyed out)
# desktop tabs that are not in the web version yet (shown greyed out)
PENDING_TABS: List[tuple] = []


def _text(v: Any) -> str:
    # desktop PivotEditModel.set_cell stores str(value), None -> ""
    return "" if v is None else str(v)


def _note_json(n: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": int(n["ID"]), "text": str(n.get("NoteText") or ""), "user": (n.get("UserName") or "").strip(),
            "when": cell_notes.format_when(n.get("CreatedAt")), "trial_id": n.get("TrialID")}


def _notes(series_id: int, trial_ids) -> Dict[tuple, list]:
    return cell_notes.by_cell(cell_notes.notes_for_series(series_id, trial_ids))


def _where(n: Dict[str, Any], seen: Dict[int, tuple]) -> Dict[str, Any]:
    """Where a note sits: lab tab key + row title, else Machine Data (tblTrial/tblTrialSettings) or table + field."""
    if cell_notes.is_trial_note(n):
        return {"where_tab": None, "where_row": ""}
    if int(n["ID"]) in seen:
        key, row = seen[int(n["ID"])]
        return {"where_tab": key, "where_row": row}
    table = str(n.get("TableName") or "")
    if table.lower() in ("tbltrial", "tbltrialsettings"):
        return {"where_tab": "machine", "where_row": str(n.get("FieldName") or "")}
    return {"where_tab": None, "where_row": f"{table} · {n.get('FieldName')}"}


def _options(pairs) -> List[List[Any]]:
    """[[id, name], ...] for a dropdown row (ids as int where possible)."""
    out = []
    for k, v in pairs:
        try:
            k = int(k)
        except (TypeError, ValueError):
            pass
        out.append([k, str(v)])
    return out


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


def _tab_json(lt: stb.LabTab, p: stb.LabPivot, info: list, series_id: int, trial_col: Dict[int, int],
              by_key: Optional[Dict[tuple, list]] = None, seen: Optional[Dict[int, tuple]] = None) -> Dict[str, Any]:
    rows: List[Dict[str, Any]] = [
        {"title": title, "info": True, "cells": [{"v": _text(v)} for v in vals]} for title, vals in info
    ]
    for r, title in enumerate(p.row_titles):
        cells = []
        for c, (value, binding) in enumerate(p.cells[r]):
            alert: Optional[str] = p.alerts.get((r, c))
            if stb.cv_limit_alert(title, _text(value)):
                alert = "red"
            cell: Dict[str, Any] = {"v": _text(value)}
            if binding is not None:
                cell["e"] = 1                     # editable (has a DB binding)
            if alert:
                cell["alert"] = alert
            notes = cell_notes.notes_for_binding(by_key, binding)
            if notes:
                cell["notes"] = [_note_json(n) for n in notes]
                if seen is not None:
                    for n in notes:
                        seen.setdefault(int(n["ID"]), (lt.key, title))
            cells.append(cell)
        rows.append({"title": title, "r": r, "cells": cells})
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
    all_notes = cell_notes.notes_for_series(series_id, st.trial_ids) if cell_notes.available() else []
    by_key = cell_notes.by_cell(all_notes)
    seen: Dict[int, tuple] = {}
    tabs = [_tab_json(lt, pivots[lt.key], info, series_id, trial_col, by_key, seen)
            for lt in stb.LAB_TABS if pivots[lt.key]]
    # Jet Air Consumption (own columns = pressure steps), loaded on demand; desktop position = 2nd lab tab
    if stb.build_jet_air(series_id) is not None:
        tabs.insert(min(stb.JET_AIR_TAB_INDEX, len(tabs)), {"key": "jet_air", "title": stb.JET_AIR_TITLE,
                                                             "lazy": True, "rows": [], "flags": {}})
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
        "has_rd": has_rd_fields(series_id),
        "has_yarnscope": _has_yarnscope(series_id),
        "tabs": tabs,
        # Notes tab: every note of the series, where it sits (lab tab · row, else "Machine Data" / table · field)
        "notes": [dict(_note_json(n), trial_note=cell_notes.is_trial_note(n), **_where(n, seen)) for n in all_notes],
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
    all_notes = cell_notes.notes_for_series(series_id, st.trial_ids) if cell_notes.available() else []
    by_key = cell_notes.by_cell(all_notes)
    trial_notes: Dict[int, list] = {}
    for n in all_notes:
        if cell_notes.is_trial_note(n):
            trial_notes.setdefault(int(n["TrialID"]), []).append(_note_json(n))
    columns = [{
        "notes": trial_notes.get(int(c.get("trial_id") or 0), []),
        "c": i,
        "filter": mdm.column_label(md.col_specs[i], mode == "groups"),
        "trial_id": c.get("trial_id"),
        "trial_label": c.get("trial_label"),
        "reference": c.get("reference"),
        "ply": c.get("ply_label"),
        "ply_tooltip": c.get("ply_tooltip") or "",
        "colour": c.get("yarn_colour_css"),
        "colour_name": c.get("yarn_colour") or "",
    } for i, c in enumerate(md.columns) if not col_hidden[i]]
    ro = set(md.read_only_rows or ())
    dd_rows: Dict[int, Any] = {mdm.HOUSING_ROW: _options(housing.list), mdm.JET_ROW: _options(jets.list)}
    for rr, lst in (md.dropdown_lists or {}).items():
        dd_rows[rr] = _options(lst)
    rows = []
    for r, title in enumerate(md.row_titles):
        if r in hidden:
            continue
        cells = []
        for c in keep:
            cell: Dict[str, Any] = {"v": mdm.display_text(md, r, c, jets.map, housing.map)}
            if md.cells[r][c][1] is not None and r not in ro:
                cell["e"] = 1
                if r in dd_rows:
                    cell["raw"] = None if md.cells[r][c][0] in (None, "") else str(md.cells[r][c][0])
            tip = md.cell_tooltips.get((r, c))
            if tip:
                cell["tip"] = tip
            alert = md.cell_alerts.get((r, c))
            if alert:
                cell["alert"] = alert
            notes = cell_notes.notes_for_binding(by_key, md.cells[r][c][1])
            if notes:
                cell["notes"] = [_note_json(n) for n in notes]
            cells.append(cell)
        rows.append({"r": r, "rule": md.validators[r] if r < len(md.validators) else None,
                     "options": dd_rows.get(r),
                     "title": title, "key": md.row_keys[r] if r < len(md.row_keys) else "",
                     "readonly": r in set(md.read_only_rows or ()), "cells": cells})
    return {"mode": mode, "has_groups": has_groups, "message": None, "columns": columns, "rows": rows,
            "filter_labels": list(md.filter_labels or []) if mode != "compact" else [],
            "multi_ply": bool(md.has_multi_ply)}


# --------------------------------------------------------------------------- Jet Air Consumption
def _grid(p: stb.LabPivot) -> Dict[str, Any]:
    return {"columns": list(p.col_titles or []),
            "rows": [{"title": t, "r": r, "cells": [dict({"v": _text(v)}, **({"e": 1} if b is not None else {}))
                                                     for v, b in p.cells[r]]} for r, t in enumerate(p.row_titles)]}


@router.get("/series/{series_id}/jet-air")
def jet_air(series_id: int, unit: str = "Nm3h", _user: Dict[str, Any] = Depends(current_user)):
    if unit not in stb.JET_AIR_UNITS:
        unit = "Nm3h"
    j = stb.build_jet_air(series_id, unit)
    if j is None:
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "No jet air data."})
    return {"unit": j.unit, "units": stb.JET_AIR_UNITS,
            "consumption": _grid(j.consumption), "atm": _grid(j.atm), "temp": _grid(j.temp)}


# --------------------------------------------------------------------------- attachments
@router.get("/series/{series_id}/attachments")
def attachments(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    from db import series_attachments as sa

    def _items(rows):
        return [{"id": r.get("ID"), "name": r.get("OriginalFilename") or r.get("StoredFilename")}
                for r in rows if r.get("ID") is not None]
    return {"images": _items(sa.list_images(series_id)), "pdfs": _items(sa.list_pdfs(series_id))}


@router.get("/series/{series_id}/attachments/{kind}/{attachment_id}")
def attachment_file(series_id: int, kind: str, attachment_id: int, _user: Dict[str, Any] = Depends(current_user)):
    from fastapi.responses import FileResponse
    from db import series_attachments as sa
    path = sa.file_for_download(kind, series_id, attachment_id)
    if not path:
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "File not found."})
    return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"},
                        content_disposition_type="inline")


# --------------------------------------------------------------------------- R&D Machine Data
@router.get("/series/{series_id}/rd")
def rd_machine_data(series_id: int, mode: str = "single", _user: Dict[str, Any] = Depends(current_user)):
    """R&D Machine Data (tblMachineFields.RDSetting = 1) on the same columns as Machine Data."""
    from db import machine_data as mdm
    if stb.series_header(series_id) is None:
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "This series does not exist."})
    if mode not in mdm.VIEW_MODES:
        mode = "single"
    st = stb.load_trials(series_id)
    md = mdm.build_machine_data(st, mode)
    rd = mdm.build_rd_machine_data(md, reference_names=st.reference_names)
    if not rd.visible or not rd.row_titles:
        return {"mode": mode, "has_groups": bool(md.has_groups), "message": None, "visible": False,
                "columns": [], "rows": [], "filter_labels": []}
    jets = mdm.load_jets_lookup()
    housing = mdm.load_housing_lookup()
    col_hidden = mdm.hidden_columns(rd.col_specs, mode == "compact", mode == "groups", None)
    keep = [c for c in range(len(rd.columns)) if not col_hidden[c]]
    all_notes = cell_notes.notes_for_series(series_id, st.trial_ids) if cell_notes.available() else []
    by_key = cell_notes.by_cell(all_notes)
    columns = [{
        "notes": [],
        "c": i,
        "filter": mdm.column_label(rd.col_specs[i], mode == "groups"),
        "trial_id": c.get("trial_id"), "trial_label": c.get("trial_label"), "reference": c.get("reference"),
        "ply": c.get("ply_label"), "ply_tooltip": c.get("ply_tooltip") or "",
        "colour": c.get("yarn_colour_css"), "colour_name": c.get("yarn_colour") or "",
    } for i, c in enumerate(rd.columns) if not col_hidden[i]]
    rd_dd: Dict[int, Any] = {0: _options(housing.list), 1: _options(jets.list)}
    for rr, lst in (rd.dropdown_lists or {}).items():
        rd_dd[rr] = _options(lst)
    rows = []
    for r, title in enumerate(rd.row_titles):
        cells = []
        for c in keep:
            cell: Dict[str, Any] = {"v": mdm.rd_display_text(rd, r, c, jets.map, housing.map)}
            if rd.cells[r][c][1] is not None:
                cell["e"] = 1
                if r in rd_dd:
                    cell["raw"] = None if rd.cells[r][c][0] in (None, "") else str(rd.cells[r][c][0])
            # housing rows: the desktop shows a picture (tblHousing.Link) - not as text here
            tip = "" if r in rd.housing_rows else mdm.rd_tooltip(rd, r, c, jets.tooltip_map, {})
            if tip:
                cell["tip"] = tip
            alert = rd.cell_alerts.get((r, c))
            if alert:
                cell["alert"] = alert
            notes = cell_notes.notes_for_binding(by_key, rd.cells[r][c][1])
            if notes:
                cell["notes"] = [_note_json(n) for n in notes]
            cells.append(cell)
        rows.append({"r": r, "rule": rd.validators[r] if r < len(rd.validators) else None, "options": rd_dd.get(r),
                     "title": title, "key": rd.row_keys[r] if r < len(rd.row_keys) else "", "readonly": False,
                     "cells": cells})
    return {"mode": mode, "has_groups": bool(md.has_groups), "message": None, "visible": True,
            "columns": columns, "rows": rows,
            "filter_labels": list(md.filter_labels or []) if mode != "compact" else []}


def has_rd_fields(series_id: int) -> bool:
    """Cheap check for the tab bar: does the series' machine have R&D fields?"""
    from db.connection import fetch_all
    try:
        rows = fetch_all("SELECT 1 AS x FROM tblMachineFields MF JOIN tblTrialSeries S ON S.MachineID = MF.MachineID "
                         "WHERE S.ID = ? AND COALESCE(MF.RDSetting, 0) = 1 LIMIT 1", [series_id])
        return bool(rows)
    except Exception:
        return False


def _has_yarnscope(series_id: int) -> bool:
    from .yarnscope import has_yarnscope
    return has_yarnscope(series_id)
