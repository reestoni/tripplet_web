"""Manage User (superusers) in the web (app/user_admin_api.py on db/user_admin.py + db/feature_access.py).
Round trip with a test user (name fits the short UserName column), removed at the end; the access rules
are put back exactly as they were."""
from __future__ import annotations

import random

import pytest
from fastapi.testclient import TestClient

from app import auth, user_admin_api
from app.main import app

from db import feature_access as fa
from db import user_admin as ua
from db.connection import execute, fetch_all


def _client(where, params):
    rows = fetch_all("SELECT u.ID, u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     f"WHERE {where} AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID", params)
    if not rows:
        pytest.skip("no matching user on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["UserName"]))
    return c, int(rows[0]["ID"])


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(user_admin_api, "log_usage_event", lambda *a: None)


def test_superuser_only():
    c, _ = _client("ar.AccessLevel BETWEEN ? AND ?", [1, 3])
    assert c.get("/api/superuser/users").json()["code"] == "superuser_only"
    assert c.post("/api/superuser/users/delete", json={"ids": [1]}).json()["code"] == "superuser_only"


def test_list_hides_passwords_and_ai_columns():
    c, me = _client("ar.AccessLevel >= ?", [4])
    d = c.get("/api/superuser/users").json()
    low = {h.lower() for h in d["columns"]}
    assert not low & {"pw_hash", "pw", "api_key_enc", "token_limit", "tokens_used", "displaysettings"}
    assert all("pw_hash" not in r for r in d["rows"])
    assert d["me"] == me and d["roles"]["username"]


def test_normalize_colour():
    assert ua.normalize_colour("57,166,80") == "#39A650"
    assert ua.normalize_colour("#abc") == "#AABBCC"
    assert ua.normalize_colour("nonsense") == "" and ua.normalize_colour(None) == ""


def test_round_trip():
    c, me = _client("ar.AccessLevel >= ?", [4])
    d = c.get("/api/superuser/users").json()
    max_len = d["username_max"] or 32
    name = ("w" + str(random.randint(1000, 9999)))[:max_len]
    if name.lower() in ua.existing_usernames():
        pytest.skip("random test name taken")
    rights = d["fk"][d["roles"]["access"]]
    uid = None
    try:
        assert c.post("/api/superuser/users/new", json={"username": name, "password": name, "repeat": name}).json()["code"] == "bad_password"
        assert c.post("/api/superuser/users/new", json={"username": "x" * (max_len + 1), "password": "pw1!", "repeat": "pw1!"}).json()["code"] == "name_too_long"
        r = c.post("/api/superuser/users/new", json={"username": name, "first": "Web", "last": "Test", "access_id": rights[0][0],
                                                      "password": "Secret-1", "repeat": "Secret-1"})
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        row = fetch_all("SELECT * FROM tblUser WHERE ID = ?", [uid])[0]
        assert row["UserName"] == name and int(row["Active"]) == 1 and row["pw_hash"] and row["pw_hash"] != "Secret-1"
        taken = next(r["UserName"] for r in fetch_all("SELECT UserName FROM tblUser WHERE ID <> ? AND UserName IS NOT NULL", [uid]))
        assert c.post("/api/superuser/users/new", json={"username": taken, "password": "a1", "repeat": "a1"}).json()["code"] == "name_taken"

        r = c.post("/api/superuser/users/save", json={"rows": [{"id": uid, "values": {"Colour": "10,20,30", "Active": False, "LastName": "Tested"}}]})
        assert r.status_code == 200, r.text
        row = fetch_all("SELECT Colour, Active, LastName FROM tblUser WHERE ID = ?", [uid])[0]
        assert row["Colour"] == "#0A141E" and int(row["Active"]) == 0 and row["LastName"] == "Tested"
        bad = c.post("/api/superuser/users/save", json={"rows": [{"id": uid, "values": {"UserName": taken}}]})
        assert bad.json()["code"] == "bad_value"
        assert c.post("/api/superuser/users/save", json={"rows": [{"id": uid, "values": {"pw_hash": "x"}}]}).json()["code"] == "bad_value"

        assert c.post(f"/api/superuser/users/{uid}/password", json={"password": "a", "repeat": "b"}).json()["code"] == "bad_password"
        before = fetch_all("SELECT pw_hash FROM tblUser WHERE ID = ?", [uid])[0]["pw_hash"]
        assert c.post(f"/api/superuser/users/{uid}/password", json={"password": "Other-2", "repeat": "Other-2"}).status_code == 200
        assert fetch_all("SELECT pw_hash FROM tblUser WHERE ID = ?", [uid])[0]["pw_hash"] != before

        assert c.post("/api/superuser/users/delete", json={"ids": [me]}).json()["code"] == "delete_self"
        assert c.post("/api/superuser/users/delete", json={"ids": [uid]}).json()["deleted"] == 1
        uid = None
    finally:
        if uid is not None:
            execute("DELETE FROM tblUser WHERE ID = ?", [uid])


def test_access_rules_round_trip():
    if not fa.available():
        pytest.skip("tblFeatureAccess missing")
    c, _ = _client("ar.AccessLevel >= ?", [4])
    before = fa.load_all()
    g0 = {int(k): v for k, v in before["group_rules"].items()}
    u0 = {int(k): v for k, v in before["user_rules"].items()}
    a = c.get("/api/superuser/users/access").json()
    grp = a["groups"][0]["id"]
    try:
        r = c.post("/api/superuser/users/access", json={"group_rules": {**{str(k): v for k, v in g0.items()}, str(grp): {"canvas": False}},
                                                         "user_rules": {str(k): v for k, v in u0.items()}})
        assert r.status_code == 200
        assert fa.load_all()["group_rules"][grp]["canvas"] is False
    finally:
        fa.save_all(g0, u0)
    after = fa.load_all()
    assert {int(k): v for k, v in after["group_rules"].items()} == g0 and {int(k): v for k, v in after["user_rules"].items()} == u0
