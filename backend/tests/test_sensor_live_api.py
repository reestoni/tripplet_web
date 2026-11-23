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
