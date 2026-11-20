"""Automatic YarnScope analysis (app/yarnscope_auto.py): safety switch, which files count (settled, not too old,
trial without analysis, matched like the tab), one bell message per series, failed files not retried.
No DB writes: folder = tmp, trials / analysis / owner / bell replaced."""
from __future__ import annotations

import os
import time
from types import SimpleNamespace

import pytest

from app import yarnscope_auto as ya

SID = 999991


@pytest.fixture
def env(monkeypatch, tmp_path):
    for k in (ya.ENV_ON, ya.dty_service.ENV_TDMS_DIR, ya.aty_service.ENV_TDMS_DIR):
        monkeypatch.delenv(k, raising=False)
    ya._failed.clear()
    dty, aty = tmp_path / "dty", tmp_path / "aty"
    dty.mkdir(); aty.mkdir()
    monkeypatch.setattr(ya.dty_service, "tdms_base", lambda: dty)
    monkeypatch.setattr(ya.aty_service, "tdms_base", lambda: aty)
    trials = [{"ID": 100 + v, "Versuchsnummer": v} for v in (1, 2, 3, 4, 5)]
    monkeypatch.setattr(ya.stb, "load_trials", lambda sid: SimpleNamespace(trials=trials, reference_names={}))
    monkeypatch.setattr(ya.dty_service, "is_trial_analysed", lambda tid: tid == 104)
    monkeypatch.setattr(ya.dty_service, "analysed_trial_ids", lambda ids: {104} & set(ids))
    monkeypatch.setattr(ya.aty_service, "analysed_trial_ids", lambda ids: set())
    monkeypatch.setattr(ya, "_owner", lambda sid: 7)
    bell = []
    monkeypatch.setattr(ya.nt, "create_series_message_notification", lambda *a: bell.append(a) or True)
    calls = []

    def fake_dty(path, tid, user):
        calls.append(("dty", tid, path.name, user["id"]))
        if tid == 105:
            raise ValueError("broken file")
        return True
    monkeypatch.setattr(ya, "KINDS", {"dty": (ya.dty_service, fake_dty),
                                      "aty": (ya.aty_service, lambda p, t, u: calls.append(("aty", t, p.name, u["id"])) or True)})
    return SimpleNamespace(dty=dty, aty=aty, calls=calls, bell=bell)


def _file(folder, name, age_min):
    p = folder / name
    p.write_bytes(b"x")
    t = time.time() - age_min * 60
    os.utime(p, (t, t))
    return p


def test_safety_switch(monkeypatch):
    monkeypatch.delenv(ya.ENV_ON, raising=False)
    assert ya.allowed()[0] is False
    monkeypatch.setenv(ya.ENV_ON, "1")
    monkeypatch.setenv("TRIPPLET_MODE", "dev_local")
    monkeypatch.delenv(ya.dty_service.ENV_TDMS_DIR, raising=False)
    monkeypatch.delenv(ya.aty_service.ENV_TDMS_DIR, raising=False)
    assert ya.allowed()[0] is False                      # the H: folders belong to production
    monkeypatch.setenv(ya.dty_service.ENV_TDMS_DIR, r"C:\ttt\dty")
    monkeypatch.setenv(ya.aty_service.ENV_TDMS_DIR, r"C:\ttt\aty")
    assert ya.allowed()[0] is True
    monkeypatch.setenv("TRIPPLET_MODE", "prod")
    monkeypatch.delenv(ya.dty_service.ENV_TDMS_DIR)
    assert ya.allowed()[0] is True


def test_only_settled_recent_unanalysed_files(env):
    _file(env.dty, f"{SID}_1_201126_0700.tdms", 30)          # counts
    _file(env.dty, f"{SID}_2_201126_0710.tdms", 1)           # still being written -> waits
    _file(env.dty, f"{SID}_3_011026_0700.tdms", 60 * 24 * 30)  # older than 14 days -> never
    _file(env.dty, f"{SID}_4_201126_0720.tdms", 30)          # trial already analysed -> never overwritten
    _file(env.dty, f"{SID}_9_201126_0730.tdms", 30)          # no such trial (yet) -> nothing
    _file(env.aty, f"{SID}_1_201126_0800.tdms", 30)
    res = ya.scan_once(run=lambda fn: fn())
    assert sorted(c[:2] for c in env.calls) == [("aty", 101), ("dty", 101)]
    assert all(c[3] == 7 for c in env.calls)                 # saved as the series owner
    assert len(res["analysed"]) == 2 and not res["failed"]
    assert sorted(b[3] for b in env.bell) == ["yarnscope_auto_aty", "yarnscope_auto_dty"]
    assert all(b[0] == 7 and b[1] == SID for b in env.bell)


def test_failed_file_is_not_retried_until_it_changes(env):
    p = _file(env.dty, f"{SID}_5_201126_0700.tdms", 30)
    res = ya.scan_once(run=lambda fn: fn())
    assert res["failed"] and res["failed"][0]["trial"] == 105 and not env.bell
    env.calls.clear()
    ya.scan_once(run=lambda fn: fn())
    assert env.calls == []
    t = time.time() - 20 * 60                                 # file replaced (new date) -> tried again
    os.utime(p, (t, t))
    ya.scan_once(run=lambda fn: fn())
    assert [c[1] for c in env.calls] == [105]
