"""Editing Show Experiment through the web: server-side bindings, input rules, plausibility, real save."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth, series_edit
from app.main import app

from db.connection import execute, fetch_all


def _client(min_level=4, max_level=9):
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel BETWEEN ? AND ? AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID",
                     [min_level, max_level])
    if not rows:
        pytest.skip("no matching user on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c


def _series_trial():
    rows = fetch_all("SELECT T.TrialSeriesID AS S, T.ID AS T, T.AirPressure AS A FROM tblTrial T "
                     "JOIN tblTrialSeries S ON S.ID = T.TrialSeriesID WHERE T.AirPressure IS NOT NULL "
                     "ORDER BY T.TrialSeriesID DESC, T.Versuchsnummer LIMIT 1")
    if not rows:
        pytest.skip("no trial with air pressure")
    return int(rows[0]["S"]), int(rows[0]["T"]), rows[0]["A"]


def test_read_only_users_cannot_save():
    c = _client(0, 1)
    sid, _t, _a = _series_trial()
    r = c.post(f"/api/series/{sid}/save", json={"edits": [{"tab": "machine", "r": 3, "c": 0, "value": "3"}]})
    assert r.status_code == 403


def test_invalid_and_unknown_cells_are_refused():
    c = _client()
    sid, _t, _a = _series_trial()
    r = c.post(f"/api/series/{sid}/save", json={"edits": [{"tab": "machine", "r": 3, "c": 0, "value": "abc"},
                                                          {"tab": "machine", "r": 999, "c": 0, "value": "1"},
                                                          {"tab": "nope", "r": 0, "c": 0, "value": "1"}]})
    assert r.status_code == 400
    codes = sorted(x["code"] for x in r.json()["cells"])
    assert codes == ["invalid", "unknown_cell", "unknown_cell"]


def test_unusual_value_asks_first_then_saves_with_change_log(monkeypatch):
    c = _client()
    sid, tid, old = _series_trial()
    monkeypatch.setattr(series_edit, "log_usage_event", lambda *a: None)
    edits = [{"tab": "machine", "r": 3, "c": 0, "value": "35"}]
    r = c.post(f"/api/series/{sid}/save", json={"edits": edits}).json()
    if r["kind"] == "confirm":
        assert r["warnings"] and "35" in r["warnings"][0]
    before_log = fetch_all("SELECT COALESCE(MAX(ID), 0) AS m FROM tblChangeLog")[0]["m"]
    try:
        r = c.post(f"/api/series/{sid}/save", json={"edits": edits, "confirmed": True}).json()
        assert r["kind"] == "saved"
        assert float(fetch_all("SELECT AirPressure FROM tblTrial WHERE ID = ?", [tid])[0]["AirPressure"]) == 35.0
        log = fetch_all("SELECT FieldName, NewValue, Source FROM tblChangeLog WHERE ID > ?", [before_log])
        assert any(x["FieldName"].lower() == "airpressure" and x["Source"] == "edit" for x in log)
    finally:
        execute("UPDATE tblTrial SET AirPressure = ? WHERE ID = ?", [old, tid])
        execute("DELETE FROM tblChangeLog WHERE ID > ?", [before_log])
    assert fetch_all("SELECT AirPressure FROM tblTrial WHERE ID = ?", [tid])[0]["AirPressure"] == old


def test_save_conflict_when_someone_else_changed_the_cell(monkeypatch):
    """Two editors: the page sends the value it loaded (orig); changed in the DB since -> kind "conflict"
    (db/series_save.find_conflicts, same rule as the desktop), overwrite=True saves anyway."""
    c = _client()
    sid, tid, old = _series_trial()
    monkeypatch.setattr(series_edit, "log_usage_event", lambda *a: None)
    base = float(old)
    before_log = fetch_all("SELECT COALESCE(MAX(ID), 0) AS m FROM tblChangeLog")[0]["m"]
    mine, theirs = f"{base + 0.5:g}", base + 1.0
    edits = [{"tab": "machine", "r": 3, "c": 0, "value": mine, "orig": f"{base:g}"}]
    try:
        execute("UPDATE tblTrial SET AirPressure = ? WHERE ID = ?", [theirs, tid])        # the other person
        r = c.post(f"/api/series/{sid}/save", json={"edits": edits, "confirmed": True}).json()
        assert r["kind"] == "conflict" and len(r["cells"]) == 1
        x = r["cells"][0]
        assert (x["tab"], x["r"], x["c"]) == ("machine", 3, 0) and float(x["current"]) == theirs and x["mine"] == mine
        assert float(fetch_all("SELECT AirPressure FROM tblTrial WHERE ID = ?", [tid])[0]["AirPressure"]) == theirs

        # same value as the other person -> no conflict
        same = [{"tab": "machine", "r": 3, "c": 0, "value": f"{theirs:g}", "orig": f"{base:g}"}]
        assert c.post(f"/api/series/{sid}/save", json={"edits": same, "confirmed": True}).json()["kind"] == "saved"

        # overwrite anyway
        execute("UPDATE tblTrial SET AirPressure = ? WHERE ID = ?", [theirs, tid])
        r = c.post(f"/api/series/{sid}/save", json={"edits": edits, "confirmed": True, "overwrite": True}).json()
        assert r["kind"] == "saved"
        assert float(fetch_all("SELECT AirPressure FROM tblTrial WHERE ID = ?", [tid])[0]["AirPressure"]) == base + 0.5

        # unchanged since loading -> saves without asking
        ok = [{"tab": "machine", "r": 3, "c": 0, "value": f"{base:g}", "orig": mine}]
        assert c.post(f"/api/series/{sid}/save", json={"edits": ok, "confirmed": True}).json()["kind"] == "saved"
    finally:
        execute("UPDATE tblTrial SET AirPressure = ? WHERE ID = ?", [old, tid])
        execute("DELETE FROM tblChangeLog WHERE ID > ?", [before_log])
    assert fetch_all("SELECT AirPressure FROM tblTrial WHERE ID = ?", [tid])[0]["AirPressure"] == old
