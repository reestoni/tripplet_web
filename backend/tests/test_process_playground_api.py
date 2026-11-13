"""Process Playground in the web (app/process_playground_api.py on ui/dty_whatif.py + ui/process_playground_core.py).
Only reads."""
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from db.connection import fetch_all


def _client():
    u = fetch_all("SELECT u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                  "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")[0]["UserName"]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u))
    return c


def test_flow():
    c = _client()
    d = c.get("/api/process-playground/data").json()
    assert d["combos"] and d["n_trials"] > 0 and set(d["params"]) == {"pressure", "of", "speed"}
    key = d["combos"][0]["key"]
    ci = c.get("/api/process-playground/combo", params={"key": key}).json()
    assert ci["options"] and ci["best"] is not None and ci["varied"]
    start = ci["options"][ci["best"]]["start"]
    ev = c.post("/api/process-playground/evaluate", json={"key": key, "start": start, "moved": start}).json()
    assert ev["changed"] == [] and "move" in ev["warnings"] and len(ev["rows"]) == len(d["targets"])
    p = ci["varied"][0]
    r = ci["ranges"][p]
    moved = {**start, p: r["hi"] if abs(start[p] - r["hi"]) > 1e-9 else r["lo"]}
    ev = c.post("/api/process-playground/evaluate", json={"key": key, "start": start, "moved": moved}).json()
    assert ev["changed"] == [p] and any(row["statement"] for row in ev["rows"])
    ch = c.post("/api/process-playground/chart", json={"key": key, "start": ev["start"], "new": ev["new"],
                                                       "target": "fpm", "param": p}).json()
    assert "chart" in ch
    f = c.post("/api/process-playground/find", json={"key": key, "start": start, "goals": {"fpm": "keep"},
                                                     "main": "stab10", "direction": "up"}).json()
    assert f["targets"][:1] == ["stab10"] and "fpm" in f["targets"] and "message" in f
    assert c.get("/api/process-playground/combo", params={"key": "x|y"}).json()["code"] == "not_found"
    assert c.post("/api/process-playground/find", json={"key": key, "start": start, "main": "zz", "direction": "up"}).json()["code"] == "bad_request"


def test_trial_and_series_flag():
    c = _client()
    d = c.get("/api/process-playground/data").json()
    from app import process_playground_api as api
    ds = api._dataset()
    row = next(r for r in ds.rows if (r.get("yarn_key"), r.get("jet_id")) in ds.combos)
    t = c.get(f"/api/process-playground/trial/{row['trial_id']}").json()
    assert t["key"] in {x["key"] for x in d["combos"]} and set(t["start"]) == {"pressure", "of", "speed"}
    assert c.get("/api/process-playground/trial/999999999").json()["code"] == "trial_unusable"
    sid = fetch_all("SELECT TrialSeriesID FROM tbltrial WHERE ID = ?", [row["trial_id"]])[0]["TrialSeriesID"]
    assert c.get(f"/api/series/{sid}").json()["playground"] is True
