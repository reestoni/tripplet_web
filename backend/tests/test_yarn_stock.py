"""Yarn Stock in the web (app/yarn_stock_api.py on db/yarn_stock.py). Reads, rights and one real round trip on
dev_local with a test batch of an existing yarn (new spools -> label queue -> edit -> rename batch -> history ->
discard); spools, log rows and queue rows are deleted again at the end. The label PDF is only rendered
(printing would mark the real queue as printed)."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import auth, yarn_stock_api
from app.main import app

from db import yarn_stock as ys
from db.connection import execute, fetch_all, table_exists


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
def _quiet(monkeypatch):
    monkeypatch.setattr(yarn_stock_api, "log_usage_event", lambda *a: None)
    monkeypatch.setattr(ys, "refresh_notifications", lambda stock: None)


def test_overview_and_reads():
    c = _super()
    d = c.get("/api/yarn-stock").json()
    assert d["can_write"] and d["can_edit_minstock"]
    assert d["overview"] and all(g["status"] in ("OK", "Low", "Empty") for g in d["overview"])
    g = d["overview"][0]
    spools = c.get("/api/yarn-stock/group", params={"yarn_id": g["yarn_id"], "charge": g["charge"]}).json()["spools"]
    assert len(spools) == g["count"] and all(s["status"] == "in stock" for s in spools)
    r = c.post("/api/yarn-stock/goto", json={"text": f"Y:X;B:Y;L:Z;SÖ{spools[0]['id']}"}).json()
    assert r["spool_id"] == spools[0]["id"] and r["yarn_id"] == g["yarn_id"]
    assert c.post("/api/yarn-stock/goto", json={"text": "abc"}).json()["code"] == "bad_spool_input"
    assert c.post("/api/yarn-stock/goto", json={"text": "99999999"}).json()["code"] == "spool_not_found"
    r = c.get("/api/yarn-stock/export/overview", params={"status": "OK"})
    assert r.status_code == 200 and r.content[:2] == b"PK"


def test_parse_spool_input():
    assert ys.parse_spool_input("213") == 213 and ys.parse_spool_input("#213") == 213
    assert ys.parse_spool_input("Y:PES;B:GH1;L:C31;S:213") == 213
    assert ys.parse_spool_input("Y:PES;B:GH1;L:C31;SÖ213") == 213
    assert ys.parse_spool_input("hello") is None


def test_labels_pdf_renders():
    tpl = {"PageWidthMm": 210, "PageHeightMm": 297, "ColumnCount": 3, "RowCount": 8, "LabelWidthMm": 64.6,
           "LabelHeightMm": 33.8, "MarginTopMm": 13, "MarginLeftMm": 9, "HGapMm": 0, "VGapMm": 0}
    try:
        data = ys.labels_pdf([{"SpoolID": 1, "Yarn": "PES POY 84/50f36", "Batch": "GH1", "Location": "C31"}], tpl, 2)
    except ImportError:
        pytest.skip("PyMuPDF / qrcode missing")
    assert data[:4] == b"%PDF"


def test_minstock_only_superusers():
    c = _user("ar.AccessLevel BETWEEN ? AND ?", [2, 3])
    if c.get("/api/yarn-stock").status_code == 403:
        pytest.skip("user without Yarn Stock right")
    assert c.get("/api/yarn-stock").json()["can_edit_minstock"] is False
    assert c.post("/api/yarn-stock/minstock", json={"yarn_id": 1, "value": 5}).json()["code"] == "minstock_superuser"


def test_round_trip():
    c = _super()
    d = c.get("/api/yarn-stock").json()
    yarn_id = d["yarns"][0]["id"]
    batch = f"__wt{int(time.time())}"
    ids = []
    try:
        r = c.post("/api/yarn-stock/spools/new", json={"yarn_id": yarn_id, "charge": batch, "weight": 2.5, "count": 2,
                                                       "location": "ZZ99", "colour": "red", "add_to_queue": True})
        assert r.status_code == 200, r.text
        ids = r.json()["ids"]
        assert len(ids) == 2 and r.json()["charge"] == batch
        if table_exists(ys.LABEL_QUEUE_TABLE):
            assert r.json()["queued"] == 2
            assert {q["SpoolID"] for q in c.get("/api/yarn-stock").json()["queue"]} >= set(ids)
        g = c.get("/api/yarn-stock/group", params={"yarn_id": yarn_id, "charge": batch}).json()["spools"]
        assert [s["id"] for s in g] == sorted(ids) and g[0]["weight"] == 2.5 and g[0]["location"] == "ZZ99"
        rack = c.get("/api/yarn-stock/rack", params={"prefix": "zz"}).json()["rows"]
        assert any(x["charge"] == batch and x["count"] == 2 for x in rack)

        # edit one spool; bad weight refused
        assert c.post("/api/yarn-stock/spools/save", json={"changes": [{"id": ids[0], "weight": "-1"}]}).json()["code"] == "bad_weight"
        r = c.post("/api/yarn-stock/spools/save", json={"changes": [{"id": ids[0], "weight": "3,25", "location": "ZZ98"}]})
        assert r.json()["updated"] == 2
        row = fetch_all("SELECT WeightKg, Location FROM tblYarnSpool WHERE ID = ?", [ids[0]])[0]
        assert float(row["WeightKg"]) == 3.25 and row["Location"] == "ZZ98"

        # rename the batch of the whole group
        new_batch = batch + "b"
        assert c.post("/api/yarn-stock/group/batch", json={"yarn_id": yarn_id, "charge": batch, "new_charge": new_batch}).status_code == 200
        assert {r["Charge"] for r in fetch_all(f"SELECT Charge FROM tblYarnSpool WHERE ID IN ({ids[0]},{ids[1]})")} == {new_batch}
        batch = new_batch

        hist = c.post("/api/yarn-stock/history", json={"yarn_id": yarn_id, "charge": batch}).json()
        if hist["available"]:
            changes = " | ".join(h["change"] for h in hist["rows"])
            assert "Created" in changes and "Weight (kg)" in changes and "Batch" in changes
        assert c.post("/api/yarn-stock/used-in", json={"ids": ids}).json()["rows"] == []

        assert c.post("/api/yarn-stock/spools/discard", json={"ids": [ids[1]]}).json()["discarded"] == 1
        assert fetch_all("SELECT Status FROM tblYarnSpool WHERE ID = ?", [ids[1]])[0]["Status"] == "discarded"
        # a discarded spool is no longer editable
        assert c.post("/api/yarn-stock/spools/save", json={"changes": [{"id": ids[1], "location": "X"}]}).json()["code"] == "spool_not_editable"
    finally:
        if ids:
            ph = ",".join(str(int(i)) for i in ids)
            if table_exists(ys.LABEL_QUEUE_TABLE):
                execute(f"DELETE FROM {ys.LABEL_QUEUE_TABLE} WHERE SpoolID IN ({ph})")
            if table_exists("tblYarnSpoolLog"):
                execute(f"DELETE FROM tblYarnSpoolLog WHERE SpoolID IN ({ph})")
            execute(f"DELETE FROM tblYarnSpool WHERE ID IN ({ph})")
