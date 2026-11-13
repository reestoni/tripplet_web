"""DTY YarnScope in the browser: trial list, analysis cache, views, save rights."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth, yarnscope
from app.main import app

from db.connection import fetch_all
from ui.yarnscope import dty_service as svc


@pytest.fixture()
def client():
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID")
    if not rows:
        pytest.skip("no superuser on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c


def _series_with_tdms():
    if not svc.tdms_base().exists():
        pytest.skip("YarnScope folder not reachable")
    for r in fetch_all("SELECT DISTINCT TrialSeriesID AS S FROM tblTrial ORDER BY S DESC LIMIT 400"):
        if svc.series_has_tdms(r["S"]):
            return int(r["S"])
    pytest.skip("no series with TDMS files")


def test_needs_login():
    assert TestClient(app).get("/api/series/1/yarnscope").status_code == 401


def test_views_need_analysis_then_work(client, monkeypatch):
    sid = _series_with_tdms()
    d = client.get(f"/api/series/{sid}/yarnscope").json()
    tid = next(t["trial_id"] for t in d["trials"] if t["has_file"])
    yarnscope._cache.clear()
    assert client.get(f"/api/series/{sid}/yarnscope/{tid}/segment").status_code == 409
    monkeypatch.setattr(yarnscope, "log_usage_event", lambda *a: None)
    r = client.post(f"/api/series/{sid}/yarnscope/{tid}/analyse")
    assert r.status_code == 200 and r.json()["metrics_card"]
    assert client.get(f"/api/series/{sid}/yarnscope").json()["trials"][0]["loaded"] in (True, False)
    for view in ("segment?start=0&window=3", "signal?start=0&window=1", "garnspiegel?start=0"):
        assert client.get(f"/api/series/{sid}/yarnscope/{tid}/{view}").status_code == 200
    seg = client.get(f"/api/series/{sid}/yarnscope/{tid}/segment?window=999").json()
    assert seg["window_m"] <= 200 and len(seg["line"]["x"]) <= svc.MAX_TRACE_POINTS


def test_save_is_for_write_users_and_uses_shared_save(client, monkeypatch):
    sid = _series_with_tdms()
    d = client.get(f"/api/series/{sid}/yarnscope").json()
    tid = next(t["trial_id"] for t in d["trials"] if t["has_file"])
    monkeypatch.setattr(yarnscope, "log_usage_event", lambda *a: None)
    client.post(f"/api/series/{sid}/yarnscope/{tid}/analyse")
    calls = []
    monkeypatch.setattr(svc, "save_analysis", lambda t, vals, user: calls.append((t, user["id"])) or True)
    assert client.post(f"/api/series/{sid}/yarnscope/{tid}/save").json()["ok"]
    assert calls and calls[0][0] == tid
