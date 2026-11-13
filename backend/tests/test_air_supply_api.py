"""Air Supply Network in the web (app/air_supply_api.py on ui/air_network.py). The save test writes one
network into tblAirNetwork / tblAirNetworkData and deletes it again."""
import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from db.connection import fetch_all
from ui import air_network as an


def _client():
    u = fetch_all("SELECT u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                  "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")[0]["UserName"]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u))
    return c


def test_meta_example_solve_optimize_reports():
    c = _client()
    m = c.get("/api/air-supply/meta").json()
    assert set(m["kinds"]) == {"source", "segment", "split", "reducer", "jet"} and m["defaults"]["segment"]["seg_length"] == 5.0
    g = c.get("/api/air-supply/example").json()["graph"]
    s = c.post("/api/air-supply/solve", json={"graph": g}).json()
    assert len(s["nodes"]) == 9 and s["source"]["n_jets"] == 3 and s["warnings"] == [] and len(s["table"]["rows"]) == 3
    # a jet from the DB
    jet = next(n for n in g["nodes"] if n["kind"] == "jet")
    jet["nozzle_db_jet_id"] = m["jets"][0]["id"]
    s2 = c.post("/api/air-supply/solve", json={"graph": g, "opcost": {"price": 0.5}}).json()
    assert s2["nodes"][jet["id"]]["label"].startswith(m["jets"][0]["name"])
    assert s2["source"]["opcost"]["cost_chf"] > s["source"]["opcost"]["cost_chf"] * 0  # computed
    # junk is dropped, not an error
    junk = {"nodes": g["nodes"] + [{"id": "x", "kind": "evil"}], "edges": g["edges"] + [["x", g["nodes"][0]["id"]], ["a", "a"]]}
    assert len(c.post("/api/air-supply/solve", json={"graph": junk}).json()["nodes"]) == 9
    o = c.post("/api/air-supply/optimize", json={"graph": g}).json()
    assert "diffs" in o and "cost" in o and o["solved"]["source"]["n_jets"] == 3
    assert c.post("/api/air-supply/pdf", json={"graph": g, "title": "Test"}).content[:4] == b"%PDF"
    assert c.post("/api/air-supply/excel", json={"graph": g, "title": "Test"}).content[:2] == b"PK"


def test_save_load_delete():
    if not an.tables_available():
        pytest.skip("no tblAirNetwork on dev_local")
    c = _client()
    g = c.get("/api/air-supply/example").json()["graph"]
    assert c.post("/api/air-supply/networks", json={"name": " ", "graph": g}).json()["code"] == "no_name"
    r = c.post("/api/air-supply/networks", json={"name": "zz web test", "description": "d", "graph": g}).json()
    try:
        assert any(n["id"] == r["id"] for n in c.get("/api/air-supply/networks").json()["networks"])
        back = c.get(f"/api/air-supply/networks/{r['id']}").json()
        assert back["name"] == "zz web test" and len(back["graph"]["nodes"]) == 9
        r2 = c.post("/api/air-supply/networks", json={"name": "zz web test 2", "graph": g, "id": r["id"]}).json()
        assert r2["id"] == r["id"]
    finally:
        c.delete(f"/api/air-supply/networks/{r['id']}")
    assert c.get(f"/api/air-supply/networks/{r['id']}").json()["code"] == "not_found"
    assert not fetch_all("SELECT 1 FROM tblAirNetworkData WHERE NetworkID = ?", [r["id"]])
