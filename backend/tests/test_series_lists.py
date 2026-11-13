"""All Experiments + Backlog (read only): same rows as the desktop, rights enforced."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth, deps
from app.main import app

from db import series_overview as so
from db.connection import fetch_all


@pytest.fixture()
def client():
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID")
    if not rows:
        pytest.skip("no superuser on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c


def test_experiments_same_rows_as_desktop(client):
    data = client.get("/api/experiments").json()
    core_rows = so.all_experiments_rows(None, so.experiment_request_field())
    assert [r["series_id"] for r in data["rows"]] == [r["series_id_pk"] for r in core_rows]
    assert data["machines"][0] == "All"


def test_experiments_machine_filter(client):
    afk = client.get("/api/experiments?machine=AFK").json()["rows"]
    assert len(afk) == len(so.all_experiments_rows(so.MACHINE_FILTERS["AFK"]))
    assert all(r["machine"] for r in afk)


def test_backlog_boxes_and_archive(client):
    data = client.get("/api/backlog").json()
    assert [b["id"] for b in data["boxes"]] == [1, 2, 3, 4]
    for b in data["boxes"]:
        assert [c["series_id"] for c in b["cards"]] == [r["TrialSeriesID"] for r in so.backlog_rows(b["id"])]
        for c in b["cards"]:
            if b["id"] not in (2, 3):
                assert c["owner_colour"] is None          # stripe only In Progress / Done (desktop rule)
    assert len(data["archived"]) == len(so.archived_rows())
    for r in data["archived"]:
        assert r["year"] == (r["experiment_id"][:4] if r["experiment_id"][:4].isdigit() else "?")


def test_feature_rights_enforced(client, monkeypatch):
    monkeypatch.setattr(deps, "can_use", lambda user, key: key != "backlog")
    assert client.get("/api/backlog").status_code == 403
    assert client.get("/api/experiments").status_code == 200


def test_lists_need_login():
    c = TestClient(app)
    assert c.get("/api/experiments").status_code == 401
    assert c.get("/api/backlog").status_code == 401
