"""Jet Advisor (app/jet_advisor_api.py on ui/jet_advisor.py) against dev_local - only reads."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from db.connection import fetch_all


@pytest.fixture(scope="module")
def client():
    users = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                      "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID")
    if not users:
        pytest.skip("no superuser on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(users[0]["Username"]))
    return c


def test_options_and_advise(client):
    o = client.get("/api/jet-advisor/options").json()
    assert o["n_trials"] > 0 and o["yarns"] and o["jet_types"]
    yarn = o["yarns"][0]
    r = client.post("/api/jet-advisor/advise", json={"yarn_id": yarn["id"], "targets": {"fpm": {"lo": 1}}})
    assert r.status_code == 200
    d = r.json()
    assert d["targets"] == ["fpm"] and isinstance(d["results"], list)
    if d["results"]:
        top = d["results"][0]
        assert set(top["settings"]) == {"pressure", "of", "speed"} and "fpm" in top["preds"]
    # filter by jet type: only that type comes back
    types = [t["id"] for t in o["jet_types"] if t["id"]]
    if types:
        d = client.post("/api/jet-advisor/advise", json={"yarn_id": yarn["id"], "targets": {"fpm": {"lo": 1}},
                                                          "jet_types": [types[0]], "same_material": False,
                                                          "max_distance": 1.5}).json()
        assert all(x["type_id"] == types[0] for x in d["results"])


def test_errors(client):
    r = client.post("/api/jet-advisor/advise", json={"yarn_id": 1, "targets": {}})
    assert r.status_code == 400 and r.json()["code"] == "no_target"
    r = client.post("/api/jet-advisor/advise", json={"targets": {"fpm": {"lo": 80}}})
    assert r.status_code == 400 and r.json()["code"] == "no_yarn"


def test_needs_login():
    assert TestClient(app).get("/api/jet-advisor/options").status_code == 401
