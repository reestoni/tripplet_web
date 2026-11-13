"""Show Experiment (read only): same cells as db/series_tables, login required."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app

from db import series_tables as stb
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


def _series_with_lab_data(n=5):
    table = stb._first_table(("tbltiter", "tblLaborTiter"))
    if not table:
        pytest.skip("no titer table")
    rows = fetch_all(f"SELECT DISTINCT T.TrialSeriesID AS S FROM {table} L JOIN tblTrial T ON T.ID = L.TrialID "
                     "ORDER BY S DESC LIMIT ?", [n])
    if not rows:
        pytest.skip("no titer data on dev_local")
    return [r["S"] for r in rows]


def test_needs_login():
    assert TestClient(app).get("/api/series/1").status_code == 401


def test_unknown_series(client):
    r = client.get("/api/series/987654321")
    assert r.status_code == 404 and r.json()["code"] == "not_found"


def test_cells_match_shared_builders(client):
    for sid in _series_with_lab_data():
        d = client.get(f"/api/series/{sid}").json()
        st = stb.load_trials(sid)
        assert [t["label"] for t in d["trials"]] == st.labels
        info = stb.jet_info_rows(st.trial_ids)
        for tab in d["tabs"]:
            lt = next(x for x in stb.LAB_TABS if x.key == tab["key"])
            p = lt.build(st)
            assert [r["title"] for r in tab["rows"]] == [t for t, _ in info] + p.row_titles
            for r, row in enumerate(tab["rows"][len(info):]):
                assert [c["v"] for c in row["cells"]] == ["" if v is None else str(v) for v, _b in p.cells[r]]


def test_titer_out_of_tolerance_marks_stat_ds_orange(client):
    for sid in _series_with_lab_data(20):
        st = stb.load_trials(sid)
        titer, ds = stb.build_titer(st), stb.build_stat_ds(st)
        if titer and ds and titer.extra.get("out_of_tolerance"):
            d = client.get(f"/api/series/{sid}").json()
            tab = next(t for t in d["tabs"] if t["key"] == "stat_ds")
            ten = tab["rows"][3 + 2]["cells"]                    # 3 info rows, Tenacity = data row 2
            for c in titer.extra["out_of_tolerance"]:
                assert ten[c].get("alert") in ("orange", "red")
            return
    pytest.skip("no series with titer deviation and Statimat DS")


def test_cv_limit_rule():
    assert stb.cv_limit_alert("Elongation CV (%)", "10")
    assert stb.cv_limit_alert("Tenacity CV (%)", "12,5")
    assert not stb.cv_limit_alert("Tenacity CV (%)", "9.99")
    assert not stb.cv_limit_alert("Elongation (%)", "40")
    assert not stb.cv_limit_alert("Elongation CV (%)", "")


# --- Machine Data -------------------------------------------------------------------
def _multi_ply_series():
    rows = fetch_all("SELECT T.TrialSeriesID AS S FROM tblTrialSettings TS JOIN tblTrial T ON T.ID = TS.TrialID "
                     "GROUP BY T.TrialSeriesID HAVING COUNT(*) > COUNT(DISTINCT TS.TrialID) ORDER BY S DESC LIMIT 1")
    if not rows:
        pytest.skip("no multi-ply series on dev_local")
    return int(rows[0]["S"])


def test_machine_modes(client):
    from db import machine_data as mdm
    sid = _multi_ply_series()
    st = stb.load_trials(sid)
    single = client.get(f"/api/series/{sid}/machine?mode=single").json()
    compact = client.get(f"/api/series/{sid}/machine?mode=compact").json()
    md = mdm.build_machine_data(st, "single")
    assert len(single["columns"]) == len(md.columns) > len(st.trials)
    assert len(compact["columns"]) == len(st.trials)          # one column per trial
    hidden = set(md.process_hidden_rows or ()) | ({md.custom_group_row} if md.custom_group_row is not None else set())
    assert [r["title"] for r in single["rows"]] == [t for i, t in enumerate(md.row_titles) if i not in hidden]
    jets, housing = mdm.load_jets_lookup(), mdm.load_housing_lookup()
    r0 = next(i for i in range(len(md.row_titles)) if i not in hidden)
    assert [c["v"] for c in single["rows"][0]["cells"]] == \
        [mdm.display_text(md, r0, c, jets.map, housing.map) for c in range(len(md.columns))]
    assert client.get(f"/api/series/{sid}/machine?mode=bogus").json()["mode"] == "single"


def test_machine_needs_login_and_series(client):
    assert TestClient(app).get("/api/series/1/machine").status_code == 401
    assert client.get("/api/series/987654321/machine").status_code == 404
