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
    assert seg["window_m"] <= 100 and len(seg["line"]["x"]) <= svc.MAX_TRACE_POINTS

    # trend lines + metric cards + process wave (desktop "Rollung" Meter / Paare, raster in m)
    q = "start=0&window=30&open_knot=Meter:1&peak_valley=Paare:10&opening=Meter:2&wave=0.05"
    seg = client.get(f"/api/series/{sid}/yarnscope/{tid}/segment?{q}").json()
    for k in ("open_knot", "peak_valley", "opening"):
        tr = seg["trends"][k]
        assert tr["enabled"] and len(tr["x"]) == len(tr["y"]) and tr["roll_label"]
        assert tr["metrics"] is None or {"median", "p5_p95", "slope", "wavelength"} <= set(tr["metrics"])
    pw = seg["process_wave"]
    assert pw is None or (len(pw["x"]) == len(pw["fitted"]) and pw["bin_width"] == 0.05)
    off = client.get(f"/api/series/{sid}/yarnscope/{tid}/segment?start=0&window=3").json()
    assert not any(t["enabled"] for t in off["trends"].values()) and off["process_wave"] is None
    assert client.get(f"/api/series/{sid}/yarnscope/{tid}/segment?open_knot=Wochen:3").status_code == 400


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


def test_trends_and_process_wave_on_synthetic_signal(client, monkeypatch):
    """Trend lines, metric cards and the process wave without the TDMS share: a synthetic DTY-like
    signal (knots every ~25 mm on a 1.5 m process wave) through the desktop's analyze_series."""
    import numpy as np
    from ui.yarnscope.dty_analysis import analyze_series
    dx = 0.25
    x = np.arange(0, 40_000 / dx) * dx                      # 40 m in mm
    knots = (np.floor(x / 25.0) % 2 == 0) & ((x % 25.0) < 6.0)
    y = 120 + 8 * np.sin(2 * np.pi * x / 1500.0) - 60 * knots + np.random.default_rng(1).normal(0, 2, x.size)
    res = analyze_series(y, dx, 3)
    res["_y_raw"], res["_dx_mm"] = y, dx
    monkeypatch.setattr(yarnscope, "_cached", lambda sid, tid: (res, svc.extract_basic_vals(res)))
    q = "start=0&window=30&open_knot=Meter:1&peak_valley=Paare:10&opening=Meter:2&wave=0.05"
    seg = client.get(f"/api/series/1/yarnscope/1/segment?{q}").json()
    for k in ("open_knot", "peak_valley", "opening"):
        tr = seg["trends"][k]
        assert tr["enabled"] and tr["x"] and len(tr["x"]) == len(tr["y"]) and tr["roll_label"], k
        assert {"median", "p5_p95", "mad", "slope", "end_delta", "wavelength"} <= set(tr["metrics"]), k
    pw = seg["process_wave"]
    assert pw and pw["bin_width"] == 0.05 and len(pw["x"]) == len(pw["fitted"])
    assert abs(pw["wavelength"] - 1.5) < 0.3                  # finds the 1.5 m wave
    off = client.get("/api/series/1/yarnscope/1/segment?start=0&window=3").json()
    assert not any(t["enabled"] for t in off["trends"].values()) and off["process_wave"] is None
    clamp = client.get("/api/series/1/yarnscope/1/segment?open_knot=Paare:9999&window=500").json()
    assert clamp["window_m"] <= 40 and clamp["trends"]["open_knot"]["enabled"]
    assert client.get("/api/series/1/yarnscope/1/segment?open_knot=Wochen:3").status_code == 400


def _synthetic(wave_m: float, seed: int, length_m: float = 40.0):
    import numpy as np
    from ui.yarnscope.dty_analysis import analyze_series
    dx = 0.25
    x = np.arange(0, length_m * 1000 / dx) * dx
    knots = (np.floor(x / 25.0) % 2 == 0) & ((x % 25.0) < 6.0)
    y = 120 + 8 * np.sin(2 * np.pi * x / (wave_m * 1000)) - 60 * knots + np.random.default_rng(seed).normal(0, 2, x.size)
    res = analyze_series(y, dx, 3)
    res["_y_raw"], res["_dx_mm"] = y, dx
    return res, svc.extract_basic_vals(res)


def test_process_comparison_on_synthetic_signals(client, monkeypatch):
    """Prozessvergleich without the TDMS share: three analysed (cached) synthetic trials + one whose
    file cannot be read (skipped with its reason); display options do not compute again."""
    from pathlib import Path
    from types import SimpleNamespace
    monkeypatch.setattr(yarnscope, "log_usage_event", lambda *a: None)
    files = [{"trial_id": 900 + i, "vno": i + 1, "tdms": Path(f"C:/nowhere/fake_{i}.tdms")} for i in range(4)]
    monkeypatch.setattr(yarnscope.stb, "load_trials", lambda sid: SimpleNamespace(trials=[], reference_names={}))
    monkeypatch.setattr(svc, "trial_files", lambda *a, **k: files)
    yarnscope._cache.clear()
    yarnscope._compare_cache.clear()
    for i, wl in enumerate((1.0, 1.5, 2.0)):
        yarnscope._cache[yarnscope._key(files[i]["trial_id"], files[i]["tdms"])] = _synthetic(wl, i)
    runs = []
    real = svc.run_process_comparison
    monkeypatch.setattr(svc, "run_process_comparison", lambda *a, **k: runs.append(1) or real(*a, **k))

    url = "/api/series/1/yarnscope/compare"
    assert client.post(url, json={"trial_ids": [900]}).status_code == 400
    d = client.post(url, json={"trial_ids": [900, 901, 902, 903], "bin": 0.05}).json()
    assert [r["label"] for r in d["rows"]] == ["V001", "V002", "V003"] and "V004" in d["errors"]
    lam = [float(r["table"][2]) for r in d["rows"]]
    assert all(abs(a - b) < 0.3 for a, b in zip(lam, (1.0, 1.5, 2.0)))       # each trial's own wave
    assert {t["kind"] for t in d["traces"]} == {"sine_fit"} and len(d["rows"][0]["table"]) == 13
    d2 = client.post(url, json={"trial_ids": [900, 901, 902, 903], "bin": 0.05, "process_mean": True, "drift": True,
                                "open_trend": True, "open_roll": "Paare:10", "normalized": False}).json()
    assert {t["kind"] for t in d2["traces"]} == {"sine_fit", "process_mean", "drift", "open_trend"}
    assert len(runs) == 1                                                     # options only: kept result
    assert client.post(url, json={"trial_ids": [900, 901], "bin": 0.05}).status_code == 200 and len(runs) == 2
    assert client.post(url, json={"trial_ids": [900, 999]}).status_code == 404
