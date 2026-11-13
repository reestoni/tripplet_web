"""air_supply_api.py - Air Supply Network Calculator (/tools/air-supply; desktop ui/screen_air_supply.py) on
ui/air_network.py.

The browser keeps the drawn network (nodes + edges, the desktop's JSON) and sends it with every change; the
server solves it and answers with the computed values per node, the segment table, the source summary and
the warnings. Optimisation, PDF / Excel and the saved networks (tblAirNetwork / tblAirNetworkData, written by
the desktop too) are the desktop's. The web never creates the two tables."""
from __future__ import annotations

import datetime
import io
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import require_feature

from db import jets_admin  # noqa: E402
from db.usage_log import log_usage_event  # noqa: E402
from ui import air_network as an  # noqa: E402

an.ENSURE_TABLES = False          # web: never create tables
router = APIRouter(prefix="/api/air-supply")
_feature = require_feature("air_supply")
MAX_NODES = 500


def _err(code: str, detail: str, status: int = 400) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _jets_by_id() -> Dict[int, Dict[str, Any]]:
    return {int(j["ID"]): j for j in jets_admin.load_jets() if j.get("ID") is not None}


class GraphBody(BaseModel):
    graph: Dict[str, Any]
    opcost: Dict[str, float] = {}
    title: str = ""


def _graph(raw: Dict[str, Any], jets: Optional[Dict[int, Dict[str, Any]]] = None) -> an.NetworkGraph:
    nodes = [n for n in (raw.get("nodes") or []) if isinstance(n, dict) and n.get("kind") in an.NODE_KINDS][:MAX_NODES]
    ids = {str(n.get("id")) for n in nodes}
    edges = [[str(a), str(b)] for a, b in (raw.get("edges") or [])[:MAX_NODES * 4] if str(a) in ids and str(b) in ids and a != b]
    for n in nodes:
        n["id"] = str(n.get("id"))
    return an.NetworkGraph.from_json(json.dumps({"nodes": nodes, "edges": edges}), jets if jets is not None else _jets_by_id())


def _params(p: Dict[str, float]) -> Dict[str, float]:
    out = dict(an.OPCOST_DEFAULTS)
    for k in out:
        try:
            if k in p and float(p[k]) > 0:
                out[k] = float(p[k])
        except (TypeError, ValueError):
            pass
    return out


def _solved(g: an.NetworkGraph, params: Dict[str, float]) -> Dict[str, Any]:
    g.solve()
    return {"nodes": {nid: an.node_view(n) for nid, n in g.nodes.items()},
            "parents": {nid: len(g.parents(nid)) for nid in g.nodes},
            "table": an.results_rows(g), "source": an.source_summary(g, params), "warnings": g.validate()}


def _graph_json(g: an.NetworkGraph) -> Dict[str, Any]:
    return json.loads(g.to_json())


@router.get("/meta")
def meta(user: Dict[str, Any] = Depends(_feature)):
    jets = jets_admin.load_jets()
    defaults = {k: {kk: vv for kk, vv in an.Node(k).to_dict().items() if kk not in ("id", "x", "y")} for k in an.NODE_KINDS}
    return {"jets": [{"id": j.get("ID"), "name": str(j.get("Jet") or ""), "diam": str(j.get("Luftbohrung") or ""),
                      "holes": int(j.get("LuftlochAnzahl") or 1)} for j in jets if j.get("ID") is not None],
            "kinds": list(an.NODE_KINDS), "colors": an._NODE_COLORS, "sizes": an._NODE_SIZE, "defaults": defaults,
            "dn": an.DN_STANDARDS, "limits": {"v_min": an.V_MIN, "v_max": an.V_MAX, "dp_warn": an.DP_WARN, "dp_info": an.DP_INFO},
            "opcost": an.OPCOST_DEFAULTS, "saving": an.tables_available()}


@router.get("/example")
def example(user: Dict[str, Any] = Depends(_feature)):
    return {"graph": _graph_json(an.example_network())}


@router.post("/solve")
def solve(body: GraphBody, user: Dict[str, Any] = Depends(_feature)):
    return _solved(_graph(body.graph), _params(body.opcost))


@router.post("/optimize")
def optimize(body: GraphBody, user: Dict[str, Any] = Depends(_feature)):
    jets = _jets_by_id()
    g = _graph(body.graph, jets)
    g.solve()
    opt, diffs = an.optimize_graph(g)
    params = _params(body.opcost)
    changed = {d["node_id"]: f"{d['old_val']}→{d['new_val']}" for d in diffs if "info" not in d["param"]}
    log_usage_event("feature", "air_supply_optimize", f"web {len(changed)}")
    return {"diffs": diffs, "changed": changed, "cost": an.cost_compare(g, opt, params),
            "graph": _graph_json(opt), "solved": _solved(opt, params)}


def _file(data: bytes, name: str, mime: str) -> Response:
    return Response(data, media_type=mime, headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _safe(title: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (title or "Network").strip()) or "Network"


@router.post("/pdf")
def pdf(body: GraphBody, user: Dict[str, Any] = Depends(_feature)):
    g = _graph(body.graph)
    g.solve()
    _opt, diffs = an.optimize_graph(g)
    buf = io.BytesIO()
    an.generate_pdf(buf, g, body.title or "Air Supply Network", str(user.get("username") or ""), opt_diffs=diffs or None)
    log_usage_event("feature", "air_supply_pdf", "web")
    return _file(buf.getvalue(), f"AirSupply_{_safe(body.title)}.pdf", "application/pdf")


@router.post("/excel")
def excel(body: GraphBody, user: Dict[str, Any] = Depends(_feature)):
    g = _graph(body.graph)
    g.solve()
    buf = io.BytesIO()
    an.generate_excel(buf, g, body.title or "Air Supply Network")
    log_usage_event("feature", "air_supply_excel", "web")
    return _file(buf.getvalue(), f"AirSupply_{_safe(body.title)}.xlsx",
                 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


# ------------------------------------------------------------------ saved networks
@router.get("/networks")
def networks(user: Dict[str, Any] = Depends(_feature)):
    if not an.tables_available():
        return {"available": False, "networks": []}
    rows = an.db_list_networks()
    return {"available": True, "networks": [
        {"id": int(r["ID"]), "name": str(r.get("Name") or ""), "description": str(r.get("Description") or ""),
         "created_by": str(r.get("CreatedBy") or ""),
         "updated": r["UpdatedAt"].strftime("%Y-%m-%d %H:%M") if hasattr(r.get("UpdatedAt"), "strftime") else ""}
        for r in rows]}


@router.get("/networks/{network_id}")
def network(network_id: int, user: Dict[str, Any] = Depends(_feature)):
    if not an.tables_available():
        return _err("unavailable", "Saved networks are not available in this database.")
    g = an.db_load_network(network_id, _jets_by_id())
    row = next((r for r in an.db_list_networks() if int(r["ID"]) == network_id), None)
    if g is None or row is None:
        return _err("not_found", "This network no longer exists.", 404)
    return {"id": network_id, "name": str(row.get("Name") or ""), "description": str(row.get("Description") or ""),
            "graph": _graph_json(g)}


class SaveBody(BaseModel):
    name: str
    description: str = ""
    graph: Dict[str, Any]
    id: Optional[int] = None


@router.post("/networks")
def save(body: SaveBody, user: Dict[str, Any] = Depends(_feature)):
    if not an.tables_available():
        return _err("unavailable", "Saved networks are not available in this database.")
    name = (body.name or "").strip()[:120]
    if not name:
        return _err("no_name", "Please enter a name.")
    if body.id is not None and not any(int(r["ID"]) == body.id for r in an.db_list_networks()):
        return _err("not_found", "This network no longer exists.", 404)
    g = _graph(body.graph)
    nid = an.db_save_network(name, body.description or "", g, str(user.get("username") or "")[:20], body.id)
    log_usage_event("feature", "air_supply_save", "web")
    return {"id": int(nid), "name": name}


@router.delete("/networks/{network_id}")
def delete(network_id: int, user: Dict[str, Any] = Depends(_feature)):
    if not an.tables_available():
        return _err("unavailable", "Saved networks are not available in this database.")
    an.db_delete_network(network_id)
    return {"ok": True}
