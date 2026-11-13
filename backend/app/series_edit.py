"""series_edit.py - edit Show Experiment cells in the browser, saved exactly like the desktop.

The browser sends only WHERE (tab, data row, data column) and WHAT (the typed text or the chosen
ID). The server rebuilds the tab from the shared modules and takes the DB binding of that cell
itself - table/field names from the client are never used. Then: input rules (normalize_input),
plausibility check (db/plausibility.check, the user confirms unusual values), and
db/series_save.save_series_edits (change log, DY ratio, timestamps, Itemat recompute) - the same
code the desktop runs.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user

from db import machine_data as mdm  # noqa: E402
from db import plausibility  # noqa: E402
from db import series_save as ss  # noqa: E402
from db import series_tables as stb  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api")


class Edit(BaseModel):
    tab: str            # "machine", "rd", "jet_air", "jet_air_atm", "jet_air_temp" or a LAB_TABS key
    r: int              # data row of the tab (no header/info rows)
    c: int              # data column (machine/rd: column of col_specs; labs: trial column)
    value: Any = None   # typed text, or the ID for housing/jet/dropdown rows (None/"" = clear)


class SaveBody(BaseModel):
    edits: List[Edit]
    mode: str = "single"            # Machine Data view the row/col indexes refer to
    unit: str = "Nm3h"              # Jet Air unit the values were typed in
    confirmed: bool = False         # plausibility warnings accepted


class _Tab:
    def __init__(self, titles, validators, cells, read_only=(), kinds=None, labels=None, wide_rows=(),
                 options=None, col_specs=None):
        self.titles, self.validators, self.cells = titles, validators, cells
        self.read_only, self.kinds, self.labels, self.wide_rows = set(read_only), kinds or {}, labels, set(wide_rows)
        self.options: Dict[int, Dict[str, str]] = options or {}   # data row -> {stored id: shown name}
        self.col_specs = col_specs or []                         # machine/rd: trial/ply per column


def _load_tabs(series_id: int, keys: set, mode: str, unit: str) -> Tuple[Dict[str, _Tab], Dict[str, Any], Any]:
    st = stb.load_trials(series_id)
    tabs: Dict[str, _Tab] = {}
    extra: Dict[str, Any] = {}
    md = None
    trial_labels = st.labels
    if keys & {"machine", "rd"}:
        md = mdm.build_machine_data(st, mode)
        col_labels = [[c.get("trial_label"), c.get("ply_label")] for c in md.columns]
        jets, housing = mdm.load_jets_lookup(), mdm.load_housing_lookup()

        def _opts(dd) -> Dict[int, Dict[str, str]]:
            out = {0: {str(k): str(v) for k, v in housing.list}, 1: {str(k): str(v) for k, v in jets.list}}
            for rr, lst in (dd or {}).items():
                out[rr] = {str(k): str(v) for k, v in lst}
            return out
        if "machine" in keys:
            tabs["machine"] = _Tab(md.row_titles, md.validators, md.cells, md.read_only_rows,
                                   {mdm.HOUSING_ROW: "housing", mdm.JET_ROW: "jet"}, col_labels, md.trial_wide_rows,
                                   _opts(md.dropdown_lists), md.col_specs)
        if "rd" in keys:
            rd = mdm.build_rd_machine_data(md, reference_names=st.reference_names)
            tabs["rd"] = _Tab(rd.row_titles, rd.validators, rd.cells, rd.read_only_rows,
                              {0: "housing", 1: "jet"}, col_labels, rd.trial_wide_rows,
                              _opts(rd.dropdown_lists), rd.col_specs)
    for lt in stb.LAB_TABS:
        if lt.key in keys:
            p = lt.build(st)
            if p is not None:
                tabs[lt.key] = _Tab(p.row_titles, p.validators, p.cells, labels=[[x] for x in trial_labels])
    if keys & {"jet_air", "jet_air_atm", "jet_air_temp"}:
        ja = stb.build_jet_air(series_id, unit)
        if ja is not None:
            for key, p in (("jet_air", ja.consumption), ("jet_air_atm", ja.atm), ("jet_air_temp", ja.temp)):
                tabs[key] = _Tab(p.row_titles, p.validators, p.cells, labels=[[x] for x in (p.col_titles or [])])
                if p.extra.get("unit_scale"):
                    extra.setdefault("unit_scales", {})[key] = (p.extra["unit_scale"], p.extra.get("unit_field"))
    return tabs, extra, md


def _model_name(key: str) -> str:
    return {"rd": "rd_machine"}.get(key, key)


@router.post("/series/{series_id}/save")
def save(series_id: int, body: SaveBody, user: Dict[str, Any] = Depends(current_user)):
    if int(user.get("access_level") or 0) < 2:          # desktop: access level 1 = read only
        return JSONResponse(status_code=403, content={"code": "read_only", "detail": "You have read-only access."})
    if not body.edits:
        return {"kind": "saved", "saved": 0}
    if body.mode not in mdm.VIEW_MODES:
        body.mode = "single"
    keys = {e.tab for e in body.edits}
    tabs, extra, md = _load_tabs(series_id, keys, body.mode, body.unit)

    by_model: Dict[str, List[Tuple[Any, str]]] = {}
    items: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    for e in body.edits:
        tab = tabs.get(e.tab)
        if tab is None or not (0 <= e.r < len(tab.cells)) or not (0 <= e.c < len(tab.cells[e.r])):
            errors.append({"tab": e.tab, "r": e.r, "c": e.c, "code": "unknown_cell"})
            continue
        binding = tab.cells[e.r][e.c][1]
        if binding is None or e.r in tab.read_only:
            errors.append({"tab": e.tab, "r": e.r, "c": e.c, "code": "not_editable"})
            continue
        kind = tab.kinds.get(e.r)
        value = e.value
        if kind and value not in (None, ""):
            try:
                value = int(value)
            except (TypeError, ValueError):
                pass
        text = ss.normalize_input(tab.validators[e.r] if e.r < len(tab.validators) else None,
                                  tab.titles[e.r], value, kind)
        if text is None:
            errors.append({"tab": e.tab, "r": e.r, "c": e.c, "code": "invalid", "value": e.value})
            continue
        by_model.setdefault(_model_name(e.tab), []).append((binding, text))
        labels = tab.labels[e.c] if tab.labels and e.c < len(tab.labels) else []
        if e.r in tab.wide_rows:
            labels = labels[:1]
        items.append({"binding": binding, "value": text, "labels": [x for x in labels if x], "title": tab.titles[e.r]})
    if errors:
        return JSONResponse(status_code=400, content={"code": "invalid_cells", "detail": "Some values are not valid.",
                                                      "cells": errors})

    if not body.confirmed and md is not None:
        try:
            warnings = plausibility.check(items, md.machine_id)
        except Exception:
            warnings = []
        if warnings:
            return {"kind": "confirm", "warnings": [w["text"] for w in warnings]}

    res = ss.save_series_edits(user, series_id, by_model, unit_scales=extra.get("unit_scales"))
    log_usage_event("feature", "show_experiment_save", f"web {sum(len(v) for v in by_model.values())}")
    return {"kind": "saved", "saved": res.get("saved", 0), "failed": res.get("failed", [])}
