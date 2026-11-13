"""yarn_stock_api.py - Yarn Stock in the browser (desktop ui/screen_yarn_stock.py) on db/yarn_stock.py.

Viewing = feature "yarn_stock"; writing (new spools, edit, discard, batch / producer of a group, label
queue, printing) from AccessLevel 2 like the desktop; MinStock only superusers. The browser sends ids and
values only; every write re-reads the spools from the database (old values for the change log, only
spools in stock are edited)."""
from __future__ import annotations

import datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db import label_sheets as ls  # noqa: E402
from db import yarn_stock as ys  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from db.yarn_colours import colour_css, load_yarn_colours  # noqa: E402

router = APIRouter(prefix="/api/yarn-stock")
FEATURE = "yarn_stock"
TEMPLATE_NAME = "Default"           # the desktop yarn label sheet


def _err(status: int, code: str, detail: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, **extra})


def _plain(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()[:10]
    if isinstance(v, set):
        return sorted(v)
    return v


def _stock():
    stock = ys.load_stock()
    if stock is None:
        raise RuntimeError("tblYarn / tblYarnSpool missing")
    return stock


def _write_guard(user) -> Optional[JSONResponse]:
    if not ys.can_write(user):
        return _err(403, "read_only", "No write access (read-only).")
    return None


def _superuser(user) -> bool:
    return int(user.get("access_level") or 0) >= 4


def _spool_out(s: Dict) -> Dict:
    return {"id": s["ID"], "weight": _plain(s.get("WeightKg")), "location": s.get("Location") or "",
            "colour": s.get("Colour") or "", "producer_id": s.get("ProducerID"),
            "received": _plain(s.get("ReceivedDate")), "status": s.get("Status") or ""}


@router.get("")
def overview(user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    stock = ys.load_stock()
    if stock is None:
        return _err(500, "tables_missing", "Table tblYarn or tblYarnSpool is missing in the database.")
    ys.refresh_notifications(stock)       # bell messages Low / Empty per yarn, like every desktop reload
    by_id, _by_name = load_yarn_colours()
    css = {yid: colour_css(c) for yid, c in by_id.items()}
    return {
        "overview": [{"yarn_id": g["YarnID"], "charge": g["Charge"], "yarn": g["YarnName"], "producers": g["Producers"],
                      "producer_ids": sorted(g["ProducerIDs"]), "count": g["Count"], "total_kg": round(g["TotalKg"], 3),
                      "yarn_total_kg": round(g["YarnTotalKg"], 3), "min_stock": g["MinStock"], "status": g["Status"],
                      "locations": g["Locations"], "css": css.get(g["YarnID"])} for g in stock["overview"]],
        "yarns": [{"id": i, "name": n, "css": css.get(i)} for i, n in stock["yarn_choices"]],
        "producers": [[i, n] for i, n in stock["producers"]],
        "queue": [{**q} for q in ys.queue_items(stock["yarn_names"])],
        "can_write": ys.can_write(user),
        "can_edit_minstock": bool(stock["minstock_col"]) and _superuser(user),
        "status_colors": ys.STATUS_COLOR,
    }


@router.get("/group")
def group(yarn_id: int, charge: str = "", _user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """The spools in stock of one yarn / batch (detail table)."""
    stock = _stock()
    return {"spools": [_spool_out(s) for s in ys.group_spools(stock, yarn_id, charge)]}


class GotoBody(BaseModel):
    text: str


@router.post("/goto")
def goto(body: GotoBody, _user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """"Go to spool #": number or scanned label -> its yarn / batch (discarded: say so)."""
    sid = ys.parse_spool_input(body.text)
    if sid is None:
        return _err(400, "bad_spool_input", "Please enter a spool number (e.g. 213) or scan a spool label.")
    stock = _stock()
    s = next((x for x in stock["spools"] if x.get("ID") == sid), None)
    if s is None:
        return _err(404, "spool_not_found", f"Spool #{sid} not found.", vars={"id": sid})
    log_usage_event("feature", "yarn_stock_goto_spool",
                    "number" if body.text.strip().lstrip("#").strip().isdigit() else "label_scan")
    return {"spool_id": sid, "yarn_id": int(s.get("YarnID") or -1), "charge": s.get("Charge") or "",
            "discarded": s.get("Status") != "in stock"}


@router.get("/rack")
def rack(prefix: str, _user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    rows = ys.rack_groups(_stock(), prefix)
    return {"rows": [{"yarn_id": g["YarnID"], "yarn": g["Yarn"], "charge": g["Batch"], "producers": g["ProducersDisp"],
                      "producer_ids": sorted(g["ProducerIDs"]), "count": g["Count"], "total_kg": round(g["Weight"], 3),
                      "locations": g["LocationsDisp"]} for g in rows]}


# ------------------------------------------------------------------ group edits (overview / rack)
class GroupBatch(BaseModel):
    yarn_id: int
    charge: str = ""
    new_charge: str


@router.post("/group/batch")
def group_batch(body: GroupBatch, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """Batch of ALL spools of this yarn with the old batch (also discarded ones), like the desktop."""
    bad = _write_guard(user)
    if bad:
        return bad
    new = body.new_charge.strip()
    if new == "–":
        new = ""
    ys.update_group_batch(body.yarn_id, body.charge, new, _stock()["spools"])
    return {"ok": True}


class GroupProducer(BaseModel):
    yarn_id: int
    charge: str = ""
    producer_id: Optional[int] = None


@router.post("/group/producer")
def group_producer(body: GroupProducer, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    bad = _write_guard(user)
    if bad:
        return bad
    stock = _stock()
    if body.producer_id is not None and body.producer_id not in stock["producer_map"]:
        return _err(400, "bad_producer", "Unknown producer.")
    ys.update_group_producer(body.yarn_id, body.charge, body.producer_id, stock["spools"], stock["producer_map"])
    return {"ok": True}


class MinStock(BaseModel):
    yarn_id: int
    value: Optional[float] = None


@router.post("/minstock")
def minstock(body: MinStock, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    if not _superuser(user):
        return _err(403, "minstock_superuser", "Only superusers can change the minimum stock.")
    if body.value is not None and body.value < 0:
        return _err(400, "bad_minstock", "Please enter a number of kg (0 or more), or leave the field empty.")
    ys.set_min_stock(body.yarn_id, body.value)
    log_usage_event("feature", "yarn_stock_edit_min_stock")
    return {"ok": True}


# ------------------------------------------------------------------ spools
class SpoolChange(BaseModel):
    id: int
    weight: Optional[str] = None          # sent only when changed
    location: Optional[str] = None
    colour: Optional[str] = None
    producer_id: Optional[int] = None
    set_producer: bool = False            # producer_id = None is a real value ("— none —")


class SaveBody(BaseModel):
    changes: List[SpoolChange]


@router.post("/spools/save")
def save_spools(body: SaveBody, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """Weight / location / tube colour / producer of single spools (only spools in stock), with change log."""
    bad = _write_guard(user)
    if bad:
        return bad
    stock = _stock()
    rows = {s["ID"]: s for s in stock["spools"]}
    weights, locs, cols, prods = {}, {}, {}, {}
    for ch in body.changes:
        s = rows.get(ch.id)
        if s is None or s.get("Status") != "in stock":
            return _err(400, "spool_not_editable", f"Spool #{ch.id} is not in stock.", vars={"id": ch.id})
        if ch.weight is not None:
            try:
                w = float(str(ch.weight).replace(",", "."))
            except ValueError:
                w = -1
            if w < 0:
                return _err(400, "bad_weight", f"Spool #{ch.id}: weight must be a number of kg (0 or more).",
                            vars={"id": ch.id})
            weights[ch.id] = w
        if ch.location is not None:
            locs[ch.id] = ch.location.strip()
        if ch.colour is not None:
            cols[ch.id] = ch.colour.strip()
        if ch.set_producer:
            if ch.producer_id is not None and ch.producer_id not in stock["producer_map"]:
                return _err(400, "bad_producer", "Unknown producer.")
            prods[ch.id] = ch.producer_id
    n = ys.save_spool_changes(weights, locs, cols, prods, rows, stock["producer_map"])
    log_usage_event("feature", "yarn_stock_save_changes", str(n))
    return {"updated": n}


class NewSpools(BaseModel):
    yarn_id: int
    charge: Optional[str] = None
    weight: float = 5.0
    count: int = 1
    location: Optional[str] = None
    colour: Optional[str] = None
    producer_id: Optional[int] = None
    add_to_queue: bool = True


@router.post("/spools/new")
def new_spools(body: NewSpools, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    bad = _write_guard(user)
    if bad:
        return bad
    stock = _stock()
    if body.yarn_id not in stock["yarn_names"]:
        return _err(400, "bad_yarn", "Unknown yarn.")
    if not (1 <= body.count <= 500) or not (0 <= body.weight <= 999999):
        return _err(400, "bad_new_spool", "Number of spools 1-500, weight 0 or more.")
    if body.producer_id is not None and body.producer_id not in stock["producer_map"]:
        return _err(400, "bad_producer", "Unknown producer.")
    vals = {"YarnID": body.yarn_id, "Charge": (body.charge or "").strip() or None, "WeightKg": body.weight,
            "Count": body.count, "Location": (body.location or "").strip() or None,
            "Colour": (body.colour or "").strip() or None, "ProducerID": body.producer_id}
    ids, err = ys.new_spools(vals, user.get("id"))
    if err is not None and not ids:
        return _err(500, "new_failed", f"The new spools could not be created: {err}")
    log_usage_event("feature", "yarn_stock_new_spools", str(len(ids)))
    queued = 0
    if body.add_to_queue and ids:
        queued = ys.queue_labels(ids, user.get("id"), {q["SpoolID"] for q in ys.queue_items(stock["yarn_names"])})
        if queued:
            log_usage_event("feature", "yarn_stock_add_to_label_queue", f"{queued} (new spools)")
    return {"ids": ids, "queued": queued, "charge": vals["Charge"] or "",
            "partial_error": str(err) if err is not None else None}


class Ids(BaseModel):
    ids: List[int]


@router.post("/spools/discard")
def discard(body: Ids, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    bad = _write_guard(user)
    if bad:
        return bad
    in_stock = {s["ID"] for s in _stock()["spools"] if s.get("Status") == "in stock"}
    ids = [i for i in body.ids if i in in_stock]
    n = ys.discard_spools(ids)
    log_usage_event("feature", "yarn_stock_discard", str(n))
    return {"discarded": n}


class ProducerBody(BaseModel):
    name: str


@router.post("/producers")
def new_producer(body: ProducerBody, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    bad = _write_guard(user)
    if bad:
        return bad
    if not body.name.strip():
        return _err(400, "name_missing", "Please enter a name.")
    new_id = ys.create_producer(body.name)
    if new_id is None:
        return _err(500, "producer_failed", "Could not create producer — table tblYarnProducer might be missing.")
    return {"id": new_id, "producers": [[i, n] for i, n in ys.producers()]}


@router.post("/used-in")
def used_in(body: Ids, _user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    log_usage_event("feature", "yarn_stock_used_in", str(len(body.ids)))
    return {"rows": [{"spool_id": r["SpoolID"], "experiment": r.get("ExperimentIDTxt"), "series_id": r.get("TrialSeriesID"),
                      "vno": r.get("Versuchsnummer"), "ply": r.get("Ply") or ""} for r in ys.used_in(body.ids)]}


class HistoryBody(BaseModel):
    ids: List[int] = []
    yarn_id: Optional[int] = None         # whole batch incl. discarded spools when no ids are given
    charge: str = ""


@router.post("/history")
def history(body: HistoryBody, _user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    ids = list(body.ids)
    if not ids and body.yarn_id is not None:
        ids = [int(s["ID"]) for s in ys.group_spools(_stock(), body.yarn_id, body.charge, in_stock_only=False)]
    from db import yarn_spool_log
    log_usage_event("feature", "yarn_stock_history", str(len(ids)))
    rows = ys.history(ids)
    return {"available": yarn_spool_log.log_table_exists(),
            "rows": [{"when": r["ChangedAt"].strftime("%Y-%m-%d %H:%M") if hasattr(r.get("ChangedAt"), "strftime") else str(r.get("ChangedAt") or ""),
                      "user": r.get("Username") or "–", "spool_id": r.get("SpoolID"), "change": ys.describe_history(r)}
                     for r in rows]}


# ------------------------------------------------------------------ label queue + printing
@router.post("/queue/add")
def queue_add(body: Ids, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    bad = _write_guard(user)
    if bad:
        return bad
    stock = _stock()
    added = ys.queue_labels(body.ids, user.get("id"), {q["SpoolID"] for q in ys.queue_items(stock["yarn_names"])})
    log_usage_event("feature", "yarn_stock_add_to_label_queue", str(added))
    return {"added": added}


@router.post("/queue/remove")
def queue_remove(body: Ids, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    bad = _write_guard(user)
    if bad:
        return bad
    ys.remove_from_queue(body.ids)
    return {"ok": True}


@router.get("/labels/template")
def labels_template(_user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    return {"template": {k: ls.load_label_template(TEMPLATE_NAME).get(k) for k, _l in ls.TEMPLATE_FIELDS},
            "fields": [[k, label] for k, label in ls.TEMPLATE_FIELDS]}


def _clean_template(tpl: Dict[str, float]) -> Optional[Dict[str, float]]:
    keys = {k for k, _l in ls.TEMPLATE_FIELDS}
    try:
        if set(tpl) != keys or any(not (0 <= float(v) <= 2000) for v in tpl.values()):
            return None
    except (TypeError, ValueError):
        return None
    out = {k: float(v) for k, v in tpl.items()}
    out["ColumnCount"], out["RowCount"] = int(out["ColumnCount"]), int(out["RowCount"])
    return out if out["ColumnCount"] >= 1 and out["RowCount"] >= 1 else None


class TemplateBody(BaseModel):
    template: Dict[str, float]


@router.post("/labels/template")
def save_template(body: TemplateBody, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    bad = _write_guard(user)
    if bad:
        return bad
    tpl = _clean_template(body.template)
    if tpl is None:
        return _err(400, "bad_template", "The sheet settings are not valid.")
    ls.save_label_template(TEMPLATE_NAME, tpl)
    return {"ok": True}


class PrintBody(BaseModel):
    start_index: int = 0
    template: Dict[str, float]


@router.post("/labels/pdf")
def labels_pdf(body: PrintBody, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """PDF of the whole queue from the chosen start cell; the queued labels are then marked printed
    (desktop: after the file is written)."""
    bad = _write_guard(user)
    if bad:
        return bad
    tpl = _clean_template(body.template)
    if tpl is None:
        return _err(400, "bad_template", "The sheet settings are not valid.")
    items = ys.queue_items(_stock()["yarn_names"])
    if not items:
        return _err(400, "queue_empty", "The label queue is empty.")
    data = ys.labels_pdf(items, tpl, max(0, body.start_index))
    ys.mark_printed([it["QueueID"] for it in items])
    log_usage_event("feature", "yarn_stock_print_labels", f"web {len(items)}")
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": 'inline; filename="yarn_labels.pdf"'})


# ------------------------------------------------------------------ Excel
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/export/overview")
def export_overview(search: str = "", status: str = "", _user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """The overview as filtered on the page (search in yarn / batch, status)."""
    q = search.strip().lower()
    rows = [g for g in _stock()["overview"]
            if (not q or q in g["YarnName"].lower() or q in (g["Charge"] or "").lower()) and (not status or g["Status"] == status)]
    log_usage_event("feature", "yarn_stock_export_excel", "overview")
    return Response(content=ys.overview_xlsx(rows), media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="yarn_stock_overview.xlsx"'})


@router.get("/export/rack")
def export_rack(prefix: str, _user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    p = prefix.strip().upper()
    rows = ys.rack_groups(_stock(), p)
    if not rows:
        return _err(404, "rack_empty", f"No spools found in rack '{p}'.", vars={"rack": p})
    log_usage_event("feature", "yarn_stock_export_excel", "rack")
    return Response(content=ys.rack_xlsx(rows, p), media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="rack_{p}.xlsx"'})
