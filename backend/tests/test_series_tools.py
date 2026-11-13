"""Show Experiment tools in the web: copy trials, Yarns… dialog, reference samples, labels, PDF import rules.
Real round trips on dev_local; everything created is removed again (recycle bin + permanent delete)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth, series_tools
from app.main import app

from db import recycle_bin
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


@pytest.fixture(autouse=True)
def _no_usage_log(monkeypatch):
    monkeypatch.setattr(series_tools, "log_usage_event", lambda *a: None)


def _series():
    rows = fetch_all("SELECT s.ID FROM tblTrialSeries s WHERE (SELECT COUNT(*) FROM tblTrial t WHERE t.TrialSeriesID = s.ID) "
                     "BETWEEN 2 AND 6 ORDER BY s.ID DESC LIMIT 1")
    if not rows:
        pytest.skip("no small series")
    return int(rows[0]["ID"])


def _trial_ids(sid):
    return [int(r["ID"]) for r in fetch_all("SELECT ID FROM tblTrial WHERE TrialSeriesID = ? ORDER BY ID", [sid])]


def _remove(sid, ids):
    """Delete what a test created (outside a request: set a superuser as current user first)."""
    if not ids:
        return
    from app import user_context
    uid = fetch_all("SELECT u.ID FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                    "WHERE ar.AccessLevel >= 4 ORDER BY u.ID LIMIT 1")[0]["ID"]
    tok = user_context.set_user({"id": int(uid), "access_level": 5})
    try:
        bin_id = recycle_bin.delete_trials(sid, ids, "web test")
        recycle_bin.delete_permanently(bin_id)
    finally:
        user_context.reset(tok)


def test_copy_trials_with_changed_value(monkeypatch):
    c = _client()
    sid = _series()
    before = _trial_ids(sid)
    setup = c.get(f"/api/series/{sid}/copy-setup").json()
    air = next((f for f in setup["fields"] if "Air" in f["label"] and not f["choices"]), None)
    if air is None:
        pytest.skip("no air pressure field")
    src = setup["trials"][0]["id"]
    assert c.post(f"/api/series/{sid}/copy", json={"plan": [{"source": src, "values": {air["key"]: "abc"}}]}).status_code == 400
    new = []
    try:
        r = c.post(f"/api/series/{sid}/copy", json={"plan": [{"source": src, "values": {}},
                                                            {"source": src, "values": {air["key"]: "4.25"}}]})
        assert r.status_code == 200, r.text
        new = r.json()["new_ids"]
        assert len(new) == 2 and set(_trial_ids(sid)) == set(before) | set(new)
        col = air["key"].split(":", 1)[1]
        assert float(fetch_all(f"SELECT [{col}] AS v FROM tblTrial WHERE ID = ?", [new[1]])[0]["v"]) == 4.25
    finally:
        _remove(sid, new)
    assert _trial_ids(sid) == before


def test_read_only_users_cannot_write():
    c = _client(0, 1)
    sid = _series()
    assert c.post(f"/api/series/{sid}/copy", json={"plan": [{"source": 1}]}).status_code == 403
    assert c.post(f"/api/series/{sid}/references", json={"name": "x"}).status_code in (403, 409)
    assert c.post(f"/api/series/{sid}/pdf-import", json={"kind": "statimat", "ids": [1]}).status_code == 403
    assert c.get(f"/api/series/{sid}/yarns").json()["editable"] is False


def test_yarns_add_end_round_trip():
    c = _client()
    sid = _series()
    st = c.get(f"/api/series/{sid}/yarns").json()
    if not st["rows"]:
        pytest.skip("no plies")
    before = fetch_all("SELECT * FROM tblTrialSettings WHERE TrialID IN (SELECT ID FROM tblTrial WHERE TrialSeriesID = ?) "
                       "ORDER BY ID", [sid])
    rows = [{"ply": r["ply"], "yarn_id": r["yarn_id"], "use_id": r["use_id"], "ends": dict(r["ends"])} for r in st["rows"]]
    tid = next(iter(rows[0]["ends"]))
    rows[0]["ends"][tid] = rows[0]["ends"][tid] + 1
    try:
        chk = c.post(f"/api/series/{sid}/yarns", json={"rows": rows}).json()
        assert chk["applied"] is False and len(chk["changes"]) == 1
        r = c.post(f"/api/series/{sid}/yarns", json={"rows": rows, "apply": True}).json()
        assert r["applied"] is True
        after = c.get(f"/api/series/{sid}/yarns").json()
        assert after["rows"][0]["ends"][tid] == rows[0]["ends"][tid]
    finally:
        keep = {int(b["ID"]) for b in before}
        for a in fetch_all("SELECT ID FROM tblTrialSettings WHERE TrialID IN (SELECT ID FROM tblTrial WHERE TrialSeriesID = ?)", [sid]):
            if int(a["ID"]) not in keep:
                execute("DELETE FROM tblTrialSettings WHERE ID = ?", [a["ID"]])
    left = fetch_all("SELECT * FROM tblTrialSettings WHERE TrialID IN (SELECT ID FROM tblTrial WHERE TrialSeriesID = ?) "
                     "ORDER BY ID", [sid])
    assert left == before


def test_reference_sample_add_rename_unmark():
    c = _client()
    sid = _series()
    before = _trial_ids(sid)
    r = c.post(f"/api/series/{sid}/references", json={"name": "web ref test"})
    if r.status_code == 409:
        pytest.skip("no reference columns")
    tid = r.json()["trial_id"]
    try:
        row = fetch_all("SELECT Versuchsnummer, IsReference, ReferenceName FROM tblTrial WHERE ID = ?", [tid])[0]
        assert int(row["Versuchsnummer"]) < 0 and int(row["IsReference"]) == 1 and row["ReferenceName"] == "web ref test"
        assert c.post(f"/api/series/{sid}/references/{tid}/rename", json={"name": "renamed"}).status_code == 200
        r = c.post(f"/api/series/{sid}/references/{tid}/flag", json={"make_reference": False}).json()
        assert r["new_number"] and r["new_number"] > 0
    finally:
        _remove(sid, [tid])
    assert _trial_ids(sid) == before


def test_labels_pdf_and_pdf_import_allow_list():
    c = _client()
    sid = _series()
    info = c.get(f"/api/series/{sid}/labels").json()
    r = c.post(f"/api/series/{sid}/labels/pdf", json={"from_no": info["range"][0], "to_no": info["range"][1],
                                                      "start_index": 0, "template": info["template"]})
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    bad = dict(info["template"], ColumnCount=0)
    assert c.post(f"/api/series/{sid}/labels/pdf", json={"from_no": 1, "to_no": 1, "template": bad}).status_code == 400
    # a PDF id of another series is refused
    assert c.post(f"/api/series/{sid}/pdf-import", json={"kind": "statimat", "ids": [999999999]}).status_code == 404


def test_ref_compare_and_criteria_sets():
    c = _client()
    rows = fetch_all("SELECT TrialSeriesID AS S, ID FROM tblTrial WHERE IsReference = 1 LIMIT 1")
    if not rows:
        pytest.skip("no reference sample")
    sid, ref = int(rows[0]["S"]), int(rows[0]["ID"])
    setup = c.get(f"/api/series/{sid}/ref-compare/setup").json()
    assert any(r["id"] == ref for r in setup["refs"])
    r = c.post(f"/api/series/{sid}/ref-compare", json={"ref_id": ref, "criteria": {}, "fresh": True}).json()
    key = r["metrics"][0]["key"]
    r = c.post(f"/api/series/{sid}/ref-compare", json={"ref_id": ref, "criteria": {key: {"dir": "close", "tol": 100}}}).json()
    assert all(x["total"] == 1 for x in r["rows"]) and all(x["trial_id"] != ref for x in r["rows"])
    assert c.post(f"/api/series/{sid}/ref-compare", json={"ref_id": 999999999}).status_code == 400
    if not setup["db"]:
        return
    saved = c.post("/api/series/ref-criteria", json={"name": "web test criteria", "criteria": {key: {"dir": "higher"}}}).json()
    try:
        assert any(x["name"] == "web test criteria" for x in saved["sets"])
        assert c.post("/api/series/ref-criteria", json={"name": "web test criteria", "criteria": {key: {"dir": "lower"}}}).status_code == 400
    finally:
        c.delete(f"/api/series/ref-criteria/{saved['id']}")
    assert not fetch_all("SELECT ID FROM tblRefCriteriaSet WHERE Name = 'web test criteria'")
