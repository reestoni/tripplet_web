"""YarnScope Live in the web (app/sensor_live_api.py) with a fake streaming NI box: start, rows while it runs, stop,
read-only users cannot start, the page polls /state with since=. Writes only into tmp folders."""
from __future__ import annotations

import time

import numpy as np

from test_sensor_api import _client, env  # noqa: F401  (fixture: tmp folders, calibration, Sensoft config, fake box)
from ui.yarnscope import sensor_live as sl
from ui.yarnscope import sensor_measure as sm


class StreamDaq(sm.Daq):
    def boxes(self):
        return [{"name": "Dev2", "product": "USB-6211", "serial": "1A6A875", "simulated": True}]

    def actual_rate(self, box, channels, rate):
        return 20e6 / (20e6 // rate)

    def stream(self, box, channels, rate, on_chunk, should_stop, chunk_s=0.25):
        actual = self.actual_rate(box, channels, rate)
        k = int(actual * chunk_s)
        rng = np.random.default_rng(1)
        i = 0
        while not should_stop() and i < 4000:
            base = np.where((np.arange(k) // 12) % 2 == 0, 480.0, 700.0) + rng.normal(0, 10, k)
            on_chunk(np.array([(base - 10267.73) / -1458.12, (base - 10424.72) / -1480.20][:len(channels)]), actual)
            i += 1
            time.sleep(0.002)
        return actual


def _wait(cond, timeout=60):
    t0 = time.time()
    while not cond() and time.time() - t0 < timeout:
        time.sleep(0.05)
    assert cond()


def test_live_start_poll_stop(env):  # noqa: F811
    sm.set_daq(StreamDaq())
    c = _client()
    s = c.get("/api/yarnscope-live/setup").json()
    assert s["boxes"][0]["name"] == "Dev2" and s["window_m"] == sl.WINDOW_M and not s["running"]
    assert _client(0, 1).post("/api/yarnscope-live/start", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1",
                                                                 "speed": 764}).status_code == 403
    r = c.post("/api/yarnscope-live/start", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1", "speed": 764,
                                                  "window": 5, "save": True, "name": "99999_live"})
    assert r.status_code == 200 and r.json()["state"] == "running"
    _wait(lambda: c.get("/api/yarnscope-live/state").json()["n_rows"] >= 3)
    v = c.get("/api/yarnscope-live/state?since=2").json()
    assert all(row["i"] >= 2 for row in v["rows"]) and v["rows"][0]["sensors"][0]["fpm"] > 0
    assert c.post("/api/yarnscope-live/start", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1",
                                                     "speed": 764}).json()["code"] == "busy"
    v = c.post("/api/yarnscope-live/stop").json()
    assert v["state"] == "done" and v["files"] and v["files"][0].startswith("99999_live_")
    assert (env.dty / sm.MANUAL_DIR / v["files"][0]).is_file()


def test_live_auto_speed_needs_two_sensors(env):  # noqa: F811
    sm.set_daq(StreamDaq())
    c = _client()
    r = c.post("/api/yarnscope-live/start", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1", "auto_speed": True,
                                                  "save": False})
    assert r.status_code == 400 and r.json()["code"] == "auto_needs_two"
    r = c.post("/api/yarnscope-live/start", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1", "save": False})
    assert r.json()["code"] == "bad_speed"                       # without auto a speed is still needed


def test_bookmark_and_trial_from_it(env, monkeypatch):  # noqa: F811
    """Merken while running, list in /state, trial from a bookmark (copy replaced: no database write), TDMS only when
    asked, file only, label / delete, read-only users cannot. Real setup of a dev_local series for /trial-setup."""
    from db import trial_actions as ta
    from db import trial_copy as tc
    from db.connection import fetch_all
    from ui.yarnscope import dty_service
    sm.set_daq(StreamDaq())
    c = _client()
    assert c.post("/api/yarnscope-live/bookmark", json={}).status_code in (200, 404)   # no session yet or an old one
    c.post("/api/yarnscope-live/start", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1", "speed": 764, "window": 5,
                                              "save": False})
    _wait(lambda: c.get("/api/yarnscope-live/state").json()["meters"] >= 30)
    assert _client(0, 1).post("/api/yarnscope-live/bookmark", json={}).status_code == 403
    assert c.post("/api/yarnscope-live/bookmark", json={"length": 2}).json()["code"] == "bad_length"
    b = c.post("/api/yarnscope-live/bookmark", json={"length": 20}).json()
    assert b["length_m"] == 20 and b["sensors"][0]["fpm"] > 0 and "_axes" not in b
    c.post("/api/yarnscope-live/stop")
    v = c.get("/api/yarnscope-live/state").json()
    assert [x["id"] for x in v["bookmarks"]] == [b["id"]] and v["bookmark_m"] == sl.BOOKMARK_M
    assert c.post(f"/api/yarnscope-live/bookmark/{b['id']}/label", json={"label": "3.4 bar"}).json()["label"] == "3.4 bar"
    # trial setup of a real dev_local series (read only)
    rows = fetch_all("SELECT TOP 1 TrialSeriesID AS sid FROM tblTrial WHERE Versuchsnummer > 0 ORDER BY ID DESC") \
        if False else fetch_all("SELECT TrialSeriesID AS sid FROM tblTrial WHERE Versuchsnummer > 0 ORDER BY ID DESC LIMIT 1")
    sid = int(rows[0]["sid"])
    st = c.get(f"/api/yarnscope-live/trial-setup?series={sid}").json()
    assert st["series"]["id"] == sid and st["trials"] and st["default"] in [t["id"] for t in st["trials"]]
    assert any(f["key"].endswith("AirPressure") for f in st["fields"]) and "recent" in st
    assert c.get("/api/yarnscope-live/trial-setup?series=999999999").json()["code"] == "no_series"
    # create: the copy itself is replaced (nothing written to the database)
    made = []
    monkeypatch.setattr(ta, "copy_trials", lambda series_id, plan, fields, user=None, lab_tables=None:
                        (made.append((series_id, plan)) or [777], None))
    import db.connection
    monkeypatch.setattr(db.connection, "fetch_all", lambda sql, params=(): [{"Versuchsnummer": 9999}]
                        if "Versuchsnummer FROM tblTrial WHERE ID" in sql else fetch_all(sql, params))
    air = next(f["key"] for f in st["fields"] if f["key"].endswith("AirPressure"))
    body = {"series_id": sid, "template_id": st["default"], "values": {air: "3.45"}}
    assert _client(0, 1).post(f"/api/yarnscope-live/bookmark/{b['id']}/trial", json=body).status_code == 403
    assert c.post(f"/api/yarnscope-live/bookmark/{b['id']}/trial",
                  json={**body, "values": {air: "x"}}).json()["code"] == "invalid"
    r = c.post(f"/api/yarnscope-live/bookmark/{b['id']}/trial", json=body).json()
    assert r["vno"] == 9999 and r["file"] is None and made[-1][1][0][1] == {air: "3.45"}
    r = c.post(f"/api/yarnscope-live/bookmark/{b['id']}/trial", json={**body, "save_tdms": True}).json()
    assert r["file"].startswith(f"{sid}_9999_") and dty_service.find_tdms(sid, 9999).name == r["file"]
    assert "path" not in r
    # without a bookmark (2026-11-24): never a TDMS, even if asked
    assert _client(0, 1).post("/api/yarnscope-live/trial", json=body).status_code == 403
    r = c.post("/api/yarnscope-live/trial", json={**body, "save_tdms": True}).json()
    assert r["vno"] == 9999 and r["file"] is None
    assert c.post("/api/yarnscope-live/trial", json={**body, "series_id": 999999999}).json()["code"] == "no_series"
    f = c.post(f"/api/yarnscope-live/bookmark/{b['id']}/file", json={"name": "99999_90"}).json()
    assert f["file"].startswith("99999_90_") and f["next_name"] == "99999_91"
    assert c.delete(f"/api/yarnscope-live/bookmark/{b['id']}").json()["ok"]
    assert c.get("/api/yarnscope-live/state").json()["bookmarks"] == []
    assert tc.validate_overrides  # shared with the copy dialog


def test_live_zero(env):  # noqa: F811
    """Empty value before the start (2026-11-24): remembered like the measure window, shown in /setup, busy while live."""
    sm.forget_zeros()
    c = _client()
    assert c.get("/api/yarnscope-live/setup").json()["zeros"] == []
    assert _client(0, 1).post("/api/yarnscope-live/zero", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1"}).status_code == 403
    z = c.post("/api/yarnscope-live/zero", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1"}).json()
    assert [a["axis"] for a in z["axes"]] == ["x", "y"]
    kept = c.get("/api/yarnscope-live/setup").json()["zeros"]
    assert [(k["head"], k["connector"]) for k in kept] == [("PXL_3_121_W", "C1")]
    assert c.get(f"/api/series/{env.sid}/sensor/setup").json()["zeros"] == kept      # same value as the measure window
    sm.set_daq(StreamDaq())
    c.post("/api/yarnscope-live/start", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1", "speed": 764, "save": False})
    assert c.post("/api/yarnscope-live/zero", json={"box": "Dev2", "sensor": "PXL_3_121_W@C1"}).json()["code"] == "busy"
    assert sl.current().zero["axes"] == z["axes"]
    c.post("/api/yarnscope-live/stop")
