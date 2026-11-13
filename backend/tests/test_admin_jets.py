"""Manage Jets in the web (app/admin_jets.py on db/jets_admin.py). Reads plus one real round trip on
dev_local: new jet, duplicate name refused, form update, table save, file upload into a temp folder,
quick-add of a FK value - everything is deleted again at the end."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import admin_jets, auth
from app.main import app

from db import jets_admin
from db.connection import execute, fetch_all


def _user(sql_where, params):
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     f"WHERE {sql_where} AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID", params)
    if not rows:
        pytest.skip("no matching user on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c


def _admin():
    return _user("ar.AccessLevel >= ?", [4])


@pytest.fixture(autouse=True)
def _no_usage_log(monkeypatch):
    monkeypatch.setattr(admin_jets, "log_usage_event", lambda *a: None)


def test_list_has_columns_lists_and_rights():
    d = _admin().get("/api/admin/jets").json()
    assert len(d["rows"]) > 0 and d["can_edit"] is True
    assert d["columns"][:2] == ["ID", "Jet"]
    assert "Luftbohrung" in d["numeric_columns"] and "Jet" not in d["numeric_columns"]
    assert "Hersteller" in d["fk"] and all(len(x) == 2 for x in d["fk"]["Hersteller"])
    assert d["bool_columns"] == [c for c in d["columns"] if jets_admin.is_bool_column(c)]
    # computed / audit columns are never editable, GlobalID / UsedInTrial not in the form
    assert "UsedInTrial" not in d["editable"] and "ID" not in d["editable"] and "CreatedBy" not in d["editable"]
    assert "GlobalID" not in d["form_columns"] and "UsedInTrial" not in d["form_columns"]
    assert all("has_files" in r for r in d["rows"][:5])


def test_audit_columns_only_for_superusers():
    d = _user("ar.AccessLevel BETWEEN ? AND ?", [1, 3]).get("/api/admin/jets")
    if d.status_code == 403:
        pytest.skip("this user has no Manage Jets right")
    assert not any(c.lower() in ("createdby", "creationdate") for c in d.json()["columns"])


def test_read_only_user_cannot_write():
    c = _user("ar.AccessLevel < ? AND COALESCE(u.AdminBox, 0) = 0", [3])
    d = c.get("/api/admin/jets")
    if d.status_code == 403:
        pytest.skip("this user has no Manage Jets right")
    assert d.json()["can_edit"] is False
    jid = d.json()["rows"][0]["ID"]
    for url, body in (("/api/admin/jets/save", {"rows": [{"id": jid, "values": {"Bemerkungen": "x"}}]}),
                      ("/api/admin/jets/new", {"values": {"Jet": "x"}}),
                      ("/api/admin/jets/delete", {"ids": [jid]}),
                      (f"/api/admin/jets/{jid}/update", {"values": {"Bemerkungen": "x"}})):
        r = c.post(url, json=body)
        assert r.status_code == 403 and r.json()["code"] == "read_only", url


def test_values_are_checked():
    c = _admin()
    jid = c.get("/api/admin/jets").json()["rows"][0]["ID"]
    for values in ({"Luftbohrung": "abc"}, {"Hersteller": 99999999}, {"UsedInTrial": 0}, {"ID": 5},
                   {"CreatedBy": 1}, {"NoSuchColumn": 1}):
        r = c.post("/api/admin/jets/save", json={"rows": [{"id": jid, "values": values}]})
        assert r.status_code == 400 and r.json()["code"] == "bad_value", values
    assert c.post("/api/admin/jets/new", json={"values": {"Jet": "  "}}).json()["code"] == "name_missing"


def test_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(jets_admin, "files_root", lambda: str(tmp_path))
    c = _admin()
    d = c.get("/api/admin/jets").json()
    existing = d["rows"][0]["Jet"]
    herst = d["fk"]["Hersteller"][0][0]
    name = f"__webtest_jet_{int(time.time())}"
    fk_new = None
    jid = None
    try:
        assert c.post("/api/admin/jets/new", json={"values": {"Jet": existing}}).json()["code"] == "name_taken"
        r = c.post("/api/admin/jets/new", json={"values": {"Jet": name, "Hersteller": herst, "Luftbohrung": "0,9",
                                                           "GebogenerKanal": True, "Bemerkungen": "web test"}})
        assert r.status_code == 200, r.text
        jid = r.json()["id"]
        row = fetch_all("SELECT * FROM tblDTYJets WHERE ID = ?", [jid])[0]
        assert row["Jet"] == name and float(row["Luftbohrung"]) == 0.9 and int(row["GebogenerKanal"]) == 1
        assert row["Hersteller"] == herst and row["GlobalID"] and row["CreationDate"]

        assert c.get("/api/admin/jets/name-check", params={"name": name}).json()["available"] is False
        assert c.get("/api/admin/jets/name-check", params={"name": name, "except_id": jid}).json()["available"] is True
        # form update: renaming onto an existing name is refused, own name is fine
        assert c.post(f"/api/admin/jets/{jid}/update", json={"values": {"Jet": existing}}).json()["code"] == "name_taken"
        assert c.post(f"/api/admin/jets/{jid}/update", json={"values": {"Jet": name, "Luftbohrung": ""}}).status_code == 200
        assert fetch_all("SELECT Luftbohrung FROM tblDTYJets WHERE ID = ?", [jid])[0]["Luftbohrung"] is None
        # table save
        r = c.post("/api/admin/jets/save", json={"rows": [{"id": jid, "values": {"Bemerkungen": "changed", "Hersteller": None}}]})
        assert r.status_code == 200 and r.json()["saved"] == 1
        row = fetch_all("SELECT Bemerkungen, Hersteller FROM tblDTYJets WHERE ID = ?", [jid])[0]
        assert row["Bemerkungen"] == "changed" and row["Hersteller"] is None
        assert c.get(f"/api/admin/jets/{jid}/usage").json() == {"series": []}

        # files (temp folder instead of the share)
        r = c.post(f"/api/admin/jets/{jid}/files", files=[("files", ("note.txt", b"hello jet", "text/plain"))])
        assert r.status_code == 200 and r.json()["errors"] == []
        files = c.get(f"/api/admin/jets/{jid}/files").json()["files"]
        assert len(files) == 1 and files[0]["name"] == "note.txt" and files[0]["exists"]
        assert c.get(f"/api/admin/jets/files/{files[0]['id']}").content == b"hello jet"
        assert any(r["ID"] == jid and r["has_files"] for r in c.get("/api/admin/jets").json()["rows"])
        assert c.delete(f"/api/admin/jets/files/{files[0]['id']}").status_code == 200
        assert c.get(f"/api/admin/jets/{jid}/files").json()["files"] == []

        # "+" next to a dropdown
        r = c.post("/api/admin/jets/fk", json={"column": "Hersteller", "name": name})
        fk_new = r.json()["id"]
        assert [fk_new, name] in r.json()["items"]
        assert c.post("/api/admin/jets/fk", json={"column": "Bemerkungen", "name": "x"}).json()["code"] == "bad_column"

        assert c.post("/api/admin/jets/delete", json={"ids": [jid]}).json()["deleted"] == 1
        jid = None
    finally:
        if jid is not None:
            execute("DELETE FROM tblJetFile WHERE JetID = ?", [jid])
            execute("DELETE FROM tblDTYJets WHERE ID = ?", [jid])
        if fk_new is not None:
            execute("DELETE FROM tblJetHersteller WHERE ID = ?", [fk_new])


def test_column_order_is_saved_per_user():
    c = _admin()
    before = c.get("/api/admin/jets").json()["column_order"]
    try:
        assert c.post("/api/admin/jets/column-order", json={"columns": ["Serie", "Hersteller"]}).status_code == 200
        assert c.get("/api/admin/jets").json()["column_order"][:2] == ["Serie", "Hersteller"]
    finally:
        c.post("/api/admin/jets/column-order", json={"columns": before})
