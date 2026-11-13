"""Admin master tables in the web (app/admin_master.py on db/master_tables.py). Writes one row per table and deletes it."""
import pytest
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


@pytest.mark.parametrize("kind", ["order_types", "product_groups", "material", "top_plates"])
def test_roundtrip(kind):
    c = _client()
    d = c.get(f"/api/admin/master/{kind}").json()
    assert d["can_edit"] and d["name_column"] and "ID" not in d["editable"]
    assert "GlobalID" not in d["columns"]
    body = {"values": {"Name": "zz web master"}} if kind == "top_plates" else {}
    new_id = c.post(f"/api/admin/master/{kind}/new", json=body).json()["id"]
    try:
        name = d["name_column"]
        r = c.post(f"/api/admin/master/{kind}/save", json={"rows": [{"id": new_id, "values": {name: "zz web master 2"}}]}).json()
        assert r["saved"] == 1
        rows = c.get(f"/api/admin/master/{kind}").json()["rows"]
        assert next(x for x in rows if x["ID"] == new_id)[name] == "zz web master 2"
        assert c.post(f"/api/admin/master/{kind}/save", json={"rows": [{"id": new_id, "values": {"ID": 5}}]}).json()["code"] == "bad_value"
        if kind == "material":
            assert c.post(f"/api/admin/master/{kind}/save",
                          json={"rows": [{"id": new_id, "values": {"Lightfastness": "1.5"}}]}).json()["code"] == "bad_value"
            assert c.post(f"/api/admin/master/{kind}/save",
                          json={"rows": [{"id": new_id, "values": {"UsedInYarn": 1}}]}).json()["code"] == "bad_value"
        if kind == "top_plates":
            assert c.post(f"/api/admin/master/{kind}/new", json={"values": {"Name": "zz web master 2"}}).json()["code"] == "name_taken"
            assert c.get(f"/api/admin/master/top_plates/{new_id}/files").json()["files"] == []
    finally:
        assert c.post(f"/api/admin/master/{kind}/delete", json={"ids": [new_id]}).json()["deleted"] == 1


def test_unknown_and_usage():
    c = _client()
    assert c.get("/api/admin/master/tbluser").json()["code"] == "not_found"
    rows = c.get("/api/admin/master/material").json()["rows"]
    used = [r for r in rows if r.get("UsedInYarn")]
    if used:
        assert c.get(f"/api/admin/master/material/{used[0]['ID']}/usage").json()["yarns"]
