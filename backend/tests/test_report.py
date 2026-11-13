"""Series Report in the browser: page served with the web bridge, slots answer like the desktop,
free-field / visual-query inputs that would reach SQL are checked."""
from __future__ import annotations

import base64
import json

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app

from db import report_service as rs
from db.connection import fetch_all


@pytest.fixture()
def client():
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID")
    if not rows:
        pytest.skip("no superuser on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c


def _a_series():
    rows = fetch_all("SELECT TrialSeriesID AS S FROM tblTrial GROUP BY TrialSeriesID ORDER BY COUNT(*) DESC LIMIT 1")
    if not rows:
        pytest.skip("no trials on dev_local")
    return int(rows[0]["S"])


def test_needs_login():
    c = TestClient(app)
    assert c.get("/report/series/1").status_code == 401
    assert c.post("/api/report/slot/getSeriesList", json={"args": []}).status_code == 401


def test_page_uses_web_bridge(client):
    html = client.get(f"/report/series/{_a_series()}").text
    assert "qrc:///" not in html and "qt.webChannelTransport" in html
    assert '/report-assets/web_bridge.js' in html and '/report-assets/plotly-2.32.0.min.js' in html
    assert client.get("/report-assets/web_bridge.js").status_code == 200
    assert client.get("/report-assets/plotly-2.32.0.min.js").status_code == 200
    leak = client.get("/report-assets/..%2Fmain.py")
    assert leak.status_code == 404 or "FastAPI(" not in leak.text   # at most the SPA index, never source
    assert client.get("/report-assets/core.py").status_code == 404


def test_slot_same_answer_as_desktop(client):
    sid = _a_series()
    r = client.post("/api/report/slot/getSeriesList", json={"args": [], "series_pk": sid}).json()
    receiver, args = rs.handle("getSeriesList", [], user={}, series_pk=sid)
    assert r["receiver"] == receiver and r["args"] == json.loads(json.dumps(args, default=str))
    r = client.post("/api/report/slot/loadSeriesData", json={"args": [str(sid), "#123456"], "series_pk": sid}).json()
    assert r["receiver"] == "receiveSeriesData" and r["args"][2] == "#123456"


def test_unknown_slot(client):
    assert client.post("/api/report/slot/dropTables", json={"args": []}).status_code == 404


def test_free_field_injection_refused(client):
    sid = _a_series()
    bad = [
        ["tblTrial", "ID; DROP TABLE x", "", "0", "free:x"],
        ["tblTrial", "AirPressure", "1=1 OR 1=1", "0", "free:x"],
        ["tblTrial`", "AirPressure", "", "0", "free:x"],
        ["tblTrial", "AirPressure", "ID = 1; DELETE FROM tblTrial", "0", "free:x"],
    ]
    for args in bad:
        r = client.post("/api/report/slot/loadFreeField", json={"args": args, "series_pk": sid})
        assert r.status_code == 400, args
    ok = client.post("/api/report/slot/loadFreeField",
                     json={"args": ["tblTrial", "AirPressure", "AirPressure > 0", "0", "free:tblTrial:AirPressure"],
                           "series_pk": sid})
    assert ok.status_code == 200 and ok.json()["receiver"] in ("receiveFreeFieldData", None)


def test_visual_query_operator_checked(client):
    r = client.post("/api/report/slot/runVisualQuery",
                    json={"args": ["[]", "jet", json.dumps([{"filterKey": "jet", "op": "= 1 OR 1", "value": "x"}]), "[]"]})
    assert r.status_code == 400
    r = client.post("/api/report/slot/runVisualQuery", json={"args": ["[]", "jet", "[]", "[]"]})
    assert r.status_code == 200 and r.json()["receiver"] == "receiveQueryResult"


def test_pdf_download(client, monkeypatch):
    import ui.report_pdf_layout as lay
    monkeypatch.setattr(lay, "_load_pdf_template", lambda tid=None: dict(lay._PDF_TEMPLATE_DEFAULTS))
    monkeypatch.setattr("app.report.log_usage_event", lambda *a: None)
    png = base64.b64encode(bytes.fromhex(
        "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de"
        "0000000c4944415408d763f8ffff3f0005fe02fea7d6a4d80000000049454e44ae426082")).decode()
    payload = {"reportTitle": "Web test", "author": "Me", "sourceType": "series", "charts": [{"title": "C", "b64": png}]}
    r = client.post("/api/report/pdf", json={"payload": json.dumps(payload)})
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    assert "attachment" in r.headers["content-disposition"] and ".pdf" in r.headers["content-disposition"]
