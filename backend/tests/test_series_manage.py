"""Series menu of Backlog / All Experiments: rights, rename/prio/machine round trips, yarn plan checks."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth
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


def _series():
    # (no SQL pattern with [..]: db/connection translates brackets inside literals)
    rows = fetch_all("SELECT ID, SeriesName, BacklogPrio, MachineID FROM tblTrialSeries ORDER BY ID DESC LIMIT 200")
    rows = [r for r in rows if str(r["SeriesName"] or "")[:2].isdigit() and str(r["SeriesName"])[2:3] == " "]
    if not rows:
        pytest.skip("no series")
    return rows[0]


def test_manage_info_and_read_only_rights():
    s = _series()
    info = _client().get(f"/api/series/{s['ID']}/manage").json()
    assert info["prefix"] and info["name"].startswith(info["prefix"])
    assert [x["id"] for x in info["statuses"]] == [1, 2, 3, 4, 5]
    assert info["rights"]["machine"] is True
    low = _client(0, 1).get(f"/api/series/{s['ID']}/manage").json()
    assert low["rights"]["rename"] is False and low["rights"]["machine"] is False


def test_rename_keeps_prefix_and_prio_range():
    s = _series()
    c = _client()
    try:
        r = c.post(f"/api/series/{s['ID']}/rename", json={"text": "  web rename test "}).json()
        assert r["name"] == s["SeriesName"][:3] + "web rename test"
        assert c.post(f"/api/series/{s['ID']}/rename", json={"text": "   "}).status_code == 400
        assert c.post(f"/api/series/{s['ID']}/prio", json={"prio": 1000}).status_code == 400
        assert c.post(f"/api/series/{s['ID']}/prio", json={"prio": 7}).status_code == 200
        assert fetch_all("SELECT BacklogPrio FROM tblTrialSeries WHERE ID = ?", [s["ID"]])[0]["BacklogPrio"] == 7
    finally:
        execute("UPDATE tblTrialSeries SET SeriesName = ?, BacklogPrio = ? WHERE ID = ?",
                [s["SeriesName"], s["BacklogPrio"], s["ID"]])


def test_machine_and_yarn_are_superuser_only():
    s = _series()
    low = _client(2, 3)
    assert low.get(f"/api/series/{s['ID']}/machines").status_code == 403
    assert low.post(f"/api/series/{s['ID']}/machine", json={"machine_id": s["MachineID"] or 1}).status_code == 403
    assert low.get(f"/api/series/{s['ID']}/yarn-lines").status_code == 403


def test_yarn_plan_check_and_stale_lines():
    s = _series()
    c = _client()
    lines = c.get(f"/api/series/{s['ID']}/yarn-lines").json()["lines"]
    if not lines:
        pytest.skip("series without plies")
    rows = [{"orig_ply": l["ply"], "orig_yid": l["yarn_id"], "new_yid": l["yarn_id"], "deleted": False, "is_new": False}
            for l in lines]
    r = c.post(f"/api/series/{s['ID']}/yarns/reassign", json={"rows": rows, "apply": False}).json()
    assert r["applied"] is False
    bad = [dict(rows[0], orig_ply="Ply 99")]
    assert c.post(f"/api/series/{s['ID']}/yarns/reassign", json={"rows": bad, "apply": True}).status_code == 409
