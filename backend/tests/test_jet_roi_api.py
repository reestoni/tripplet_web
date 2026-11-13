"""Jet ROI Calculator in the web (app/jet_roi_api.py on ui/jet_roi.py). Only reads tbljets."""
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


def test_single_and_pdf():
    c = _client()
    m = c.get("/api/jet-roi/meta").json()
    assert m["currencies"][0]["code"] == "CHF" and set(m["jets"]) == {"DTY", "ATY", "Spinning"}
    jet = next(j for j in m["jets"]["DTY"] if j["diam"])
    body = {"process": "DTY", "positions": "100", "comp_type": "X", "comp_diam": "1.3", "comp_holes": "1",
            "comp_pressure": {"value": "58", "unit": "PSI"}, "heb_jet_id": jet["id"], "heb_holes": "1",
            "heb_pressure": {"value": "4", "unit": "bar"}}
    r = c.post("/api/jet-roi/single", json=body).json()
    assert r["result"]["comp_p_unit"] == "PSI" and abs(r["result"]["comp_pressure"] - 58 / 14.5038) < 1e-9
    assert r["chart"]["years"] == [0, 1, 2, 3, 4, 5] and r["result"]["heb_type"] == jet["name"]
    assert c.post("/api/jet-roi/single", json={**body, "comp_type": ""}).json()["code"] == "comp_type"
    assert c.post("/api/jet-roi/single", json={**body, "heb_jet_id": None}).json()["code"] == "heb_jet"
    p = c.post("/api/jet-roi/single/pdf", json=body)
    assert p.status_code == 200 and p.content[:4] == b"%PDF"


def test_multi():
    c = _client()
    jets = [j for j in c.get("/api/jet-roi/meta").json()["jets"]["DTY"] if j["diam"]][:2]
    body = {"process": "DTY", "rows": [{"label": "A", "pos": "10", "hours": "8000", "a_jet_id": jets[0]["id"],
                                        "b_jet_id": jets[1]["id"], "a_price": "0", "b_price": "100"}]}
    r = c.post("/api/jet-roi/multi", json=body).json()
    assert len(r["results"]) == 1 and r["totals"]["invest"] == 1000 and r["chart"]["b"][0] == 1000
    assert c.post("/api/jet-roi/multi", json={"rows": [{"label": "x"}]}).json()["code"] == "no_rows"
    assert c.post("/api/jet-roi/multi/pdf", json=body).content[:4] == b"%PDF"
