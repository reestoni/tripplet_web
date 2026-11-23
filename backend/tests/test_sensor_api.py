"""Show Experiment "📏 Messen" (app/sensor_api.py) with a fake NI box: rights, the browser picks only a trial /
sensor key / box, the job measures and writes the TDMS into a tmp folder (never H:), existing file -> 409 exists,
replace moves it to _replaced. Reads trials of a small dev_local series, writes nothing to the DB."""
from __future__ import annotations

import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app

from db.connection import fetch_all
from ui.yarnscope import aty_service, dty_service
from ui.yarnscope import sensor_measure as sm

CAL = "* PROFILE SENSOR PXL\n16.12.2022\nDCX_COEFF\t10267.73\t-1458.12\nDCY_COEFF\t10424.72\t-1480.20\n"
CONFIG = ('Boxes 0.Heads 0.Name = "PXL_3_121_W"\nBoxes 0.Heads 0.Channel inputs 0 = "Dev2/ai1"\n'
          'Boxes 0.Heads 1.Name = "OBD_5_192_M"\nBoxes 0.Heads 1.Active = "FALSE"\n'
          'Boxes 0.Heads 1.Channel inputs 0 = "Dev2/ai4"\n')
CAL_1AX = "* PROFILE SENSOR LARGE\n31.08.2021\nDCX_COEFF\t2493.35\t-353.89\n"


class FakeDaq(sm.Daq):
    def boxes(self):
        return [{"name": "Dev2", "product": "USB-6211", "serial": "1A6A875", "simulated": True}]

    def actual_rate(self, box, channels, rate):
        return 20e6 / (20e6 // rate)

    def read(self, box, channels, rate, n, progress=None, cancel=None):
        if progress:
            progress(n // 2, n)
            progress(n, n)
        return self.actual_rate(box, channels, rate), np.full((len(channels), n), 7.0)


def _client(min_level=2, max_level=9):
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel BETWEEN ? AND ? AND COALESCE(u.Active, 1) <> 0 ORDER BY ar.AccessLevel DESC, u.ID",
                     [min_level, max_level])
    if not rows:
        pytest.skip("no matching user on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c


@pytest.fixture
def env(tmp_path, monkeypatch):
    (tmp_path / "cal").mkdir()
    (tmp_path / "cal" / "PXL_3_121_W.dat").write_text(CAL, encoding="latin-1")
    (tmp_path / "cal" / "OBD_5_192_M.dat").write_text(CAL_1AX, encoding="latin-1")
    cfg = tmp_path / "Sensoft" / "Config Data" / "Configurations ATY"
    cfg.mkdir(parents=True)
    (cfg / "Default config.ini").write_text(CONFIG, encoding="latin-1")
    (tmp_path / "dty").mkdir()
    (tmp_path / "aty").mkdir()
    monkeypatch.setenv(sm.ENV_CAL_DIR, str(tmp_path / "cal"))
    monkeypatch.setenv(sm.ENV_SENSOFT_DIR, str(tmp_path / "Sensoft"))
    monkeypatch.setenv(dty_service.ENV_TDMS_DIR, str(tmp_path / "dty"))
    monkeypatch.setenv(aty_service.ENV_TDMS_DIR, str(tmp_path / "aty"))
    sm.set_daq(FakeDaq())
    rows = fetch_all("SELECT s.ID FROM tblTrialSeries s WHERE (SELECT COUNT(*) FROM tblTrial t WHERE "
                     "t.TrialSeriesID = s.ID) BETWEEN 2 AND 6 ORDER BY s.ID DESC LIMIT 1")
    if not rows:
        pytest.skip("no small series")
    yield type("E", (), {"sid": int(rows[0]["ID"]), "dty": tmp_path / "dty"})
    sm.set_daq(None)


def _wait(c, sid, job_id):
    for _ in range(200):
        j = c.get(f"/api/series/{sid}/sensor/job/{job_id}").json()
        if j["finished"]:
            return j
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_setup_zero_measure_replace(env):
    c = _client()
    s = c.get(f"/api/series/{env.sid}/sensor/setup").json()
    assert s["boxes"][0]["serial"] == "1A6A875" and s["box_error"] is None
    assert [x["key"] for x in s["sensors"]] == ["PXL_3_121_W@C1", "PXL_3_121_W@C2", "OBD_5_192_M@C1", "OBD_5_192_M@C2"]
    trial = s["trials"][0]
    assert trial["dty"] is None

    z = c.post(f"/api/series/{env.sid}/sensor/zero", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1"}).json()
    assert [a["axis"] for a in z["axes"]] == ["x", "y"]

    body = {"box": "Dev2", "sensor": "PXL_3_121_W@C1", "trial_id": trial["trial_id"], "speed": 600, "length": 3}
    assert c.post(f"/api/series/{env.sid}/sensor/measure", json={**body, "sensor": "..\\x@C1"}).json()["code"] == "head_missing"
    assert c.post(f"/api/series/{env.sid}/sensor/measure", json={**body, "trial_id": -5}).status_code == 404
    r = c.post(f"/api/series/{env.sid}/sensor/measure", json={**body, "speed": 0})
    assert r.status_code == 400 and r.json()["code"] == "bad_speed"

    j = _wait(c, env.sid, c.post(f"/api/series/{env.sid}/sensor/measure", json=body).json()["job_id"])
    assert j["error"] is None and j["done"] == j["total"] > 0
    first = j["result"]["file"]
    assert first.startswith(f"{env.sid}_{trial['vno']}_") and (env.dty / first).is_file()

    r = c.post(f"/api/series/{env.sid}/sensor/measure", json=body)
    assert r.status_code == 409 and r.json()["code"] == "exists" and r.json()["vars"]["file"] == first
    j = _wait(c, env.sid, c.post(f"/api/series/{env.sid}/sensor/measure", json={**body, "replace": True}).json()["job_id"])
    assert j["result"]["replaced"] == first and (env.dty / sm.REPLACED_DIR / first).is_file()


def test_read_only_and_no_box(env):
    c = _client(0, 1)
    assert c.post(f"/api/series/{env.sid}/sensor/zero", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1"}).status_code == 403

    class NoDriver(sm.Daq):
        def boxes(self):
            raise sm.MeasureError("no_driver", "driver missing")
    sm.set_daq(NoDriver())
    s = _client().get(f"/api/series/{env.sid}/sensor/setup").json()
    assert s["boxes"] == [] and s["box_error"]["code"] == "no_driver"


def test_inspector_free_measurement_opens_the_file(env):
    """TDMS Inspector "📏 Messen": own name + speed, file in <folder>/_manual, opened at once (negative number)
    and analysable like an upload; the measured file is never deleted by the inspector's cleanup."""
    from app import tdms_inspector
    c = _client()
    s = c.get("/api/tdms-inspector/sensor/setup").json()
    assert s["boxes"][0]["name"] == "Dev2" and s["manual_dir"] == sm.MANUAL_DIR
    body = {"box": "Dev2", "sensor": "PXL_3_121_W@C1", "name": "99999_34", "speed": 764, "length": 3}
    r = c.post("/api/tdms-inspector/sensor/measure", json={**body, "name": "a/b"})
    assert r.status_code == 400 and r.json()["code"] == "bad_name"
    j = _wait_insp(c, c.post("/api/tdms-inspector/sensor/measure", json=body).json()["job_id"])
    assert j["error"] is None
    res = j["result"]
    assert res["file"].startswith("99999_34_") and res["next_name"] == "99999_35" and "path" not in res
    assert res["series_id"] < 0 and (env.dty / sm.MANUAL_DIR / res["file"]).is_file()
    assert not list(env.dty.glob("*.tdms"))                       # not in the folder the automatic analysis reads
    a = c.get(f"/api/series/{res['series_id']}/yarnscope").json()
    assert a["trials"] and a["trials"][0]["file"]
    tdms_inspector._files[res["series_id"]]["time"] = 0             # cleanup after a day: forget, never delete
    tdms_inspector._cleanup()
    assert (env.dty / sm.MANUAL_DIR / res["file"]).is_file() and res["series_id"] not in tdms_inspector._files


def _wait_insp(c, job_id):
    for _ in range(200):
        j = c.get(f"/api/tdms-inspector/sensor/job/{job_id}").json()
        if j["finished"]:
            return j
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_two_sensors_trial_and_inspector(env):
    """Second sensor by key: zero of both, the trial file + the second in _C2, in the inspector both opened;
    same connector refused; no server paths in the answers."""
    c = _client()
    sid = env.sid
    trial = c.get(f"/api/series/{sid}/sensor/setup").json()["trials"][0]
    z = c.post(f"/api/series/{sid}/sensor/zero", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1",
                                                       "second": "OBD_5_192_M@C2"}).json()
    assert [(a["axis"], a["connector"]) for a in z["axes"]] == [("x", "C1"), ("y", "C1"), ("x", "C2")]
    body = {"box": "Dev2", "sensor": "PXL_3_121_W@C1", "second": "OBD_5_192_M@C2", "trial_id": trial["trial_id"],
            "speed": 600, "length": 3, "distance": 100}
    r = c.post(f"/api/series/{sid}/sensor/measure", json={**body, "second": "PXL_3_121_W@C1"})
    assert r.status_code == 400 and r.json()["code"] == "same_connector"
    j = _wait(c, sid, c.post(f"/api/series/{sid}/sensor/measure", json=body).json()["job_id"])
    res = j["result"]
    assert j["error"] is None and "path" not in res and "path" not in res["second"]
    assert (env.dty / res["file"]).is_file() and (env.dty / "_C2" / res["second"]["file"]).is_file()
    assert "pair" in res                                  # constant fake signals: not reliable, but reported
    j = _wait_insp(c, c.post("/api/tdms-inspector/sensor/measure", json={**body, "name": "99999_50"}).json()["job_id"])
    res = j["result"]
    assert res["file"].startswith("99999_50_C1_") and res["second"]["file"].startswith("99999_50_C2_")
    assert res["series_id"] < 0 and res["second"]["series_id"] < 0 and res["second"]["series_id"] != res["series_id"]


def test_same_head_twice_refused(env):
    c = _client()
    r = c.post(f"/api/series/{env.sid}/sensor/zero", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1",
                                                           "second": "PXL_3_121_W@C2"})
    assert r.status_code == 400 and r.json()["code"] == "same_head"
