"""Right-click actions of Show Experiment in the web: notes, history, fill row, retest, delete rules."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth, series_actions
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
    rows = fetch_all("SELECT T.TrialSeriesID AS S, T.ID AS T FROM tblTrial T "
                     "JOIN tblTrialSeries S ON S.ID = T.TrialSeriesID WHERE T.AirPressure IS NOT NULL "
                     "ORDER BY T.TrialSeriesID DESC, T.Versuchsnummer LIMIT 1")
    if not rows:
        pytest.skip("no trial with air pressure")
    return int(rows[0]["S"]), int(rows[0]["T"])


@pytest.fixture(autouse=True)
def _no_usage_log(monkeypatch):
    monkeypatch.setattr(series_actions, "log_usage_event", lambda *a: None)


def test_note_on_a_value_and_on_a_trial_round_trip():
    c = _client()
    sid, tid = _series_trial()
    ref = {"tab": "machine", "r": 3, "c": 0}
    before = c.post(f"/api/series/{sid}/notes/list", json=ref).json()
    if not before["available"]:
        pytest.skip("tblNote missing")
    ids = []
    try:
        r = c.post(f"/api/series/{sid}/notes", json=dict(ref, text="web test note"))
        assert r.status_code == 200
        ids.append(r.json()["id"])
        got = c.post(f"/api/series/{sid}/notes/list", json=ref).json()["notes"]
        mine = [n for n in got if n["id"] == ids[0]]
        assert mine and mine[0]["can_edit"] and mine[0]["can_delete"]
        row = fetch_all("SELECT TableName, FieldName, TrialID FROM tblNote WHERE ID = ?", [ids[0]])[0]
        assert row["TableName"].lower() == "tbltrial" and int(row["TrialID"]) == tid
        assert c.put(f"/api/notes/{ids[0]}", json={"text": "changed"}).status_code == 200
        assert fetch_all("SELECT NoteText FROM tblNote WHERE ID = ?", [ids[0]])[0]["NoteText"] == "changed"
        # whole trial
        r = c.post(f"/api/series/{sid}/notes", json={"trial_id": tid, "text": "trial note"})
        ids.append(r.json()["id"])
        row = fetch_all("SELECT TableName, RowID, FieldName FROM tblNote WHERE ID = ?", [ids[1]])[0]
        assert (row["TableName"], int(row["RowID"]), row["FieldName"]) == ("tblTrial", tid, "")
        # a trial of another series is refused
        other = fetch_all("SELECT ID FROM tblTrial WHERE TrialSeriesID <> ? LIMIT 1", [sid])[0]["ID"]
        assert c.post(f"/api/series/{sid}/notes", json={"trial_id": other, "text": "x"}).status_code == 400
        assert c.delete(f"/api/notes/{ids[0]}").status_code == 200
        assert not fetch_all("SELECT ID FROM tblNote WHERE ID = ?", [ids[0]])
    finally:
        for i in ids:
            execute("DELETE FROM tblNote WHERE ID = ?", [i])


def test_history_is_superuser_only():
    sid, _t = _series_trial()
    ref = {"tab": "machine", "r": 3, "c": 0}
    assert _client(0, 3).post(f"/api/series/{sid}/history", json=ref).status_code == 403
    r = _client().post(f"/api/series/{sid}/history", json=ref)
    assert r.status_code == 200 and "rows" in r.json()
    assert _client().get(f"/api/series/{sid}/history").status_code == 200


def test_fill_row_returns_edits_without_saving():
    c = _client()
    sid, _t = _series_trial()
    info = c.post(f"/api/series/{sid}/fill/info", json={"tab": "machine", "r": 3}).json()
    assert info["kind"] == "text" and info["n_trials"] >= 1
    before = fetch_all("SELECT AirPressure FROM tblTrial WHERE TrialSeriesID = ? ORDER BY ID", [sid])
    r = c.post(f"/api/series/{sid}/fill", json={"tab": "machine", "r": 3, "start": 1, "end": info["n_trials"],
                                                "value": "7.3"}).json()
    assert all(e["value"] == "7.3" for e in r["edits"])
    assert fetch_all("SELECT AirPressure FROM tblTrial WHERE TrialSeriesID = ? ORDER BY ID", [sid]) == before
    bad = c.post(f"/api/series/{sid}/fill", json={"tab": "machine", "r": 3, "start": 1, "end": 1, "value": "abc"})
    assert bad.status_code == 400
    # jet row: dropdown kind, display = jet name
    info = c.post(f"/api/series/{sid}/fill/info", json={"tab": "machine", "r": 1}).json()
    assert info["kind"] == "jet"


def test_retest_and_deletes_check_rights():
    sid, tid = _series_trial()
    low = _client(0, 1)
    assert low.post(f"/api/series/{sid}/retest", json={"tab": "titer", "trial_id": tid}).status_code == 403
    assert low.post(f"/api/series/{sid}/fill", json={"tab": "machine", "r": 3, "start": 1, "end": 1,
                                                     "value": "1"}).status_code == 403
    rights = low.get(f"/api/series/{sid}/rights").json()
    assert rights["history"] is False and rights["write"] is False
    if not rights["delete_trials"]:
        assert low.post(f"/api/series/{sid}/trials/delete", json={"trial_ids": [tid]}).status_code == 403
    if not rights["delete_series"]:
        assert low.post(f"/api/series/{sid}/delete").status_code == 403
    p = _client().post(f"/api/series/{sid}/trials/delete/preview", json={"trial_ids": [tid]}).json()
    assert p["names"].startswith("V") and all("what" in x for x in p["rows"])
    assert _client().post(f"/api/series/{sid}/retest", json={"tab": "nope", "trial_id": tid}).status_code == 400
