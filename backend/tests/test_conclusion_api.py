"""Conclusion of a series (app/conclusion_api.py on db/series_conclusion.py) + lists, move hint, search, request popup.
The conclusion written on a real series is deleted again; the archive move itself is replaced (nothing moves)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app

from db import backlog_moves as bm
from db import series_conclusion as sc
from db.connection import execute, fetch_all

pytestmark = pytest.mark.skipif(not sc.table_ready(), reason="tblSeriesConclusion missing")


@pytest.fixture()
def env():
    users = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                      "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID")
    rows = fetch_all("SELECT ts.ID, e.ExperimentRequestID FROM tblTrialSeries ts JOIN tblExperimente e ON e.ID = ts.ExperimentID "
                     "LEFT JOIN tblSeriesConclusion c ON c.TrialSeriesID = ts.ID "
                     "WHERE c.ID IS NULL AND e.ExperimentRequestID IS NOT NULL "
                     "AND EXISTS (SELECT 1 FROM tblTrial t WHERE t.TrialSeriesID = ts.ID) ORDER BY ts.ID DESC LIMIT 1")
    if not users or not rows:
        pytest.skip("no superuser / no series with a request on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(users[0]["Username"]))
    sid = int(rows[0]["ID"])
    yield c, sid, int(rows[0]["ExperimentRequestID"])
    sc.delete(sid)
    execute("DELETE FROM tblChangeLog WHERE SeriesID = ? AND Source = 'conclusion'", [sid])
    execute("DELETE FROM tblNotification WHERE TrialSeriesID = ? AND NotificationType = ?", [sid, sc.NOTIFICATION_TYPE])


def test_conclusion_roundtrip_and_lists(env, monkeypatch):
    c, sid, rid = env
    d = c.get(f"/api/series/{sid}/conclusion").json()
    assert d["ready"] and not d["exists"] and d["can_edit"] and d["request"]["request_id"] == rid
    assert c.get(f"/api/series/{sid}").json()["conclusion"] == {"exists": False, "outcome": None}

    # archiving without a conclusion asks first (409), "anyway" goes through - the move itself is replaced
    moved = []
    monkeypatch.setattr(bm, "series_state", lambda s: (3, None))
    monkeypatch.setattr(bm, "check_move", lambda *a, **k: None)
    monkeypatch.setattr(bm, "needs_machine", lambda *a: False)
    monkeypatch.setattr(bm, "update_backlog_status", lambda *a: moved.append(a))
    monkeypatch.setattr(bm, "after_move", lambda *a: None)
    r = c.post("/api/backlog/move", json={"series_id": sid, "to_status": 5})
    assert r.status_code == 409 and r.json()["code"] == "no_conclusion" and not moved
    assert c.post("/api/backlog/move", json={"series_id": sid, "to_status": 5, "ignore_conclusion": True}).json()["moved"]

    trial = fetch_all("SELECT ID FROM tblTrial WHERE TrialSeriesID = ? ORDER BY ID LIMIT 1", [sid])[0]["ID"]
    r = c.put(f"/api/series/{sid}/conclusion", json={"outcome": "achieved", "summary": "Web qqzz result",
                                                      "best_trials": [trial], "findings": "x", "recommendation": "release"})
    assert r.status_code == 200 and r.json()["created"] and r.json()["conclusion"]["outcome"] == "achieved"
    assert c.get(f"/api/series/{sid}").json()["conclusion"] == {"exists": True, "outcome": "achieved"}
    moved.clear()
    assert c.post("/api/backlog/move", json={"series_id": sid, "to_status": 5}).json()["moved"] and moved

    row = next(x for x in c.get("/api/experiments").json()["rows"] if x["series_id"] == sid)
    assert row["conclusion"] == {"outcome": "achieved", "summary": "Web qqzz result"}
    hits = c.get("/api/quick-search", params={"conclusion": "qqzz"}).json()["results"]
    assert any(h["series_id"] == sid for h in hits)
    view = c.get(f"/api/requests/{rid}/view").json()
    assert any(x["series_id"] == sid and x["summary"] == "Web qqzz result" for x in view.get("conclusions", []))


def test_errors(env):
    c, sid, _ = env
    r = c.put(f"/api/series/{sid}/conclusion", json={"outcome": "great"})
    assert r.status_code == 400 and r.json()["code"] == "invalid"
    r = c.put(f"/api/series/{sid}/conclusion", json={"summary": "x" * 301})
    assert r.status_code == 400 and r.json()["code"] == "too_long"
    r = c.put("/api/series/999999999/conclusion", json={"summary": "x"})
    assert r.status_code == 404


def test_report_slot_conclusions(env):
    """Report page button "✅ Conclusion": slot loadConclusions (db/series_conclusion.for_report), arguments checked."""
    c, sid, _ = env
    r = c.post("/api/report/slot/loadConclusions", json={"args": [f"[{sid}]"], "series_pk": sid}).json()
    assert r["receiver"] == "receiveConclusions" and r["args"][0][0]["series_id"] == sid and not r["args"][0][0]["exists"]
    for bad in ['["1; DROP"]', "[1.5]", "{}", "x", "[" + ",".join(["1"] * 21) + "]"]:
        assert c.post("/api/report/slot/loadConclusions", json={"args": [bad]}).status_code == 400, bad
