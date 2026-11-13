"""quick_scan_api.py - Requirement Hub / Quick Scan (/tools/requirement-hub; desktop ui/screen_requirement_hub.py +
ui/screen_quick_scan.py) on db/quick_scan.py (Qt-free, the desktop screen uses it).

The browser sends field REFERENCES ({"field_id"} or {"adhoc": {table, column, label, unit, tension}}) and values;
db/quick_scan.resolve_field builds the field dicts (table/column checked against the whitelist and
information_schema) - table and column names never come from the browser into SQL. The Athena advisor of the desktop
is not in the web (user decision: no AI in the web)."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db import quick_scan as qs  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402

router = APIRouter(prefix="/api/quick-scan")
_feature = require_feature("requirement_hub")


def _err(code: str, detail: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _field_json(f: Dict[str, Any]) -> Dict[str, Any]:
    ref: Dict[str, Any]
    if f.get("field_id") is not None:
        ref = {"field_id": f["field_id"]}
    else:
        ref = {"adhoc": {"table": f["source_table_primary"], "column": f["source_column"], "label": f["field_label"],
                         "unit": f.get("unit"), "tension": f.get("tension_filter")}}
    return {"ref": ref, "key": f["field_key"], "label": f["field_label"], "unit": f.get("unit") or "",
            "data_type": f.get("data_type") or "float", "tension": f.get("tension_filter"),
            "equal_default": f["field_key"] in qs.EQUAL_DEFAULTS, "adhoc": bool(f.get("_adhoc"))}


class RowIn(BaseModel):
    field: Dict[str, Any]
    operator: str = "between"
    value1: Any = None
    value2: Any = None
    target_type: str = "must"
    weight: Any = 1.0
    direction: str = "higher"
    target_val: Any = None


class RunIn(BaseModel):
    filters: List[RowIn] = []
    targets: List[RowIn] = []


def _rules(body: RunIn):
    """-> (filters, targets) as the evaluator takes them; incomplete rows are left out like in the desktop."""
    out = []
    for section, rows in (("filter", body.filters), ("target", body.targets)):
        lst = []
        for r in rows:
            f = qs.resolve_field(r.field)
            rule = qs.make_rule(f, r.operator, r.value1, r.value2, r.target_type, r.weight, r.direction,
                                r.target_val, section=section)
            if rule:
                lst.append(rule)
        out.append(lst)
    return out[0], out[1]


@router.get("/fields")
def fields(user: Dict[str, Any] = Depends(_feature)):
    log_usage_event("feature", "quick_scan_open", "web")
    return {"fields": [_field_json(f) for f in qs.load_fields()], "adhoc_tables": qs.adhoc_tables()}


@router.get("/fields/{field_id}/options")
def options(field_id: int, user: Dict[str, Any] = Depends(_feature)):
    f = qs.field_by_id(field_id)
    if f is None:
        return _err("not_found", "Unknown field.", 404)
    return {"options": [{"value": v, "label": lbl} for v, lbl in qs.lookup_options(f)]}


@router.get("/adhoc/columns")
def adhoc_columns(table: str, user: Dict[str, Any] = Depends(_feature)):
    return {"columns": [{"name": c, "type": t} for c, t in qs.adhoc_columns(table)]}


@router.post("/adhoc/field")
def adhoc_field(body: Dict[str, Any], user: Dict[str, Any] = Depends(_feature)):
    """Checks an ad-hoc column and returns its field (not registered until a ruleset is saved)."""
    try:
        return {"field": _field_json(qs.resolve_field({"adhoc": body}))}
    except (ValueError, TypeError):
        return _err("bad_field", "This column cannot be used.")


@router.post("/run")
def run(body: RunIn, user: Dict[str, Any] = Depends(_feature)):
    try:
        filters, targets = _rules(body)
    except (ValueError, TypeError):
        return _err("bad_field", "A field is unknown (reload the page).")
    if not filters and not targets:
        return _err("empty", "Please enter at least one filter or target.")
    try:
        results, w_t, d_t = qs.QuickScanEvaluator().run(filters, targets)
    except Exception as e:
        return _err("failed", str(e), 500)
    log_usage_event("feature", "quick_scan_run", "web")
    w_keys = {t["field"]["field_key"] for t in w_t}
    dyn = [{"key": t["field"]["field_key"], "label": qs.target_column_label(t), "weighted": t["field"]["field_key"] in w_keys}
           for t in w_t + d_t]
    rows = []
    for r in results:
        row = {k: r.get(k) for k, _l in qs.BASE_COLUMNS}
        row.update({"series_id": r.get("series_pk"), "trial_id": r.get("trial_id"), "score": r.get("_score")})
        row["values"] = {d["key"]: r.get(d["key"]) for d in dyn}
        row["contrib"] = {d["key"]: qs.contribution_pct(r, d["key"], w_t) for d in dyn if d["weighted"]}
        rows.append(row)
    return {"rows": rows, "has_score": bool(w_t), "dynamic": dyn, "n_filters": len(filters), "n_targets": len(targets),
            "n_weighted": len(w_t), "n_distance": len(d_t), "debug": qs.QuickScanEvaluator().build_debug_info(filters, targets)}


# ------------------------------------------------------------------ rulesets
@router.get("/rulesets")
def rulesets(user: Dict[str, Any] = Depends(_feature)):
    return {"rulesets": [{"id": s["set_id"], "name": s["set_name"], "description": s.get("description") or "",
                          "created_by": s.get("created_by") or "",
                          "created_at": s["created_at"].isoformat() if hasattr(s.get("created_at"), "isoformat") else s.get("created_at")}
                         for s in qs.list_rulesets()]}


class SaveIn(RunIn):
    name: str
    description: str = ""


@router.post("/rulesets")
def save(body: SaveIn, user: Dict[str, Any] = Depends(_feature)):
    name = body.name.strip()
    if not name:
        return _err("name_missing", "Please enter a name.")
    try:
        filters, targets = _rules(body)
    except (ValueError, TypeError):
        return _err("bad_field", "A field is unknown (reload the page).")
    if not filters and not targets:
        return _err("empty", "No filters or targets set.")
    set_id, n = qs.save_ruleset(name[:200], body.description.strip(), filters, targets, str(user.get("username") or ""))
    return {"id": set_id, "rules": n}


@router.get("/rulesets/{set_id}")
def ruleset(set_id: int, user: Dict[str, Any] = Depends(_feature)):
    rules = qs.load_ruleset(set_id)
    return {"rules": [{"section": r["section"], "field": _field_json(r["field"]), "target_type": r["rule_type"]
                       if r["section"] == "target" else "must", "operator": r["operator"], "value1": r["value1"],
                       "value2": r["value2"], "weight": r["weight"], "direction": r["direction"],
                       "target_val": r["target_val"]} for r in rules]}


@router.delete("/rulesets/{set_id}")
def delete(set_id: int, user: Dict[str, Any] = Depends(_feature)):
    qs.delete_ruleset(set_id)
    return {"ok": True}
