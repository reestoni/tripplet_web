"""series_view.py - Show Experiment (read only): header, trial columns and the lab tabs
that already live in db/series_tables.py. Machine Data and the remaining tabs follow."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from . import core  # noqa: F401
from .deps import current_user

from db import cell_notes  # noqa: E402
from db import experiment_requests as _er  # noqa: E402
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


def _int_or(v: Any) -> Any:
    try:
        return int(v)
    except (TypeError, ValueError):
        return v


def _lookup(m: Dict[Any, Any], key: Any) -> Any:
    """Lookup maps of db/machine_data hold int and str keys."""
    k = _int_or(key)
    return (m or {}).get(k) or (m or {}).get(str(k))


@router.get("/series/{series_id}/materials")
def materials(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """Material line (desktop _load_materials_summary): per ply the most frequent yarn, colour square and
    stock summary (spool symbol: green = in stock, click = storage locations)."""
    from db.yarn_spools import load_stock_summary, series_materials
    from db.yarn_colours import colour_css, load_yarn_colours
    mats = series_materials(series_id)
    stock = load_stock_summary(m["yarn_id"] for m in mats)
    colours, _n = load_yarn_colours()
    out = []
    for m in mats:
        yid = m["yarn_id"]
        sm = stock.get(int(yid)) if yid is not None else None
        out.append({"ply": m["ply"], "yarn_id": yid, "name": m["name"],
                    "colour": colours.get(yid) if yid is not None else None,
                    "css": colour_css(colours.get(yid)) if yid is not None else None,
                    "stock": {"spools": sm.spools, "kg": round(sm.kg, 1), "locations": sm.locations} if sm else None})
    return {"materials": out}


@router.get("/series/{series_id}/stock/{yarn_id}")
def yarn_stock_of_series(series_id: int, yarn_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """Storage locations of a yarn; the spools assigned to this series are marked (desktop YarnLocationsDialog)."""
    from .create_api import stock_payload
    return stock_payload(yarn_id, series_id)


@router.get("/housing-image/{housing_id}")
def housing_image(housing_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """Picture of a housing (tblHousing.Link) - the hover picture of the Housing row. Only the path
    stored for that housing, only image files."""
    import os
    from fastapi.responses import FileResponse
    from db import machine_data as mdm
    path = _lookup(mdm.load_housing_lookup().image_map, housing_id)
    if not path or os.path.splitext(str(path))[1].lower() not in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp")             or not os.path.isfile(str(path)):
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "No picture for this housing."})
    return FileResponse(str(path), headers={"Cache-Control": "private, max-age=86400"})


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


def _flags(series_id: int, lab_source: str, trial_col: Dict[int, int], banner: Optional[List[Dict[str, str]]] = None) -> Dict[int, str]:
    """Column -> tooltip for open retest flags (same text as the desktop); ``banner`` collects
    trial + note for the "Retest pending" banner above the table (desktop _apply_lab_retest_flags)."""
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
        if banner is not None:
            banner.append({"trial": label, "note": note})
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
    banner: List[Dict[str, str]] = []
    from ui import kb_links
    return {"key": lt.key, "title": lt.title, "rows": rows,
            "kb": kb_url(kb_links.LAB_TABLE_TARGET.get("tbl_" + lt.key)),   # desktop kb_links.table_target
            "flags": {str(c): tip for c, tip in _flags(series_id, lt.lab_source, trial_col, banner).items()},
            "retest": banner}


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
            # ER icon in the header (desktop ShowExperimentScreen._refresh_experiment_request_link)
            "experiment_request_id": _er.request_id_for_experiment(head.get("ExperimentPK")),
        },
        "trials": trials,
        "has_rd": has_rd_fields(series_id),
        "has_yarnscope": _has_yarnscope(series_id),
        "has_yarnscope_aty": _has_yarnscope_aty(series_id),
        # right-click on a trial: "Open in Process Playground" (DTY machines, tool allowed; desktop same rule)
        "playground": _playground(_user, series_id),
        # Canvas boards of this series (db/canvas_boards.py); None = no Canvas right or no table
        "boards": _boards(_user, series_id),
        # conclusion tab (db/series_conclusion.py): None = table missing, else {"outcome"} / {} when none yet
        "conclusion": _conclusion(series_id),
        # opened from the recycle bin by this superuser: read only + banner (app/recycle_bin_api.py)
        "recycle_preview": _recycle_preview(series_id, _user),
        "tabs": tabs,
        # Notes tab: every note of the series, where it sits (lab tab · row, else "Machine Data" / table · field)
        "notes": [dict(_note_json(n), trial_note=cell_notes.is_trial_note(n), **_where(n, seen)) for n in all_notes],
        "pending_tabs": [{"key": k, "title": t} for k, t in PENDING_TABS],
    }


def _recycle_preview(series_id: int, user: Dict[str, Any]):
    from .recycle_bin_api import preview_for
    return preview_for(series_id, user)


def _conclusion(series_id: int):
    from db import series_conclusion as sc
    if not sc.table_ready():
        return None
    c = sc.summary_map([series_id]).get(series_id)
    return {"exists": bool(c), "outcome": (c or {}).get("outcome")}


def _boards(user: Dict[str, Any], series_id: int):
    from .deps import can_use
    from db import canvas_boards as cb
    if not can_use(user, "canvas") or not cb.table_ready():
        return None
    return cb.board_counts([series_id]).get(series_id, 0)


def _playground(user: Dict[str, Any], series_id: int) -> bool:
    from .deps import can_use
    from ui import process_playground_core as ppc
    return can_use(user, "process_playground") and ppc.series_is_dty(series_id)


# --------------------------------------------------------------------------- Machine Data
@router.get("/series/{series_id}/machine")
def machine_data(series_id: int, mode: str = "single", custom: int = 0, _user: Dict[str, Any] = Depends(current_user)):
    """Machine Data tab (read only) from db/machine_data.py - the desktop builds its model from the same data."""
    from db import machine_data as mdm
    if stb.series_header(series_id) is None:
        return JSONResponse(status_code=404, content={"code": "not_found", "detail": "This series does not exist."})
    if mode not in mdm.VIEW_MODES:
        mode = "single"
    st = stb.load_trials(series_id)
    cache = mdm.load_machine_cache(st.series_id, st.trial_ids)
    md = mdm.build_machine_data(st, mode, cache)
    has_groups = bool(md.has_groups)
    if md.message or not st.trials:
        return {"mode": mode, "has_groups": has_groups, "message": md.message, "columns": [], "rows": [], "spans": []}
    jets = mdm.load_jets_lookup()
    housing = mdm.load_housing_lookup()
    hidden = set(md.process_hidden_rows or ())
    has_custom = md.custom_group_row is not None and 0 <= md.custom_group_row < len(md.row_titles)
    if has_custom and not custom:
        hidden.add(md.custom_group_row)          # desktop: Custom Group row off by default ("Show Custom Group")
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
    prof = _schema_profile(cache, md.row_keys)
    for r, title in enumerate(md.row_titles):
        if r in hidden:
            continue
        cells = []
        rkey = md.row_keys[r] if r < len(md.row_keys) else ""
        rkb = _row_kb(prof, rkey)
        for c in keep:
            cell: Dict[str, Any] = {"v": mdm.display_text(md, r, c, jets.map, housing.map)}
            ckb = _cell_kb(rkb, cell["v"])
            if ckb and ckb != rkb:
                cell["kb"] = kb_url(ckb)
            if md.cells[r][c][1] is not None and r not in ro:
                cell["e"] = 1
                if r in dd_rows:
                    cell["raw"] = None if md.cells[r][c][0] in (None, "") else str(md.cells[r][c][0])
            tip = md.cell_tooltips.get((r, c))
            stored = md.cells[r][c][0]
            if r == mdm.JET_ROW and stored not in (None, ""):      # desktop: jet geometry tooltip
                tip = _lookup(jets.tooltip_map, stored) or tip
            if r == mdm.HOUSING_ROW and stored not in (None, "") and _lookup(housing.image_map, stored):
                cell["img"] = _int_or(stored)                     # desktop: housing picture on hover
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
                     "title": title, "key": rkey, "kb": kb_url(rkb),
                     "readonly": r in set(md.read_only_rows or ()), "cells": cells})
    return {"mode": mode, "has_groups": has_groups, "message": None, "columns": columns, "rows": rows,
            "filter_labels": list(md.filter_labels or []) if mode != "compact" else [],
            "multi_ply": bool(md.has_multi_ply), "machine_id": md.machine_id,
            "custom_row": md.custom_group_row if has_custom else None,
            "schema": prof}   # "dty" / "aty" / None (app/schema.py)


def kb_url(target) -> Optional[str]:
    """ui/kb_links target (module, scene, station[, fibre]) -> web route of the Knowledge Base page."""
    if not target:
        return None
    key, scene, station = (list(target) + [None, None])[:3]
    fibre = target[3] if len(target) > 3 else None
    q = "&".join(x for x in (f"scene={scene}" if scene else "", f"station={station}" if station else "",
                             f"fibre={fibre}" if fibre else "") if x)
    return f"/knowledge-base/{key}" + (f"?{q}" if q else "")


def _row_kb(profile: Optional[str], row_key: Optional[str]):
    """KB target of a Machine Data row (desktop kb_links.machine_row_target: DTY / ATY schema stations only)."""
    if profile not in ("dty", "aty"):
        return None
    from db import machine_schema
    return machine_schema.kb_target(machine_schema.station_module(profile).station_of(row_key), profile)


def _cell_kb(row_target, text: str):
    """The DTY Process cell leads to its own variant page (desktop kb_links.machine_cell_target)."""
    from ui import kb_links
    if row_target and row_target == kb_links.DTY_STATION_TARGET["process"]:
        return kb_links.DTY_PROCESS_TARGET.get(str(text or "").strip().lower(), row_target)
    return None


def _schema_profile(cache, row_keys):
    from db import machine_schema
    try:
        return machine_schema.profile(cache, list(row_keys or []))
    except Exception:
        return None


# --------------------------------------------------------------------------- Jet Air Consumption
def _grid(p: stb.LabPivot) -> Dict[str, Any]:
    return {"columns": list(p.col_titles or []),
            "rows": [{"title": t, "r": r, "cells": [dict({"v": _text(v)}, **({"e": 1} if b is not None else {}))
                                                     for v, b in p.cells[r]]} for r, t in enumerate(p.row_titles)]}


@router.get("/series/{series_id}/jet-air/sync-plan")
def jet_air_sync_plan(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """"Sync physical jets" (desktop _sync_jet_air_physical_jets): what would be added / deleted (db/jet_air_sync)."""
    from db import jet_air_sync
    plan = jet_air_sync.plan_sync(series_id)
    return {"status": plan["status"], "to_insert": len(plan["to_insert"]),
            "orphans": [{k: o[k] for k in ("jet", "plate", "has_data")} for o in plan["orphans"]]}


@router.post("/series/{series_id}/jet-air/sync")
def jet_air_sync_apply(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Writes the sync (plan made again on the server; empty orphan rows only)."""
    from db import jet_air_sync
    if int(user.get("access_level") or 0) < 2:
        return JSONResponse(status_code=403, content={"code": "read_only", "detail": "No write access."})
    plan = jet_air_sync.plan_sync(series_id)
    if plan["status"] != "changes":
        return {"status": plan["status"], "added": 0, "deleted": 0}
    jet_air_sync.apply_sync(series_id, plan, user.get("id"))
    return {"status": "synced", "added": len(plan["to_insert"]), "deleted": len(plan["delete_ids"])}


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
def attachments(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    from db import series_attachments as sa
    from db.experiment_request_images import can_delete

    def _items(rows):
        return [{"id": r.get("ID"), "name": r.get("OriginalFilename") or r.get("StoredFilename"),
                 "can_delete": can_delete(user, r)}
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
    rd_prof = _schema_profile(mdm.load_machine_cache(st.series_id, st.trial_ids), md.row_keys)
    for r, title in enumerate(rd.row_titles):
        cells = []
        rd_key = rd.row_keys[r] if r < len(rd.row_keys) else ""
        rd_kb = _row_kb(rd_prof, rd_key)
        for c in keep:
            cell: Dict[str, Any] = {"v": mdm.rd_display_text(rd, r, c, jets.map, housing.map)}
            if rd.cells[r][c][1] is not None:
                cell["e"] = 1
                if r in rd_dd:
                    cell["raw"] = None if rd.cells[r][c][0] in (None, "") else str(rd.cells[r][c][0])
            # housing rows: the desktop shows a picture (tblHousing.Link) - not as text here
            tip = "" if r in rd.housing_rows else mdm.rd_tooltip(rd, r, c, jets.tooltip_map, {})
            stored = rd.cells[r][c][0]
            if r in rd.housing_rows and stored not in (None, "") and _lookup(housing.image_map, stored):
                cell["img"] = _int_or(stored)
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
                     "title": title, "key": rd_key, "kb": kb_url(rd_kb), "readonly": False,
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


def _has_yarnscope_aty(series_id: int) -> bool:
    from .yarnscope_aty import has_yarnscope_aty
    return has_yarnscope_aty(series_id)


def _has_yarnscope(series_id: int) -> bool:
    from .yarnscope import has_yarnscope
    return has_yarnscope(series_id)
