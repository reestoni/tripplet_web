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


def test_batch_runs_selected_trials_and_saves(client, monkeypatch):
    import time
    sid = _series_with_tdms()
    trials = [t for t in client.get(f"/api/series/{sid}/yarnscope").json()["trials"] if t["has_file"]][:2]
    monkeypatch.setattr(yarnscope, "log_usage_event", lambda *a: None)
    monkeypatch.setattr(svc, "analyse_trial", lambda path, tid: ({"_y_raw": []}, {"FPm": 90.0 + tid % 7, "CV_FP": 20.0}))
    saved = []
    monkeypatch.setattr(svc, "save_analysis", lambda tid, vals, user: saved.append(tid) or True)
    jid = client.post(f"/api/series/{sid}/yarnscope/batch",
                      json={"save": True, "trial_ids": [t["trial_id"] for t in trials]}).json()["job_id"]
    for _ in range(50):
        job = client.get(f"/api/yarnscope/batch/{jid}").json()
        if job["finished"]:
            break
        time.sleep(0.1)
    assert job["finished"] and job["done"] == len(trials)
    assert sorted(saved) == sorted(t["trial_id"] for t in trials)
    assert all(r["status"] in ("saved", "not selected") for r in job["rows"])
    assert "_path" not in job["rows"][0]                      # no file paths to the browser


def test_start_route_defaults_to_backlog(client):
    me = client.get("/api/me").json()
    assert me["start_route"] in ("/backlog", "/experiments", "/requests")
