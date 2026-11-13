"""Smart Chart / Dashboards in the web (app/smart_chart_api.py on ui/smart_dashboard_core.py).
Runs on the real dev_local trials; the only write is a saved view, which is deleted again."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app import auth, smart_chart_api
from app.main import app

from db import smart_chart_views as views
from db.connection import fetch_all


def _client(level_sql="ar.AccessLevel >= ?", params=(4,)):
    rows = fetch_all("SELECT u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     f"WHERE {level_sql} AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID", list(params))
    if not rows:
        pytest.skip("no matching user on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["UserName"]))
    return c, rows[0]["UserName"]


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(smart_chart_api, "log_usage_event", lambda *a: None)
    monkeypatch.setattr("ui.smart_dashboard_core._log", lambda *a: None)


def _open(c, **kw):
    sid = uuid.uuid4().hex
    r = c.post("/api/smart/open", json={"sid": sid, **kw})
    assert r.status_code == 200, r.text
    return sid, r.json()


def _call(c, sid, method, *args):
    r = c.post(f"/api/smart/{sid}/call", json={"method": method, "args": list(args)})
    assert r.status_code == 200, r.text
    return r.json()


def test_page_is_the_desktop_page_with_the_web_bridge():
    c, _ = _client()
    html = c.get("/api/smart/page").text
    assert "/report-assets/smart_bridge.js" in html and "qrc:" not in html
    assert "/report-assets/plotly-2.32.0.min.js" in html
    assert "QWebChannel" in c.get("/report-assets/smart_bridge.js").text


def test_example_page_round_trip():
    c, _ = _client()
    sid, d = _open(c)
    assert d["summary"]["trials"] > 0
    j = _call(c, sid, "ready", {"viz": True}, {})
    names = [x[0] for x in j["cmds"]]
    assert names == ["init", "renderResults"]
    init = j["cmds"][0][1]
    assert init["panes"] == {"viz": True} and init["readonly"] is False and init["spec"]["pages"]
    results = j["cmds"][1][1]["results"]
    assert results and all("kind" in r for r in results.values())
    # the page changes the layout -> new results
    spec = init["spec"]
    spec["pages"][0]["title"] = "Web test"
    j = _call(c, sid, "updateSpec", __import__("json").dumps(spec))
    assert [x[0] for x in j["cmds"]] == ["renderResults"]
    # ply scope + filter on all pages through the editor endpoints
    flt = c.post(f"/api/smart/{sid}/filter/fields", json={"scope": "all"}).json()
    assert flt["tree"] and any(f["key"] == "machine" for f in flt["fields"])
    ov = c.post(f"/api/smart/{sid}/filter/field", json={"scope": "all", "key": "machine"}).json()
    first = ov["cats"][0][0]
    hits = c.post(f"/api/smart/{sid}/filter/hits", json={"scope": "all", "key": "machine", "raw": {"values": [first]}}).json()
    assert 0 < hits["n"] <= hits["base"]
    put = c.post(f"/api/smart/{sid}/filter/put", json={"scope": "all", "key": "machine", "raw": {"values": [first]}}).json()
    assert put["summary"]["trials"] == hits["n"] and put["summary"]["filters"]
    assert c.post(f"/api/smart/{sid}/filter/put", json={"scope": "all", "key": "machine",
                                                        "raw": {"values": []}}).json()["code"] == "empty_filter"
    j = _call(c, sid, "removeFilter", "all", "", 0)
    assert j["summary"]["trials"] == d["summary"]["trials"]
    # Excel of the page
    x = c.get(f"/api/smart/{sid}/excel")
    assert x.status_code == 200 and x.content[:2] == b"PK"


def test_calc_colour_pdf():
    c, _ = _client()
    sid, _d = _open(c, template="")
    _call(c, sid, "ready", {}, {})
    g = c.get(f"/api/smart/{sid}/calc").json()
    assert g["key"] == "calc_1" and g["fields"]
    name = g["fields"][0]["name"]
    p = c.post(f"/api/smart/{sid}/calc/preview", json={"key": "calc_1", "text": f"[{name}] * 2"}).json()
    assert "error" not in p
    assert "error" in c.post(f"/api/smart/{sid}/calc/preview", json={"key": "calc_1", "text": "[nope]"}).json()
    s = c.post(f"/api/smart/{sid}/calc/save", json={"key": "calc_1", "name": "Double", "text": f"[{name}] * 2"}).json()
    assert s["cmds"][0][0] == "init" and any(f["key"] == "calc_1" for f in s["cmds"][0][1]["catalog"])
    assert c.post(f"/api/smart/{sid}/calc/save", json={"key": "calc_2", "name": "", "text": "1"}).json()["code"] == "no_name"
    # a visual on the empty page, then its colour
    spec = s["cmds"][0][1]["spec"]
    spec["pages"][0]["visuals"] = [{"id": "v1", "type": "kpi", "x": 0, "y": 0, "w": 3, "h": 6, "agg": "count", "wells": {}}]
    _call(c, sid, "updateSpec", spec)
    col = c.post(f"/api/smart/{sid}/colour", json={"vid": "v1", "colour": "#123456"}).json()
    assert col["cmds"][0][0] == "setSpec" and col["cmds"][0][1]["pages"][0]["visuals"][0]["fmt"]["colour"] == "#123456"
    assert c.post(f"/api/smart/{sid}/colour", json={"vid": "v1", "colour": "red"}).json()["code"] == "bad_colour"
    # PDF: images from the page -> file
    pj = c.post(f"/api/smart/{sid}/pdf", json={"all_pages": False, "title": "Test"}).json()
    assert pj["cmds"][0][0] == "exportImages"
    done = _call(c, sid, "imagesReady", "{}")
    f = c.get(done["download"])
    assert f.status_code == 200 and f.content[:4] == b"%PDF"
    assert c.get(done["download"]).status_code == 404        # one download per file


def test_session_belongs_to_its_user_and_read_only():
    c, me = _client()
    sid, _d = _open(c, read_only=True)
    j = _call(c, sid, "ready", {"viz": True}, {})
    assert j["cmds"][0][1]["readonly"] is True and j["cmds"][0][1]["panes"] == {}
    assert c.post(f"/api/smart/{sid}/filter/fields", json={"scope": "all"}).status_code == 403
    assert c.get(f"/api/smart/{sid}/excel").status_code == 403
    other = fetch_all("SELECT UserName FROM tblUser WHERE UserName <> ? AND COALESCE(Active,1) <> 0 LIMIT 1", [me])
    if other:
        c2 = TestClient(app)
        c2.cookies.set(auth.COOKIE_NAME, auth.make_cookie(other[0]["UserName"]))
        assert c2.post(f"/api/smart/{sid}/call", json={"method": "ready", "args": []}).status_code == 404


def test_saved_view_round_trip():
    if not views.available():
        pytest.skip("no tblSmartChartView on dev_local")
    c, _ = _client()
    sid, _d = _open(c)
    _call(c, sid, "ready", {}, {})
    c.post(f"/api/smart/{sid}/filter/put", json={"scope": "all", "key": "machine",
                                                 "raw": {"values": [c.post(f"/api/smart/{sid}/filter/field", json={
                                                     "scope": "all", "key": "machine"}).json()["cats"][0][0]]}})
    name = "zz web test " + uuid.uuid4().hex[:6]
    r = c.post(f"/api/smart/{sid}/view/save", json={"name": name, "shared": False, "as_new": True}).json()
    vid = r["view"]["id"]
    try:
        assert r["view"]["name"] == name and r["view"]["right"] == "owner" and r["view"]["dashboard"]
        lst = c.get("/api/smart/views?kind=dashboard").json()
        assert any(v["id"] == vid for v in lst["views"])
        # open it read-only like the Dashboards page
        sid2, d2 = _open(c, read_only=True, view_id=vid)
        assert d2["view"]["id"] == vid and d2["summary"]["filters"]
        # overwrite with a new name
        r2 = c.post(f"/api/smart/{sid}/view/save", json={"name": name + " b", "as_new": False}).json()
        assert r2["view"]["id"] == vid and r2["view"]["name"] == name + " b"
        if views.shares_available():
            sh = c.get(f"/api/smart/views/{vid}/share").json()
            assert "people" in sh and "groups" in sh
            g = sh["groups"][0]["id"]
            assert c.post(f"/api/smart/views/{vid}/share", json={"everybody": False, "entries": [
                {"group_id": g, "can_edit": False}]}).json()["ok"]
            assert c.get(f"/api/smart/views/{vid}/share").json()["entries"][0]["group_id"] == g
    finally:
        assert c.delete(f"/api/smart/views/{vid}").json()["ok"]
    assert views.get_view(vid) is None
