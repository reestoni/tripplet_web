"""stock_take_api.py - Yarn Stock stock take in the browser (desktop ui/widgets/stock_take_round_dialog.py +
ui/widgets/stock_take_dialog.py) on db/stock_take.py.

Rounds: superusers start / close them and leave locations out; checking a location (scan view) needs write
access (level 2), like the desktop. During a check the browser holds the scans; corrections (move a spool,
put a discarded spool back) are written at once, missing spools are discarded only at Finish on an explicit
choice. The server re-checks rights, result codes and that only spools in stock are discarded."""
from __future__ import annotations

import re
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db import stock_take as st  # noqa: E402
from db import yarn_stock as ys  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/yarn-stock/stock-take")
FEATURE = "yarn_stock"


def _err(status: int, code: str, detail: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail, **extra})


def _su(user) -> bool:
    return int(user.get("access_level") or 0) >= 4


def _num(v):
    return float(v) if isinstance(v, Decimal) else v


def _spools():
    stock = ys.load_stock()
    if stock is None:
        raise RuntimeError("tblYarn / tblYarnSpool missing")
    return {int(s["ID"]): s for s in stock["spools"] if s.get("ID") is not None}, stock["yarn_names"]


def _round_out(r: Dict) -> Dict:
    return {"id": r["ID"], "name": r["Name"], "open": r.get("ClosedAt") is None, "started": st.when_text(r.get("StartedAt")),
            "closed": st.when_text(r.get("ClosedAt")) if r.get("ClosedAt") else None, "started_by": r.get("StartedByName") or ""}


@router.get("")
def overview(round_id: Optional[int] = None, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """Rounds, the chosen (default: open, else latest) round with its location tiles and results."""
    out: Dict[str, Any] = {"available": st.available(), "can_write": ys.can_write(user), "superuser": _su(user),
                           "rounds": [], "round": None, "racks": [], "items": [], "summary": None}
    if not out["available"]:
        return out
    rounds = st.list_rounds()
    out["rounds"] = [_round_out(r) for r in rounds]
    if round_id is None:
        r = next((x for x in rounds if x.get("ClosedAt") is None), rounds[0] if rounds else None)
    else:
        r = next((x for x in rounds if x["ID"] == round_id), None)
    if r is None:
        return out
    out["round"] = _round_out(r)
    locs = st.round_locations(r["ID"])
    items = st.round_items(r["ID"])
    spools, names = _spools()
    by_loc: Dict[str, List[Dict]] = {}
    for it in items:
        by_loc.setdefault(it["Location"], []).append(it)
    now_count: Dict[str, int] = {}
    if r.get("ClosedAt") is None:
        for s in spools.values():
            if s.get("Status") == "in stock":
                k = st.norm_location(s.get("Location"))
                now_count[k] = now_count.get(k, 0) + 1
    rows = {l["Location"]: l for l in locs}
    racks = []
    for rack, levels in st.group_locations(rows):
        lv_out = []
        for level, lvlocs in levels:
            tiles = []
            for loc, col in st.tile_columns(lvlocs):
                row = rows[loc]
                its = by_loc.get(loc, [])
                state = st.location_status(row, its)
                devs = [i for i in its if st.is_deviation(i.get("Result") or "")]
                tiles.append({
                    "location": loc, "col": col, "state": state, "excluded": row["Excluded"],
                    "checked_at": st.when_text(row.get("CheckedAt")) if row.get("CheckedAt") else None,
                    "checked_by": row.get("CheckedByName") or "",
                    "found": int(row.get("Found") or 0), "expected": int(row.get("Expected") or 0),
                    "extra": sum(1 for i in its if i.get("Result") not in (st.FOUND, st.MISSING_KEPT, st.MISSING_DISCARDED)),
                    "now": now_count.get(loc, 0),
                    "devs": [{"spool_id": i.get("SpoolID"), "result": i["Result"], "detail": i.get("Detail") or ""} for i in devs[:8]],
                    "more_devs": max(0, len(devs) - 8),
                })
            lv_out.append({"level": level, "tiles": tiles})
        done = sum(1 for lv in levels for loc in lv[1] if st.location_status(rows[loc], by_loc.get(loc, [])) in (st.ST_OK, st.ST_DEVIATION))
        todo = sum(1 for lv in levels for loc in lv[1] if not rows[loc]["Excluded"])
        racks.append({"rack": rack, "done": done, "todo": todo, "levels": lv_out})
    out["racks"] = racks
    resolved = st.resolve_missing(items)
    out["items"] = []
    for n, it in enumerate(items):
        sid = it.get("SpoolID")
        s = spools.get(int(sid)) if sid is not None else None
        out["items"].append({
            "location": it["Location"], "spool_id": sid,
            "yarn": names.get(int(s.get("YarnID") or -1), "?") if s else "", "batch": (s.get("Charge") or "") if s else "",
            "result": it["Result"], "detail": it.get("Detail") or "", "seen_at": resolved.get(n, ""),
            "deviation": st.is_deviation(it.get("Result") or ""), "by_hand": it.get("Detail") == st.BY_HAND_NOTE,
            "checked_by": it.get("CheckedByName") or "", "checked_at": st.when_text(it.get("CheckedAt"))})
    out["summary"] = st.summarize(locs, items)
    return out


@router.get("/locations")
def all_locations(user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """Every location (for the start dialog), grouped by rack."""
    if not _su(user):
        return _err(403, "superuser_only", "Only superusers start a stock take round.")
    return {"racks": [{"rack": rack, "locations": [l for _lv, locs in levels for l in locs]}
                      for rack, levels in st.group_locations(st.all_locations())]}


class StartBody(BaseModel):
    name: str
    excluded: List[str] = []


@router.post("/start")
def start(body: StartBody, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    if not _su(user):
        return _err(403, "superuser_only", "Only superusers start a stock take round.")
    try:
        rid = st.start_round(body.name, st.all_locations(), body.excluded)
    except st.StockTakeError:
        return _err(409, "round_open", "A stock take round is already open. Close it first.")
    return {"id": rid}


class RoundBody(BaseModel):
    round_id: int


def _open_round(round_id: int) -> Optional[Dict]:
    r = st.get_round(round_id)
    return r if r is not None and r.get("ClosedAt") is None else None


@router.post("/close")
def close(body: RoundBody, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    if not _su(user):
        return _err(403, "superuser_only", "Only superusers close a stock take round.")
    if _open_round(body.round_id) is None:
        return _err(409, "round_closed", "The round is not open.")
    st.close_round(body.round_id)
    return {"ok": True}


class ExcludeBody(BaseModel):
    round_id: int
    location: str
    excluded: bool


@router.post("/exclude")
def exclude(body: ExcludeBody, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    if not _su(user):
        return _err(403, "superuser_only", "Only superusers leave locations out.")
    if _open_round(body.round_id) is None:
        return _err(409, "round_closed", "The round is not open.")
    st.set_excluded(body.round_id, body.location, body.excluded)
    return {"ok": True}


@router.get("/spools")
def spools(_user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """All spools (any status) for the scan view - the expected list and every scanned number are resolved
    in the browser (like the desktop dialog, which works on the list loaded at its start)."""
    sp, names = _spools()
    return {"spools": [{"id": i, "yarn": names.get(int(s.get("YarnID") or -1), "?"), "batch": s.get("Charge") or "",
                        "location": s.get("Location") or "", "status": s.get("Status") or "", "weight": _num(s.get("WeightKg"))}
                       for i, s in sp.items()]}


class MoveBody(BaseModel):
    spool_id: int
    location: str


@router.post("/move")
def move(body: MoveBody, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """Found here, registered elsewhere -> move (written at once)."""
    if not ys.can_write(user):
        return _err(403, "read_only", "No write access (read-only).")
    sp, _n = _spools()
    s = sp.get(body.spool_id)
    new = st.norm_location(body.location)
    if s is None or s.get("Status") != "in stock" or not new:
        return _err(400, "bad_spool", "This spool cannot be moved.")
    st.move_spool(body.spool_id, new, s.get("Location"))
    return {"location": new}


@router.post("/restock")
def restock(body: MoveBody, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """Discarded spool found -> back in stock at the location (written at once)."""
    if not ys.can_write(user):
        return _err(403, "read_only", "No write access (read-only).")
    sp, _n = _spools()
    s = sp.get(body.spool_id)
    new = st.norm_location(body.location)
    if s is None or s.get("Status") == "in stock" or not new:
        return _err(400, "bad_spool", "This spool is not discarded.")
    st.restock_spool(body.spool_id, new, s.get("Location"))
    return {"location": new}


class Other(BaseModel):
    spool_id: int
    code: str
    detail: str = ""


class FinishBody(BaseModel):
    round_id: Optional[int] = None        # None = check without a round (nothing recorded)
    location: str
    expected_ids: List[int]
    found_ids: List[int] = []
    manual_ids: List[int] = []
    others: List[Other] = []
    discard_missing: bool = False


@router.post("/finish")
def finish(body: FinishBody, user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """Finish a check: optionally discard the missing spools, record the result in the round."""
    if not ys.can_write(user):
        return _err(403, "read_only", "No write access (read-only).")
    loc = st.norm_location(body.location)
    if body.round_id is not None:
        if _open_round(body.round_id) is None:
            return _err(409, "round_closed", "The stock take round was closed in the meantime - the result was not saved.")
    if any(o.code not in st.RESULT_LABELS for o in body.others):
        return _err(400, "bad_result", "Unknown result.")
    expected = list(dict.fromkeys(body.expected_ids))
    found = set(body.found_ids) & set(expected)
    manual = set(body.manual_ids) & found
    missing = [i for i in expected if i not in found]
    discarded = 0
    if body.discard_missing and missing:
        sp, _n = _spools()
        discarded = st.discard_missing([i for i in missing if sp.get(i, {}).get("Status") == "in stock"])
    if body.round_id is not None:
        items = [{"SpoolID": i, "Result": st.FOUND, "Detail": st.BY_HAND_NOTE if i in manual else None} for i in expected if i in found]
        items += [{"SpoolID": o.spool_id, "Result": o.code, "Detail": o.detail or None} for o in body.others]
        items += [{"SpoolID": i, "Result": st.MISSING_DISCARDED if body.discard_missing else st.MISSING_KEPT, "Detail": None}
                  for i in missing]
        try:
            st.save_check(body.round_id, loc, len(expected), items)
        except st.StockTakeError:
            return _err(409, "round_closed", "The stock take round was closed in the meantime - the result was not saved.")
    moved = sum(1 for o in body.others if o.code in (st.MOVED_HERE, st.MOVED_ELSEWHERE))
    back = sum(1 for o in body.others if o.code == st.RESTOCKED)
    log_usage_event("feature", "yarn_stock_stock_take",
                    f"web {loc}: {len(found)}/{len(expected)} found, {moved} moved, {back} back, {discarded} discarded")
    return {"discarded": discarded}


@router.get("/export")
def export(round_id: int, _user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    r = st.get_round(round_id)
    if r is None:
        return _err(404, "no_round", "Round not found.")
    sp, names = _spools()
    data = st.export_excel_bytes(r, st.round_locations(round_id, add_new=False), st.round_items(round_id), sp, names)
    st._log("stock_take_export", str(round_id))
    safe = re.sub(r"[^\w-]+", "_", r["Name"]).strip("_") or "stock_take"
    return Response(content=data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.xlsx"'})


@router.get("/parse")
def parse(text: str, _user: Dict[str, Any] = Depends(require_feature(FEATURE))):
    """Scan / typed text -> spool id (db/yarn_stock.parse_spool_input, also used by "Go to spool #")."""
    return {"spool_id": ys.parse_spool_input(text)}
