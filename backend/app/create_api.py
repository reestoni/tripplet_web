"""create_api.py - Create Experiment / Add Trial Series / Add Lab Machines in the browser.

All lists, rules and the writing come from db/experiment_create.py (shared with the desktop's
ui/screen_create_experiment.py), the trial writing from db/trial_actions.insert_trials. The browser
sends only ids and typed values; tables / columns (lab tables, machine fields) are always taken from
the server-side catalogs, never from the request.

Rights: the desktop feature keys (db/feature_access.py) - new_experiment, add_series,
add_lab_machines - one per mode.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import can_use, current_user

from db import experiment_create as ec  # noqa: E402
from db import trial_actions as ta  # noqa: E402
from db.connection import fetch_all  # noqa: E402
from db.series_actions import series_jet_groups  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from db.yarn_colours import colour_css  # noqa: E402
from db.yarn_spools import (  # noqa: E402
    get_available_spools, load_series_spool_ids, load_spools_in_stock, spool_label, tube_colour_candidates)

router = APIRouter(prefix="/api/create")

# legacy = desktop "Legacy Import (Manual ID)" (hidden sidebar button, Ctrl+Shift+J) - same right as New Experiment;
# addtrials = Show Experiment "+T" (no feature key on the desktop: write access, trial_actions.can_edit_trials)
FEATURE = {"create": "new_experiment", "legacy": "new_experiment", "addseries": "add_series",
           "addlab": "add_lab_machines"}
MODES = set(FEATURE) | {"addtrials"}


def _err(status: int, code: str, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, **extra})


def _may(user: Dict[str, Any], mode: str) -> bool:
    if mode == "addtrials":
        return ta.can_edit_trials(user)
    return can_use(user, FEATURE[mode])


def _allowed(user: Dict[str, Any], mode: str) -> Optional[JSONResponse]:
    if mode not in MODES:
        return _err(400, "bad_mode", "Unknown mode.")
    if not _may(user, mode):
        return _err(403, "forbidden", "You are not allowed to use this.")
    return None


def _any_allowed(user: Dict[str, Any]) -> Optional[JSONResponse]:
    if not any(_may(user, m) for m in MODES):
        return _err(403, "forbidden", "You are not allowed to use this.")
    return None


def _yarn_ok(yarn_id: int, catalog: set) -> bool:
    """Catalog yarn or a "+ Trial" (semi-finished) yarn."""
    return yarn_id in catalog or ec.is_shadow_yarn(yarn_id)


def _lab_catalog() -> Dict[int, Dict[str, Any]]:
    return {int(r["LMID"]): r for r in (ta.load_lab_machines() or [])}


def _lab_json(r: Dict[str, Any], mode: str) -> Dict[str, Any]:
    return {"id": int(r["LMID"]), "name": str(r.get("LMName") or "").strip(),
            "caption": (r.get("AddField") or "").strip(), "unit": (r.get("AddUnit") or "").strip(),
            "input": ec.lab_input(r, mode), "freeform": ec.is_series_freeform(r)}


def _entry_json(e: Dict[str, Any]) -> Dict[str, Any]:
    return {"lm_id": int(e["LMID"]), "name": e.get("Name", ""), "disp": e.get("AdditionalDisp", ""),
            "value": e.get("AdditionalVal"), "freeform": ec.is_series_freeform(e)}


def _entries_in(entries: List["LabEntry"], catalog: Dict[int, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Client list -> lab_data (catalog columns) with the display text the desktop keeps."""
    data = ec.lab_data_from([{"LMID": e.lm_id, "AdditionalVal": e.value} for e in entries], catalog)
    for d, e in zip(data, entries):
        d["AdditionalDisp"] = e.disp
    return data


# ------------------------------------------------------------------ form data
@router.get("/setup")
def setup(mode: str = "create", series: Optional[int] = None, user: Dict[str, Any] = Depends(current_user)):
    """Everything the form needs at once (lists + trees). addtrials: ?series=<id>."""
    bad = _allowed(user, mode)
    if bad:
        return bad
    out: Dict[str, Any] = {"mode": mode, "access_level": int(user.get("access_level") or 0)}
    lab = ta.load_lab_machines() or []
    out["lab_machines"] = [_lab_json(r, mode) for r in lab]
    out["tensions"] = list(ec.ITEMAT_TENSIONS)
    if mode == "addtrials":
        info = ec.addtrials_setup(series) if series else None
        if info is None:
            return _err(404, "no_series", "Trial series not found.")
        out["series_info"] = {k: v for k, v in info.items() if k != "lab"}
        out["series_lab"] = [_entry_json(e) for e in info["lab"]]
    if mode in ("addseries", "addlab"):
        out["experiments"] = [{"id": e["id"], "label": e["label"], "machine_id": e["machine_id"]}
                              for e in ec.existing_experiments()]
    if mode in ("create", "legacy"):
        out["product_groups"] = ec.product_groups()
        out["order_types"] = ec.order_types()
        out["projects"] = ec.projects()
        out["requests"] = ec.open_requests() if mode == "create" else []
    if mode in ("create", "legacy", "addseries", "addtrials"):
        statuses = ec.backlog_statuses()
        out["backlog_statuses"] = statuses
        out["backlog_default"] = ec.default_backlog_status(statuses)
        out["machines"] = ec.machines()
        out["housings"] = ec.housings()
        out["yarn_uses"] = ec.yarn_uses()
        tree = ec.yarn_tree()
        for g in tree["groups"]:
            for y in g["yarns"]:
                y["css"] = colour_css(y["colour"]) or ""
        out["yarns"] = tree
        out["jets"] = ec.jet_tree()
        out["max_plies"] = ec.MAX_PLIES
        out["max_plates"] = ec.MAX_PLATES
    return out


@router.get("/next-number")
def next_number(pg: int, ot: int, user: Dict[str, Any] = Depends(current_user)):
    bad = _allowed(user, "create")
    if bad:
        return bad
    import datetime
    return {"number": ec.next_experiment_number(str(datetime.datetime.now().year), pg, ot)}


@router.get("/request-project/{request_id}")
def request_project(request_id: int, user: Dict[str, Any] = Depends(current_user)):
    bad = _allowed(user, "create")
    if bad:
        return bad
    return {"project_id": ec.request_project(request_id)}


@router.get("/machine-fields/{machine_id}")
def machine_fields(machine_id: int, user: Dict[str, Any] = Depends(current_user)):
    bad = _any_allowed(user)
    if bad:
        return bad
    return {"fields": ec.machine_fields(machine_id)}


@router.get("/experiments/{exp_id}/series")
def experiment_series(exp_id: int, user: Dict[str, Any] = Depends(current_user)):
    bad = _any_allowed(user)
    if bad:
        return bad
    return {"series": ec.series_of_experiment(exp_id)}


@router.get("/series/{series_id}/trials")
def series_trials(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    bad = _allowed(user, "addlab")
    if bad:
        return bad
    return {"trials": [{"id": t["id"], "label": t["label"]} for t in ec.trials_of_series(series_id)]}


@router.get("/series/{series_id}/jets")
def series_jets(series_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Jet rows of a series for "copy trial series" (desktop open_addseries_prefill)."""
    bad = _allowed(user, "addseries")
    if bad:
        return bad
    names = {h["id"]: h["name"] for h in ec.housings()}
    rows = series_jet_groups(series_id, names)
    exp = fetch_all("SELECT ExperimentID FROM tblTrialSeries WHERE ID = ?", [series_id])
    return {"experiment_id": exp[0]["ExperimentID"] if exp else None, "jets": [{"jet_id": r["JetID"], "jet": r.get("JetName", ""), "housing_id": r.get("HousingID"),
                      "housing": r.get("HousingName", ""), "plates": r.get("PlateList", ""),
                      "pressure": r.get("Pressure", "")} for r in rows]}


@router.get("/spools/{yarn_id}")
def spools(yarn_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Spools of a yarn for the optional spool choice when adding it (desktop SpoolPickerDialog)."""
    bad = _any_allowed(user)
    if bad:
        return bad
    rows = get_available_spools(yarn_id)
    return {"spools": [{"id": r["ID"], "label": spool_label(r)} for r in rows],
            "in_stock": any(r.get("Status") == "in stock" for r in rows)}


@router.get("/stock/{yarn_id}")
def stock(yarn_id: int, series: Optional[int] = None, user: Dict[str, Any] = Depends(current_user)):
    """Where the spools of a yarn are (desktop YarnLocationsDialog): spools in stock sorted by
    location; `assigned` = spools of ?series= (Show Experiment) - the form marks its chosen spools itself."""
    bad = _any_allowed(user)
    if bad:
        return bad
    rows = load_spools_in_stock(yarn_id)
    assigned = load_series_spool_ids(series) if series else set()
    return {"yarn": ec.yarn_name(yarn_id), "spools": [{
        "id": int(r["ID"]), "location": (r.get("Location") or "").strip(), "batch": str(r.get("Charge") or ""),
        "kg": float(r["WeightKg"]) if r.get("WeightKg") is not None else None,
        "tube": (r.get("Colour") or "").strip(), "tube_colours": tube_colour_candidates(r.get("Colour")),
        "received": str(r.get("ReceivedDate") or "")[:10], "assigned": int(r["ID"]) in assigned} for r in rows]}


@router.get("/legacy-id")
def legacy_id(id: str, user: Dict[str, Any] = Depends(current_user)):
    """Legacy import: typed 'YYYY-<PGOT>-NNN' -> parts (the form selects product group / order type)."""
    bad = _allowed(user, "legacy")
    if bad:
        return bad
    parsed = ec.parse_legacy_id(id)
    if not parsed:
        return _err(400, "legacy_format", "Expected YYYY-<PGOT>-NNN (e.g. 2019-73-002).")
    year, pg, ot, num = parsed
    return {"year": year, "product_group": pg, "order_type": ot, "number": num,
            "taken": ec.legacy_id_taken(year, pg, ot, num)}


@router.get("/trials-search")
def trials_search(q: str = "", user: Dict[str, Any] = Depends(current_user)):
    """"+ Trial": trials whose experiment ID / series name / machine contain every word (desktop TrialPickerDialog)."""
    bad = _any_allowed(user)
    if bad:
        return bad
    rows = ec.search_trials(q.strip()) if q.strip() else []
    return {"trials": [{"id": int(r["TrialID"]), "label": ec.trial_label(r)} for r in rows]}


class TrialPly(BaseModel):
    trial_id: int


@router.post("/trial-yarn")
def trial_yarn(body: TrialPly, user: Dict[str, Any] = Depends(current_user)):
    """"+ Trial": the semi-finished yarn of a trial (created once, then reused - get_or_create_shadow_yarn)."""
    bad = _any_allowed(user)
    if bad:
        return bad
    try:
        yid = ec.get_or_create_shadow_yarn(body.trial_id)
    except Exception as e:
        return _err(500, "trial_yarn_failed", f"The yarn entry for this trial could not be created: {e}")
    if yid is None:
        return _err(404, "no_trial", "Could not find this trial.")
    log_usage_event("feature", "web_trial_ply", str(body.trial_id))
    return {"yarn_id": yid, "name": ec.yarn_name(yid)}


# ------------------------------------------------------------------ form rules
class Material(BaseModel):
    yarn_id: int
    name: str = ""          # only for messages
    ply: str = ""
    use_id: Optional[int] = None
    spool_id: Optional[int] = None


class PlyBody(BaseModel):
    materials: List[Material] = []
    yarn_id: int
    series_id: Optional[int] = None     # add trials: ply numbers of the series count


def _series_ctx(series_id: Optional[int]):
    """(ply offset, series) for the ply rule - add trials counts on from the series' plies."""
    if not series_id:
        return 0, None
    return ta.series_ply_offset(series_id), series_id


@router.post("/ply")
def ply(body: PlyBody, user: Dict[str, Any] = Depends(current_user)):
    """Ply label for the next yarn (same yarn = same ply) or the conflict text."""
    bad = _any_allowed(user)
    if bad:
        return bad
    offset, sid = _series_ctx(body.series_id)
    label, conflict = ec.ply_label_for([{"YarnID": m.yarn_id, "Ply": m.ply, "Name": m.name} for m in body.materials],
                                       body.yarn_id, offset, sid)
    if conflict:
        return {"ply": label, "conflict": {"code": getattr(conflict, "code", ""), "text": str(conflict),
                                           "vars": getattr(conflict, "vars", {})}}
    return {"ply": label, "conflict": None}


class PliesBody(BaseModel):
    yarn_ids: List[int]
    series_id: Optional[int] = None


@router.post("/plies")
def plies(body: PliesBody, user: Dict[str, Any] = Depends(current_user)):
    """Ply labels of the Material list after a row was removed (db/experiment_create.renumber_plies)."""
    bad = _any_allowed(user)
    if bad:
        return bad
    offset, sid = _series_ctx(body.series_id)
    return {"plies": ec.renumber_plies([{"YarnID": y} for y in body.yarn_ids], offset, sid)}


class LabEntry(BaseModel):
    lm_id: int
    value: Optional[float] = None
    disp: str = ""


class LabPlanBody(BaseModel):
    mode: str
    entries: List[LabEntry] = []
    lm_id: int
    text: str = ""
    tensions: List[float] = []
    trial_ids: List[int] = []


@router.post("/lab-entries")
def lab_entries(body: LabPlanBody, user: Dict[str, Any] = Depends(current_user)):
    """The "+" of the Lab Machines tab: new entries (db/experiment_create.plan_lab_entries)."""
    bad = _allowed(user, body.mode)
    if bad:
        return bad
    catalog = _lab_catalog()
    meta = catalog.get(body.lm_id)
    if meta is None:
        return _err(400, "bad_lab", "Unknown lab machine.")
    if any(t not in ec.ITEMAT_TENSIONS for t in body.tensions):
        return _err(400, "bad_value", "Unknown tension.")
    try:
        pending = _entries_in(body.entries, catalog)
    except ValueError as e:
        return _err(400, "bad_lab", str(e))
    desk_mode = {"addlab": "addlabmachines"}.get(body.mode, body.mode)
    new, msg = ec.plan_lab_entries(meta, desk_mode, pending, body.text, body.tensions,
                                   body.trial_ids if body.mode == "addlab" else [])
    if msg:
        return _err(400, getattr(msg, "code", "") or "lab_input", str(msg), vars=getattr(msg, "vars", {}))
    return {"entries": [_entry_json(e) for e in new]}


class LabDeleteBody(BaseModel):
    entries: List[LabEntry]
    index: int


@router.post("/lab-can-delete")
def lab_can_delete(body: LabDeleteBody, user: Dict[str, Any] = Depends(current_user)):
    bad = _any_allowed(user)
    if bad:
        return bad
    catalog = _lab_catalog()
    try:
        data = _entries_in(body.entries, catalog)
    except ValueError as e:
        return _err(400, "bad_lab", str(e))
    return {"ok": ec.can_delete_lab_entry(data, body.index, catalog)}


# ------------------------------------------------------------------ saving
class Jet(BaseModel):
    jet_id: int
    housing_id: Optional[int] = None
    plates: str           # "1,2,3"
    pressure: str


class SaveBody(BaseModel):
    mode: str                                   # create | legacy | addseries | addtrials
    product_group: Optional[int] = None
    order_type: Optional[int] = None
    legacy_id: str = ""                         # legacy: typed experiment ID
    request_id: Optional[int] = None
    project_id: Optional[int] = None
    experiment_id: Optional[int] = None
    series_id: Optional[int] = None             # addtrials
    series_name: str = ""
    backlog_status: Optional[int] = None
    backlog_prio: Optional[int] = None
    machine_id: Optional[int] = None
    machine_values: Dict[str, Any] = {}
    materials: List[Material] = []
    jets: List[Jet] = []
    lab: List[LabEntry] = []


def _check_save(body: SaveBody) -> Optional[JSONResponse]:
    """The desktop's tab checks + the input rules of its widgets, on the server."""
    if body.mode != "addtrials" and not body.series_name.strip():
        return _err(400, "no_series_name", "Series name missing.")
    if body.mode in ("create", "legacy"):
        if body.mode == "legacy":
            parsed = ec.parse_legacy_id(body.legacy_id)
            if not parsed:
                return _err(400, "legacy_format", "Expected YYYY-<PGOT>-NNN (e.g. 2019-73-002).")
            if ec.legacy_id_taken(*parsed):
                return _err(400, "legacy_taken", f"Experiment {body.legacy_id} exists already.",
                            vars={"id": body.legacy_id.strip()})
            body.product_group, body.order_type = parsed[1], parsed[2]
            body.request_id = None              # the desktop ignores a request in legacy mode
        if body.product_group not in {p["id"] for p in ec.product_groups()}:
            return _err(400, "no_product_group", "Product group missing.")
        if body.order_type not in {o["id"] for o in ec.order_types()}:
            return _err(400, "no_order_type", "Order type missing.")
        if body.request_id is not None and body.request_id not in {r["id"] for r in ec.open_requests()}:
            return _err(400, "bad_request", "This experiment request is no longer open.")
        if body.project_id is not None and body.project_id not in {p["id"] for p in ec.projects()}:
            return _err(400, "bad_project", "Unknown project.")
    elif body.mode == "addseries":
        if body.experiment_id not in {e["id"] for e in ec.existing_experiments()}:
            return _err(400, "no_experiment", "Experiment missing.")
    if body.machine_id is None or body.machine_id not in {m["id"] for m in ec.machines()}:
        return _err(400, "no_machine", "Machine missing.")
    statuses = {s["id"] for s in ec.backlog_statuses()}
    if body.backlog_status is not None and body.backlog_status not in statuses:
        return _err(400, "bad_status", "Unknown backlog status.")
    if body.backlog_prio is not None and body.backlog_prio not in (1, 2, 3):
        return _err(400, "bad_prio", "Priority 1, 2 or 3.")
    if not body.materials:
        return _err(400, "no_material", "Please add at least one material.")
    # MAX_PLIES is checked before each "+" (as on the desktop, where the ends
    # of the last yarn may go beyond it) - not here
    yarns = {y["id"] for g in ec.yarn_tree()["groups"] for y in g["yarns"]}
    uses = {u["id"] for u in ec.yarn_uses()}
    offset, sid = _series_ctx(body.series_id if body.mode == "addtrials" else None)
    done: List[Dict[str, Any]] = []
    for m in body.materials:
        if not _yarn_ok(m.yarn_id, yarns):
            return _err(400, "bad_yarn", "Unknown yarn.")
        expected, conflict = ec.ply_label_for(done, m.yarn_id, offset, sid)
        if conflict or m.ply != expected:
            return _err(400, "bad_ply", str(conflict or f"Expected {expected}."), vars={"ply": expected})
        if m.use_id is not None and m.use_id not in uses:
            return _err(400, "bad_use", "Unknown yarn use.")
        if m.spool_id is not None and m.spool_id not in {r["ID"] for r in get_available_spools(m.yarn_id)}:
            return _err(400, "bad_spool", "This spool is not available.")
        done.append({"YarnID": m.yarn_id, "Ply": m.ply})
    if not body.jets:
        return _err(400, "no_jet", "Please add at least one jet.")
    jets = {j["id"] for g in ec.jet_tree() for j in g["jets"]}
    housings = {h["id"] for h in ec.housings()}
    for j in body.jets:
        if j.jet_id not in jets:
            return _err(400, "bad_jet", "Unknown jet.")
        if j.housing_id not in housings:
            return _err(400, "no_housing", "Every jet needs a housing.")
        msg = ec.check_jet({"JetID": j.jet_id, "HousingID": j.housing_id, "PlateList": j.plates, "Pressure": j.pressure})
        if msg:
            return _err(400, "bad_jet_row", msg)
    return None


@router.post("/save")
def save(body: SaveBody, user: Dict[str, Any] = Depends(current_user)):
    """New experiment (create / legacy), new series (addseries) or new trials in a series
    (addtrials) - each in one transaction."""
    if body.mode not in ("create", "legacy", "addseries", "addtrials"):
        return _err(400, "bad_mode", "Unknown mode.")
    bad = _allowed(user, body.mode)
    if bad:
        return bad
    info = None
    if body.mode == "addtrials":
        info = ec.addtrials_setup(body.series_id) if body.series_id else None
        if info is None:
            return _err(404, "no_series", "Trial series not found.")
        body.machine_id = info["machine_id"]     # the series' machine, never the client's
    bad = _check_save(body)
    if bad:
        return bad
    catalog = _lab_catalog()
    try:
        lab_data = _entries_in(body.lab, catalog)
        trial_vals, settings_vals = ec.machine_field_values(body.machine_id, body.machine_values)
    except ValueError as e:
        return _err(400, "bad_input", str(e))
    jets = [{"JetID": j.jet_id, "HousingID": j.housing_id, "PlateList": j.plates,
             "Pressure": j.pressure.strip().replace(",", ".")} for j in body.jets]
    materials = [{"YarnID": m.yarn_id, "Ply": m.ply, "YarnUseID": m.use_id, "SpoolID": m.spool_id}
                 for m in body.materials]
    try:
        if info is not None:
            ids = ta.add_trials(info["series_id"], jets, materials, lab_data, trial_vals, settings_vals)
            res = {"experiment_id": info["experiment_id"], "series_id": info["series_id"],
                   "label": info["experiment_label"], "trial_ids": ids}
        else:
            res = ec.create(
                body.mode, series_name=body.series_name.strip(), machine_id=body.machine_id,
                jets=jets, materials=materials, lab_data=lab_data, trial_values=trial_vals,
                settings_values=settings_vals, product_group=body.product_group, order_type=body.order_type,
                request_id=body.request_id, project_id=body.project_id, experiment_id=body.experiment_id,
                backlog_status=body.backlog_status, backlog_prio=body.backlog_prio, user_id=user.get("id"),
                legacy_id=body.legacy_id.strip() if body.mode == "legacy" else None)
    except Exception as e:  # rolled back in ec.create / ta.add_trials
        return _err(500, "save_failed", f"The experiment could not be saved: {e}")
    log_usage_event("feature", "web_create_experiment", f"{body.mode} series {res['series_id']}")
    return {"experiment_id": res["experiment_id"], "series_id": res["series_id"], "label": res["label"],
            "trials": len(res["trial_ids"])}


class LabSaveBody(BaseModel):
    series_id: int
    trial_ids: List[int] = []
    lab: List[LabEntry]


@router.post("/lab-save")
def lab_save(body: LabSaveBody, user: Dict[str, Any] = Depends(current_user)):
    """Add Lab Machines: lab rows for the ticked trials (+ Jet Air Consumption rows of the series)."""
    bad = _allowed(user, "addlab")
    if bad:
        return bad
    if not body.lab:
        return _err(400, "no_lab", "Please add at least one lab machine.")
    try:
        lab_data = _entries_in(body.lab, _lab_catalog())
    except ValueError as e:
        return _err(400, "bad_lab", str(e))
    valid = {t["id"] for t in ec.trials_of_series(body.series_id)}
    if any(t not in valid for t in body.trial_ids):
        return _err(400, "bad_trial", "These trials are not in the series.")
    if any(not ec.is_series_freeform(d) for d in lab_data) and not body.trial_ids:
        return _err(400, "no_trials", "Please tick at least one trial.")
    try:
        res = ec.add_lab_machines(body.series_id, body.trial_ids, lab_data, user.get("id"))
    except Exception as e:
        return _err(500, "save_failed", f"The lab machines could not be saved: {e}")
    log_usage_event("feature", "web_add_lab_machines", f"series {body.series_id}")
    ja = res["jet_air"]
    return {"created": res["created"], "skipped": res["skipped"],
            "jet_air": ja if any(ja.values()) else None}
