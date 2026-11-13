"""Requirement Hub / Quick Scan in the web (app/quick_scan_api.py on db/quick_scan.py). The ruleset test writes a
ruleset (and maybe an ad-hoc field) and removes them again."""
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from db.connection import execute, fetch_all


def _client():
    u = fetch_all("SELECT u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                  "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")[0]["UserName"]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u))
    return c


def _fields(c):
    d = c.get("/api/quick-scan/fields").json()
    return {f["key"]: f for f in d["fields"]}, d["adhoc_tables"]


def test_run_and_checks():
    c = _client()
    f, tables = _fields(c)
    assert "tbltrial" in tables
    body = {"filters": [{"field": f["titer"]["ref"], "operator": "=", "value1": "167"}],
            "targets": [{"field": f["stabilitaet_10"]["ref"], "operator": "between", "value1": 50, "value2": 100,
                         "target_type": "weighted", "weight": 1, "direction": "higher"},
                        {"field": f["knoten_per_m"]["ref"], "operator": "between", "value1": 10, "value2": 150, "target_type": "distance"}]}
    r = c.post("/api/quick-scan/run", json=body).json()
    assert r["has_score"] and r["n_weighted"] == 1 and r["n_distance"] == 1 and len(r["dynamic"]) == 2
    assert all(x["titer"] == 167 for x in r["rows"])
    scores = [x["score"] for x in r["rows"]]
    assert scores == sorted(scores, reverse=True)
    # nothing filled in / unknown or forbidden fields
    assert c.post("/api/quick-scan/run", json={"filters": [{"field": f["titer"]["ref"]}]}).json()["code"] == "empty"
    bad = {"filters": [{"field": {"adhoc": {"table": "tbluser", "column": "Password"}}, "operator": "=", "value1": 1}]}
    assert c.post("/api/quick-scan/run", json=bad).json()["code"] == "bad_field"
    bad = {"filters": [{"field": {"adhoc": {"table": "tbltrial", "column": "x` = 1 OR 1=1 -- "}}, "operator": "=", "value1": 1}]}
    assert c.post("/api/quick-scan/run", json=bad).json()["code"] == "bad_field"
    assert c.post("/api/quick-scan/adhoc/field", json={"table": "tbltrial", "column": "AirPressure"}).json()["field"]["adhoc"]
    cols = c.get("/api/quick-scan/adhoc/columns", params={"table": "tbluser"}).json()["columns"]
    assert cols == []
    lk = next(x for x in f.values() if x["data_type"] == "lookup")
    assert c.get(f"/api/quick-scan/fields/{lk['ref']['field_id']}/options").json()["options"]


def test_ruleset_roundtrip():
    c = _client()
    f, _t = _fields(c)
    key = "adhoc__tbltrial__AirPressure"
    existed = bool(fetch_all("SELECT field_id FROM tblrequirementfield WHERE field_key=%s", [key]))
    adhoc = c.post("/api/quick-scan/adhoc/field", json={"table": "tbltrial", "column": "AirPressure", "unit": "bar"}).json()["field"]
    body = {"name": "zz web test", "description": "pytest",
            "filters": [{"field": f["titer"]["ref"], "operator": "=", "value1": 167},
                        {"field": adhoc["ref"], "operator": "between", "value1": 1, "value2": 5}],
            "targets": [{"field": f["stabilitaet_10"]["ref"], "operator": "between", "value1": 50, "value2": 100,
                         "target_type": "weighted", "weight": 2, "direction": "exact", "target_val": 80}]}
    s = c.post("/api/quick-scan/rulesets", json=body).json()
    sid = s["id"]
    try:
        assert s["rules"] == 3
        assert any(x["id"] == sid for x in c.get("/api/quick-scan/rulesets").json()["rulesets"])
        rules = c.get(f"/api/quick-scan/rulesets/{sid}").json()["rules"]
        assert [r["section"] for r in rules] == ["filter", "filter", "target"]
        assert rules[1]["field"]["adhoc"] and rules[1]["field"]["ref"].get("field_id")
        assert rules[2]["direction"] == "exact" and rules[2]["target_val"] == 80 and rules[2]["weight"] == 2
        assert c.post("/api/quick-scan/rulesets", json={**body, "name": " "}).json()["code"] == "name_missing"
        c.delete(f"/api/quick-scan/rulesets/{sid}")
        assert not any(x["id"] == sid for x in c.get("/api/quick-scan/rulesets").json()["rulesets"])
    finally:
        execute("DELETE FROM tblrequirementrule WHERE set_id=%s", [sid])
        execute("DELETE FROM tblrequirementset WHERE set_id=%s", [sid])
        if not existed:
            execute("DELETE FROM tblrequirementfield WHERE field_key=%s", [key])
