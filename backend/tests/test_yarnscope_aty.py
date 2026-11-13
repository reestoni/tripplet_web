"""ATY YarnScope in the browser (app/yarnscope_aty.py on ui/yarnscope/aty_service.py). The TDMS share (H:)
is replaced by synthetic ATY signals (core + loops) that run through the desktop's real analyses; the DB
writes of Save / Batch are replaced, so nothing is written."""
from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import auth, yarnscope_aty
from app.main import app

from db.connection import fetch_all
from ui.yarnscope import aty_service as svc


def _client(min_level=4):
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= ? AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID", [min_level])
    if not rows:
        pytest.skip("no such user")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c


def _signal(seed: int, loops_per_m: float = 120.0, length_m: float = 30.0):
    """Shadow diameter in mm: 0.30 mm core + loops of 0.05-0.35 mm height, 0.5-4 mm long."""
    rng = np.random.default_rng(seed)
    mm_pp = 0.25
    n = int(length_m * 1000 / mm_pp)
    arr = 0.30 + rng.normal(0, 0.004, n)
    pos = 0
    while True:
        pos += int(rng.exponential(1000 / loops_per_m) / mm_pp) + 4
        if pos >= n - 20:
            break
        w = int(rng.uniform(0.5, 4.0) / mm_pp) + 1
        h = rng.uniform(0.05, 0.35)
        arr[pos:pos + w] += h * np.hanning(w + 2)[1:-1]
    return arr, mm_pp, 12.0 + rng.normal(0, 1.0, n)            # ellipticity: per sample, as read_aty_signal


@pytest.fixture()
def fake(monkeypatch):
    files = [{"trial_id": 800 + i, "vno": i + 1, "tdms": Path(f"C:/nowhere/aty_{i}.tdms"), "analysed": i == 0}
             for i in range(3)]
    signals = {str(f["tdms"]): _signal(i, 80 + 40 * i) for i, f in enumerate(files)}
    monkeypatch.setattr(yarnscope_aty.stb, "load_trials",
                        lambda sid: SimpleNamespace(trials=[{"ID": f["trial_id"]} for f in files],
                                                    labels=[f"V{f['vno']}" for f in files], reference_names={}))
    monkeypatch.setattr(svc, "trial_files", lambda *a, **k: files)
    monkeypatch.setattr(svc, "read_signal", lambda path: signals[str(path)])
    saved = []
    monkeypatch.setattr(svc, "save_db_row", lambda tid, vals, user=None: saved.append((tid, vals)) or True)
    monkeypatch.setattr(yarnscope_aty, "log_usage_event", lambda *a: None)
    yarnscope_aty._cache.clear()
    yarnscope_aty._core.clear()
    return SimpleNamespace(files=files, saved=saved)


def test_single_trial_views(fake):
    c = _client()
    base = "/api/series/1/aty"
    t = c.get(base).json()
    assert [x["label"] for x in t["trials"]] == ["V1", "V2", "V3"] and t["controls"]["turns"][0] == 10
    assert c.get(f"{base}/800/hist").status_code == 409                     # analyse first
    r = c.post(f"{base}/800/analyse").json()
    assert abs(r["total_m"] - 30.0) < 0.01 and r["spots"] > 0
    assert [m["label"] for m in r["metrics"][0]] == ["Length", "Kurzhocker", "Langwelle"]
    h = c.get(f"{base}/800/hist", params={"feature": "F02_height_um"}).json()
    assert len(h["rows"]) <= 20 and len(h["centers"]) == len(h["counts_1"])
    assert c.get(f"{base}/800/hist", params={"feature": "nope"}).status_code == 400
    g = c.get(f"{base}/800/garnspiegel", params={"start": 1, "turns": 99, "gap": 2}).json()
    assert len(g["rows"]) == 20 and len(g["rows"][0]["half"]) == 800        # turns clamped to 20, 200 mm / 0.25 mm
    assert all(k[2][:2] in ("Di", "Dü") for row in g["rows"] for k in row["spans"])
    f = c.get(f"{base}/800/fabric", params={"bands": 100}).json()
    assert len(f["bands"]) == 100 and abs(f["seg_mm"] - 300.0) < 1e-6
    k = c.get(f"{base}/800/knitted", params={"rows": 20}).json()
    assert len(k["rows"]) == 20 and k["x_range_mm"] == [0.0, 200.0]


def test_save_needs_write_access_and_uses_core_analysis(fake):
    c = _client()
    c.post("/api/series/1/aty/801/analyse")
    assert c.post("/api/series/1/aty/801/save").json()["ok"]
    tid, vals = fake.saved[-1]
    assert tid == 801 and {"CoreMeanUm", "BulkIndexPct", "DensityPerM"} <= set(vals)
    ro = _client(0)
    if ro is not None:
        rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                         "WHERE ar.AccessLevel < 2 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")
        if rows:
            ro.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
            assert ro.post("/api/series/1/aty/801/save").status_code == 403


def test_compare(fake):
    c = _client()
    c.post("/api/series/1/aty/800/analyse")                                 # one from the cache, two from "files"
    d = c.post("/api/series/1/aty/compare", json={"trial_ids": [802, 800, 801], "start_m": 2}).json()
    assert [t["label"] for t in d["trials"]] == ["V001", "V002", "V003"]     # sorted by trial number
    assert [len(t["rows"]) for t in d["tables"]] == [3, 3, 3] and len(d["tables"][1]["headers"]) == 11
    assert len(d["radar_axes"]) == 5 and all(len(t["radar"]["values"]) == 5 for t in d["trials"])
    assert d["trials"][0]["zoom"]["start_m"] == 2.0 and d["hists"]["spacing"]
    freq = [float(r[5]) for r in d["tables"][0]["rows"]]
    assert freq[0] < freq[2]                                                # more loops/m in the later synthetic trials
    assert c.post("/api/series/1/aty/compare", json={"trial_ids": []}).status_code == 400


def test_batch_runs_and_saves(fake):
    c = _client()
    job = c.post("/api/series/1/aty/batch", json={"only_pending": True}).json()["job_id"]
    for _ in range(100):
        st = c.get(f"/api/aty/batch/{job}").json()
        if st["finished"]:
            break
        time.sleep(0.2)
    assert st["finished"] and st["total"] == 2                              # V1 was analysed already
    assert [r["status"] for r in st["rows"]] == ["not selected", "saved", "saved"]
    assert st["rows"][1]["values"]["CoreMeanUm"] and {x["key"] for x in st["columns"]} >= {"BulkIndexPct"}
    assert {tid for tid, _v in fake.saved} == {801, 802}
