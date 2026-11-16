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


@pytest.mark.parametrize("kind", ["order_types", "product_groups", "material", "top_plates", "projects"])
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


def test_projects_rules():
    """Projects (2026-11-16): UsedBy is shown only, a project number exists once, a used project cannot be deleted."""
    c = _client()
    d = c.get("/api/admin/master/projects").json()
    assert "UsedBy" in d["columns"] and "UsedBy" not in d["editable"] and d["name_column"] == "ProjectName"
    used = [r for r in d["rows"] if r.get("UsedBy")]
    if used:
        r = c.post("/api/admin/master/projects/delete", json={"ids": [used[0]["ID"]]}).json()
        assert r["code"] == "in_use" and r["vars"]["experiments"] + r["vars"]["requests"] == used[0]["UsedBy"]
    other = next((r for r in d["rows"] if r.get("ProjectNumber") is not None), None)
    new_id = c.post("/api/admin/master/projects/new", json={}).json()["id"]
    try:
        if other:
            r = c.post("/api/admin/master/projects/save",
                       json={"rows": [{"id": new_id, "values": {"ProjectNumber": other["ProjectNumber"]}}]}).json()
            assert r["code"] == "number_taken"
        r = c.post("/api/admin/master/projects/save",
                   json={"rows": [{"id": new_id, "values": {"ProjectNumber": 999991, "ProjectName": "zz web project"}}]}).json()
        assert r["saved"] == 1
    finally:
        assert c.post("/api/admin/master/projects/delete", json={"ids": [new_id]}).json()["deleted"] == 1
    nav = c.get("/api/nav").json()
    assert any(it["route"] == "/admin/projects" and it["web"] for s in nav["sections"] for it in s["items"])
