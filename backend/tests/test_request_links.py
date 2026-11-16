"""Experiment Request popup, version history and the series links (ER/RE icons,
Experiment ID -> series) through the web API - read-only on dev_local."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app

from db.connection import fetch_all


def _client(min_level: int, max_level: int = 99):
    rows = fetch_all("SELECT u.Username, u.ID FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= ? AND ar.AccessLevel <= ? AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID",
                     [min_level, max_level])
    if not rows:
        pytest.skip("no such user on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c, rows[0]["ID"]


def _linked():
    rows = fetch_all("SELECT e.ID, e.ExperimentID, e.ExperimentRequestID AS R, ts.ID AS S FROM tblExperimente e "
                     "JOIN tblTrialSeries ts ON ts.ExperimentID = e.ID "
                     "JOIN tblExperimentRequests er ON er.ID = e.ExperimentRequestID LIMIT 1")
    if not rows:
        pytest.skip("no linked request on dev_local")
    return rows[0]


def test_popup_for_linked_request_any_user():
    r = _linked()
    c, _uid = _client(1, 3)
    d = c.get(f"/api/requests/{r['R']}/view").json()
    assert d["id"] == r["R"] and d["title"] and isinstance(d["display"], list)
    assert all("FullPath" not in str(i) for i in d["images"])
    assert c.get(f"/api/series/{r['S']}/request").json()["request_id"] == r["R"]
    s = c.get(f"/api/series/{r['S']}").json()["series"]
    assert s["experiment_request_id"] == r["R"]


def test_unlinked_foreign_request_hidden_from_normal_user():
    c, uid = _client(1, 3)
    rows = fetch_all("SELECT er.ID FROM tblExperimentRequests er WHERE er.CreatedBy <> ? AND er.PriorVersionOfID IS NULL "
                     "AND er.ID NOT IN (SELECT ExperimentRequestID FROM tblExperimente WHERE ExperimentRequestID IS NOT NULL) "
                     "LIMIT 1", [uid])
    if not rows:
        pytest.skip("no unlinked foreign request")
    assert c.get(f"/api/requests/{rows[0]['ID']}/view").status_code == 403


def test_versions_and_compare():
    rows = fetch_all("SELECT PriorVersionOfID AS P, MIN(ID) AS O FROM tblExperimentRequests "
                     "WHERE PriorVersionOfID IS NOT NULL GROUP BY PriorVersionOfID LIMIT 1")
    if not rows:
        pytest.skip("no versions on dev_local")
    c, _ = _client(4)
    v = c.get(f"/api/requests/{rows[0]['P']}/versions").json()["versions"]
    assert v[0]["current"] and v[0]["version"] == len(v)
    cmp = c.get(f"/api/requests/{rows[0]['P']}/versions/{rows[0]['O']}/compare").json()
    assert "rows" in cmp
    assert c.get(f"/api/requests/{rows[0]['P']}/versions/{rows[0]['P']}/compare").status_code == 404
    lst = c.get("/api/requests").json()["rows"]
    assert any(r["has_history"] for r in lst if r["id"] == rows[0]["P"])


def test_reports_and_experiment_series():
    r = _linked()
    c, _ = _client(4)
    d = c.get("/api/experiment-series", params={"exp_id": r["ExperimentID"]}).json()
    assert d["experiment_pk"] == r["ID"] and any(s["id"] == r["S"] for s in d["series"])
    assert c.get("/api/experiment-series", params={"exp_id": "nope"}).json()["series"] == []
    rep = fetch_all("SELECT SeriesPK FROM tblSmartChartReport WHERE IsTemplate=0 AND SeriesPK IS NOT NULL LIMIT 1")
    if rep:
        lst = c.get(f"/api/series/{rep[0]['SeriesPK']}/reports").json()["reports"]
        assert lst and "id" in lst[0]


def test_request_preview_ids():
    """Badge on "New Experiment": IDs of the approved requests (db/experiment_requests.requests_by_status)."""
    from db import experiment_requests as er
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID")
    if not rows:
        pytest.skip("no superuser")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    d = c.get("/api/requests/preview?status=3").json()
    assert d["ids"] == [int(r["ID"]) for r in er.requests_by_status(3)]
    assert all(r.get("PriorVersionOfID") in (None, "") for r in er.requests_by_status(3))
    assert c.get("/api/requests/preview?status=5").status_code == 400
