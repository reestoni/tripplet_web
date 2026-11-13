"""Manage Yarn in the web (app/admin_yarn.py on db/yarn_admin.py). Reads, rights, the duplicate check
and one real round trip on dev_local (new yarn, form update, table save, delete) - removed again at the end."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import admin_yarn, auth
from app.main import app

from db import yarn_admin
from db.connection import execute, fetch_all


def _user(sql_where, params):
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     f"WHERE {sql_where} AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID", params)
    if not rows:
        pytest.skip("no matching user on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c


def _super():
    return _user("ar.AccessLevel >= ?", [4])


@pytest.fixture(autouse=True)
def _no_usage_log(monkeypatch):
    monkeypatch.setattr(admin_yarn, "log_usage_event", lambda *a: None)


def test_list_columns_rights_and_dpf():
    d = _super().get("/api/admin/yarn").json()
    sp = d["special"]
    assert d["can_delete"] and d["can_edit_minstock"]
    assert "SourceTrialID" not in d["columns"] and d["labels"].get(sp["colour"]) == "Colour"
    assert sp["minstock"] in d["editable"]
    for c in (sp["dpf"], sp["usedintrial"], sp["stockkg"], "ID", "GlobalID", sp["createdby"]):
        assert c not in d["editable"]
    assert sp["garntyp"] in d["fk"] and sp["colour"] in d["fk"]
    r = next(r for r in d["rows"] if r[sp["endtiter"]] and r[sp["filaments"]])
    assert abs(r[sp["dpf"]] - r[sp["endtiter"]] / r[sp["filaments"]]) < 0.001


def test_normal_user_minstock_locked_no_delete_no_audit():
    c = _user("ar.AccessLevel BETWEEN ? AND ? AND COALESCE(u.AdminBox, 0) = 0", [1, 2])
    r = c.get("/api/admin/yarn")
    if r.status_code == 403:
        pytest.skip("this user has no Manage Yarn right")
    d = r.json()
    sp = d["special"]
    assert not d["can_delete"] and not d["can_edit_minstock"]
    assert sp["minstock"] not in d["editable"] and sp["name"] in d["editable"]
    assert not any(c.lower() in ("createdby", "creationdate") for c in d["columns"])
    yid = d["rows"][0]["ID"]
    assert c.post("/api/admin/yarn/delete", json={"ids": [yid]}).json()["code"] == "no_delete"
    r = c.post("/api/admin/yarn/save", json={"rows": [{"id": yid, "values": {sp["minstock"]: 1}}]})
    assert r.status_code == 400 and r.json()["code"] == "bad_value"


def test_values_are_checked():
    c = _super()
    d = c.get("/api/admin/yarn").json()
    yid = d["rows"][0]["ID"]
    sp = d["special"]
    for values in ({sp["titer"] if "titer" in sp else "Titer": "abc"}, {sp["garntyp"]: 999999}, {sp["dpf"]: 1},
                   {sp["usedintrial"]: 0}, {"GlobalID": "x"}, {"NoSuchColumn": 1}):
        r = c.post("/api/admin/yarn/save", json={"rows": [{"id": yid, "values": values}]})
        assert r.status_code == 400 and r.json()["code"] == "bad_value", values


def test_duplicate_check_asks_first():
    c = _super()
    row = fetch_all("SELECT * FROM tblYarn WHERE SourceTrialID IS NULL AND Garntyp IS NOT NULL AND Material IS NOT NULL "
                    "AND Titer IS NOT NULL AND Endtiter IS NOT NULL AND NumberOfFilaments IS NOT NULL LIMIT 1")
    if not row:
        pytest.skip("no complete yarn on dev_local")
    row = row[0]
    values = {k: row[k] for k in ("Garntyp", "Material", "Titer", "Endtiter", "NumberOfFilaments")}
    values = {k: float(v) if type(v).__name__ == "Decimal" else v for k, v in values.items()}
    if row.get("ColourID") is not None:
        values["ColourID"] = row["ColourID"]
    r = c.post("/api/admin/yarn/new", json={"values": {"Name": "__dup_probe", **values}})
    assert r.status_code == 409, r.text
    assert r.json()["code"] == "duplicate_identical"
    assert r.json()["vars"]["id"] is not None
    assert not fetch_all("SELECT ID FROM tblYarn WHERE Name = '__dup_probe'")


def test_whole_number_columns_refuse_decimals():
    c = _super()
    yid = c.get("/api/admin/yarn").json()["rows"][0]["ID"]
    r = c.post("/api/admin/yarn/save", json={"rows": [{"id": yid, "values": {"NumberOfFilaments": "36,5"}}]})
    assert r.status_code == 400 and "whole number" in r.json()["detail"]


def test_round_trip():
    c = _super()
    d = c.get("/api/admin/yarn").json()
    sp = d["special"]
    garntyp = d["fk"][sp["garntyp"]][0][0]
    name = f"__webtest_yarn_{int(time.time())}"
    yid = None
    try:
        r = c.post("/api/admin/yarn/new", json={"values": {"Name": name, sp["garntyp"]: garntyp, "Titer": "99",
                                                           "Endtiter": "77", "NumberOfFilaments": "7",
                                                           sp["minstock"]: "3"}})
        assert r.status_code == 200, r.text
        yid = r.json()["id"]
        row = fetch_all("SELECT * FROM tblYarn WHERE ID = ?", [yid])[0]
        assert row["Name"] == name and int(row["Titer"]) == 99 and int(row["NumberOfFilaments"]) == 7
        assert float(row["MinStock"]) == 3 and row["GlobalID"] and row["CreationDate"]
        # form update + table save
        assert c.post(f"/api/admin/yarn/{yid}/update", json={"values": {"Kurzname": "wt"}, "confirmed": True}).status_code == 200
        r = c.post("/api/admin/yarn/save", json={"rows": [{"id": yid, "values": {"Titer": "", sp["garntyp"]: None}}],
                                                 "confirmed": True})
        assert r.status_code == 200 and r.json()["saved"] == 1
        row = fetch_all("SELECT * FROM tblYarn WHERE ID = ?", [yid])[0]
        assert row["Kurzname"] == "wt" and row["Titer"] is None and row["Garntyp"] is None
        assert any(x["ID"] == yid and abs(x[sp["dpf"]] - 11.0) < 0.001 for x in c.get("/api/admin/yarn").json()["rows"])
        assert c.get(f"/api/admin/yarn/{yid}/usage").json() == {"series": []}
        assert c.post("/api/admin/yarn/delete", json={"ids": [yid]}).json()["deleted"] == 1
        yid = None
    finally:
        if yid is not None:
            execute("DELETE FROM tblYarn WHERE ID = ?", [yid])


def test_colour_quick_add(monkeypatch):
    c = _super()
    black = yarn_admin.colour_exact("black")
    if not black:
        pytest.skip("no colour 'black' on dev_local")
    assert c.post("/api/admin/yarn/colour", json={"name": "BLACK"}).json()["id"] == black[0]
    r = c.post("/api/admin/yarn/colour", json={"name": "blak"})
    assert r.status_code == 409 and r.json()["code"] == "colour_similar" and r.json()["match"]["name"] == black[1]
    created = []
    monkeypatch.setattr(yarn_admin, "insert_colour", lambda n: created.append(n) or 99999)
    r = c.post("/api/admin/yarn/colour", json={"name": "blak", "force": True})
    assert created == ["blak"] and r.json()["id"] == 99999
