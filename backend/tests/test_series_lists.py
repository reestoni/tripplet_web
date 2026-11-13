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


# --- moving cards ----------------------------------------------------------------
def _superuser_id():
    return int(fetch_all("SELECT u.ID FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                         "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID")[0]["ID"])


def test_move_denied_with_code(client, monkeypatch):
    from app import series_lists
    monkeypatch.setattr(series_lists.bm, "check_move", lambda *a, **k: "owner_only")
    called = []
    monkeypatch.setattr(series_lists.bm, "update_backlog_status", lambda *a: called.append(a))
    sid = so.backlog_rows(2)[0]["TrialSeriesID"]
    r = client.post("/api/backlog/move", json={"series_id": sid, "to_status": 3})
    assert r.status_code == 403 and r.json()["code"] == "owner_only" and not called


def test_move_joker_asks_for_machine(client, monkeypatch):
    from app import series_lists
    monkeypatch.setattr(series_lists.bm, "needs_machine", lambda *a: True)
    called = []
    monkeypatch.setattr(series_lists.bm, "update_backlog_status", lambda *a: called.append(a))
    monkeypatch.setattr(series_lists.bm, "after_move", lambda *a: None)
    rows = so.backlog_rows(1)
    if not rows:
        pytest.skip("no series in Backlog on dev_local")
    sid = rows[0]["TrialSeriesID"]
    r = client.post("/api/backlog/move", json={"series_id": sid, "to_status": 2})
    assert r.status_code == 409 and r.json()["code"] == "need_machine" and r.json()["machines"]
    m = r.json()["machines"][0]["id"]
    assert client.post("/api/backlog/move", json={"series_id": sid, "to_status": 2, "machine_id": -99}).status_code == 400
    r = client.post("/api/backlog/move", json={"series_id": sid, "to_status": 2, "machine_id": m})
    assert r.status_code == 200 and called == [(sid, 2, 1, _superuser_id(), m)]


def test_move_real_roundtrip_restores(client):
    """Real write on dev_local: In Progress -> Backlog -> In Progress, then restore the owner."""
    from db.connection import execute
    from db import backlog_moves as bm
    cand = [r for r in so.backlog_rows(2) if not bm.series_has_joker_machine(r["TrialSeriesID"])]
    if not cand:
        pytest.skip("no non-joker series in progress")
    sid = cand[0]["TrialSeriesID"]
    before = fetch_all("SELECT BacklogStatusID, BacklogOwner, MachineID FROM tblTrialSeries WHERE ID = ?", [sid])[0]
    try:
        assert client.post("/api/backlog/move", json={"series_id": sid, "to_status": 1}).json()["moved"]
        assert bm.series_state(sid)[0] == 1
        assert client.post("/api/backlog/move", json={"series_id": sid, "to_status": 2}).json()["moved"]
        assert bm.series_state(sid) == (2, _superuser_id())       # taking from Backlog sets the owner
    finally:
        execute("UPDATE tblTrialSeries SET BacklogStatusID = ?, BacklogOwner = ?, MachineID = ? WHERE ID = ?",
                [before["BacklogStatusID"], before["BacklogOwner"], before["MachineID"], sid])
    assert fetch_all("SELECT BacklogStatusID, BacklogOwner, MachineID FROM tblTrialSeries WHERE ID = ?",
                     [sid])[0] == before


def test_backlog_sends_the_welcome_line():
    from fastapi.testclient import TestClient
    from app import auth
    from app.main import app
    from db.connection import fetch_all
    from db.user_account import load_welcome_message
    u = fetch_all("SELECT u.ID, u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                  "WHERE ar.AccessLevel >= 1 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")[0]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u["Username"]))
    w = c.get("/api/backlog").json()["welcome"]
    assert w["message"] == load_welcome_message(u["ID"]) and "first_name" in w
