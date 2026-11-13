"""Stock take in the web (app/stock_take_api.py on db/stock_take.py). One real round on dev_local with test
spools at the test location ZZ97: start -> move / put back during the check -> finish with "discard missing"
-> results / Excel -> close; round, spools, log rows are deleted again. Skipped if a real round is open."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app import auth, stock_take_api, yarn_stock_api
from app.main import app

from db import stock_take as st
from db import yarn_stock as ys
from db.connection import execute, fetch_all, table_exists


def _client(where, params):
    rows = fetch_all("SELECT u.ID, u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     f"WHERE {where} AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID", params)
    if not rows:
        pytest.skip("no matching user on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c, rows[0]["ID"]


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(stock_take_api, "log_usage_event", lambda *a: None)
    monkeypatch.setattr(yarn_stock_api, "log_usage_event", lambda *a: None)
    monkeypatch.setattr(st, "_log", lambda *a: None)


def test_parse_and_rights():
    c, _uid = _client("ar.AccessLevel >= ?", [4])
    assert c.get("/api/yarn-stock/stock-take/parse", params={"text": "Y:A;B:B;L:C;SÖ213"}).json()["spool_id"] == 213
    assert c.get("/api/yarn-stock/stock-take/parse", params={"text": "x"}).json()["spool_id"] is None
    n, _u = _client("ar.AccessLevel BETWEEN ? AND ?", [1, 3])
    if n.get("/api/yarn-stock/stock-take").status_code == 403:
        pytest.skip("user without Yarn Stock right")
    assert n.post("/api/yarn-stock/stock-take/start", json={"name": "x"}).json()["code"] == "superuser_only"
    assert n.get("/api/yarn-stock/stock-take/locations").json()["code"] == "superuser_only"


def test_round_trip():
    if not st.available():
        pytest.skip("stock take tables missing")
    if st.open_round() is not None:
        pytest.skip("a real stock take round is open on dev_local")
    c, uid = _client("ar.AccessLevel >= ?", [4])
    yarn_id = c.get("/api/yarn-stock").json()["yarns"][0]["id"]
    batch = f"__wt{int(time.time())}"
    ids, rid = [], None
    try:
        for loc in ("ZZ97", "ZZ97", "ZZ96", "ZZ96"):
            new, err = ys.new_spools({"YarnID": yarn_id, "Charge": batch, "WeightKg": 1.0, "Count": 1, "Location": loc}, uid)
            assert err is None
            ids += new
        a, b, moved, gone = ids
        ys.discard_spools([gone])

        rid = c.post("/api/yarn-stock/stock-take/start", json={"name": "__webtest round", "excluded": []}).json()["id"]
        assert c.post("/api/yarn-stock/stock-take/start", json={"name": "again"}).json()["code"] == "round_open"
        d = c.get("/api/yarn-stock/stock-take").json()
        assert d["round"]["id"] == rid and d["round"]["open"]
        tiles = {t["location"]: t for r in d["racks"] for lv in r["levels"] for t in lv["tiles"]}
        assert tiles["ZZ97"]["state"] == "open" and tiles["ZZ97"]["now"] == 2

        sp = {s["id"]: s for s in c.get("/api/yarn-stock/stock-take/spools").json()["spools"]}
        assert sp[gone]["status"] == "discarded" and sp[a]["location"] == "ZZ97"
        # corrections during the check of ZZ97
        assert c.post("/api/yarn-stock/stock-take/move", json={"spool_id": moved, "location": "zz97"}).json()["location"] == "ZZ97"
        assert c.post("/api/yarn-stock/stock-take/move", json={"spool_id": gone, "location": "ZZ97"}).json()["code"] == "bad_spool"
        assert c.post("/api/yarn-stock/stock-take/restock", json={"spool_id": gone, "location": "ZZ97"}).status_code == 200
        assert fetch_all("SELECT Status, Location FROM tblYarnSpool WHERE ID = ?", [gone])[0]["Status"] == "in stock"

        r = c.post("/api/yarn-stock/stock-take/finish", json={
            "round_id": rid, "location": "ZZ97", "expected_ids": [a, b], "found_ids": [a], "manual_ids": [a],
            "others": [{"spool_id": moved, "code": "moved_here", "detail": "from ZZ96"},
                       {"spool_id": gone, "code": "restocked", "detail": "at ZZ97"}],
            "discard_missing": True})
        assert r.json()["discarded"] == 1
        assert fetch_all("SELECT Status FROM tblYarnSpool WHERE ID = ?", [b])[0]["Status"] == "discarded"
        assert c.post("/api/yarn-stock/stock-take/finish", json={
            "round_id": rid, "location": "ZZ97", "expected_ids": [], "others": [{"spool_id": 1, "code": "nonsense"}]}).json()["code"] == "bad_result"

        d = c.get("/api/yarn-stock/stock-take").json()
        tiles = {t["location"]: t for r in d["racks"] for lv in r["levels"] for t in lv["tiles"]}
        assert tiles["ZZ97"]["state"] == "deviation" and tiles["ZZ97"]["found"] == 1 and tiles["ZZ97"]["expected"] == 2
        res = {i["spool_id"]: i for i in d["items"] if i["location"] == "ZZ97"}
        assert res[a]["result"] == "found" and res[a]["by_hand"]
        assert res[b]["result"] == "missing_discarded" and res[moved]["result"] == "moved_here" and res[gone]["result"] == "restocked"

        assert c.post("/api/yarn-stock/stock-take/exclude", json={"round_id": rid, "location": "ZZ96", "excluded": True}).status_code == 200
        x = c.get("/api/yarn-stock/stock-take/export", params={"round_id": rid})
        assert x.status_code == 200 and x.content[:2] == b"PK"

        assert c.post("/api/yarn-stock/stock-take/close", json={"round_id": rid}).status_code == 200
        assert c.post("/api/yarn-stock/stock-take/finish", json={"round_id": rid, "location": "ZZ97", "expected_ids": []}).json()["code"] == "round_closed"

        # check without a round: nothing recorded, only the spools change
        r = c.post("/api/yarn-stock/stock-take/finish", json={"location": "ZZ9", "expected_ids": [a], "found_ids": [], "discard_missing": False})
        assert r.json()["discarded"] == 0
    finally:
        if rid is not None:
            for tbl in (st.ITEM_TABLE, st.LOCATION_TABLE):
                execute(f"DELETE FROM {tbl} WHERE RoundID = ?", [rid])
            execute(f"DELETE FROM {st.ROUND_TABLE} WHERE ID = ?", [rid])
        if ids:
            ph = ",".join(str(int(i)) for i in ids)
            if table_exists("tblYarnSpoolLog"):
                execute(f"DELETE FROM tblYarnSpoolLog WHERE SpoolID IN ({ph})")
            if table_exists(ys.LABEL_QUEUE_TABLE):
                execute(f"DELETE FROM {ys.LABEL_QUEUE_TABLE} WHERE SpoolID IN ({ph})")
            execute(f"DELETE FROM tblYarnSpool WHERE ID IN ({ph})")
