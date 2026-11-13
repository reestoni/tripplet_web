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


def test_jet_air(client):
    rows = fetch_all("SELECT TrialSeriesID AS S FROM tblLaborJetAirConsumption ORDER BY S DESC LIMIT 1")
    if not rows:
        pytest.skip("no jet air data")
    sid = int(rows[0]["S"])
    d = client.get(f"/api/series/{sid}").json()
    assert any(t["key"] == "jet_air" and t.get("lazy") for t in d["tabs"])
    for unit in ("Nm3h", "lmin"):
        j = client.get(f"/api/series/{sid}/jet-air?unit={unit}").json()
        p = stb.build_jet_air(sid, unit)
        assert j["unit"] == unit and j["consumption"]["columns"] == p.consumption.col_titles
        assert [r["title"] for r in j["atm"]["rows"]] == p.atm.row_titles
    assert client.get("/api/series/987654321/jet-air").status_code == 404


def test_notes_on_cells_and_list(client):
    from db import cell_notes
    if not cell_notes.available():
        pytest.skip("no tblNote")
    rows = fetch_all("SELECT SeriesID AS S FROM tblNote WHERE SeriesID IS NOT NULL GROUP BY SeriesID LIMIT 1")
    if not rows:
        pytest.skip("no notes on dev_local")
    sid = int(rows[0]["S"])
    d = client.get(f"/api/series/{sid}").json()
    all_notes = cell_notes.notes_for_series(sid, stb.load_trials(sid).trial_ids)
    assert {n["id"] for n in d["notes"]} == {int(n["ID"]) for n in all_notes}
    in_cells = {x["id"] for t in d["tabs"] for r in t["rows"] for c in r["cells"] for x in c.get("notes", [])}
    m = client.get(f"/api/series/{sid}/machine").json()
    in_cells |= {x["id"] for r in m["rows"] for c in r["cells"] for x in c.get("notes", [])}
    in_cells |= {x["id"] for col in m["columns"] for x in col["notes"]}
    for n in d["notes"]:
        if n["where_tab"] in ("machine",) or n["where_tab"] in {t["key"] for t in d["tabs"]} or n["trial_note"]:
            assert n["id"] in in_cells or n["where_tab"] == "machine"


def test_attachments(client):
    from db import series_attachments as sa
    rows = fetch_all("SELECT TrialSeriesID AS S FROM tblTrialSeriesImage GROUP BY TrialSeriesID LIMIT 1")
    if not rows:
        pytest.skip("no images on dev_local")
    sid = int(rows[0]["S"])
    d = client.get(f"/api/series/{sid}/attachments").json()
    assert [i["id"] for i in d["images"]] == [r["ID"] for r in sa.list_images(sid)]
    first = d["images"][0]["id"]
    if sa.file_for_download("image", sid, first):
        assert client.get(f"/api/series/{sid}/attachments/image/{first}").status_code == 200
    # an image id of another series / an unknown kind is never served
    assert client.get(f"/api/series/{sid + 100000}/attachments/image/{first}").status_code == 404
    assert client.get(f"/api/series/{sid}/attachments/exe/{first}").status_code == 404
    assert TestClient(app).get(f"/api/series/{sid}/attachments/image/{first}").status_code == 401


def test_rd_machine_data(client):
    rows = fetch_all("SELECT S.ID AS S FROM tblTrialSeries S JOIN tblMachineFields MF ON MF.MachineID = S.MachineID "
                     "JOIN tblTrial T ON T.TrialSeriesID = S.ID WHERE COALESCE(MF.RDSetting, 0) = 1 LIMIT 1")
    if not rows:
        pytest.skip("no series with R&D fields")
    sid = int(rows[0]["S"])
    assert client.get(f"/api/series/{sid}").json()["has_rd"] is True
    d = client.get(f"/api/series/{sid}/rd").json()
    assert d["visible"] and d["rows"][0]["title"] == "Housing"
    assert all(len(r["cells"]) == len(d["columns"]) for r in d["rows"])
    assert client.get("/api/series/987654321/rd").status_code == 404


def test_retest_banner_lists_open_flags():
    """Open retest flag on a lab tab -> "retest" list of that tab (banner above the table). The flag row is
    inserted directly (no backlog move) and deleted again."""
    import pytest
    from fastapi.testclient import TestClient
    from app import auth
    from app.main import app
    from db import retest_flags, series_tables as stb
    from db.connection import execute, fetch_all
    if not retest_flags.flags_table_ready():
        pytest.skip("no retest table")
    user = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= 1 ORDER BY u.ID LIMIT 1")[0]["Username"]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(user))
    found = None
    for row in fetch_all("SELECT DISTINCT t.TrialSeriesID AS sid FROM tbltrial t ORDER BY t.TrialSeriesID DESC LIMIT 40"):
        d = c.get(f"/api/series/{row['sid']}").json()
        tab = next((t for t in d.get("tabs", []) if not t.get("lazy") and t["key"] in {x.key for x in stb.LAB_TABS}), None)
        if tab and d["trials"]:
            found = (row["sid"], tab["key"], d["trials"][0])
            break
    if not found:
        pytest.skip("no series with a lab tab")
    sid, key, trial = found
    src = next(x.lab_source for x in stb.LAB_TABS if x.key == key)
    execute("INSERT INTO tblTrialRetestFlag (TrialID, TrialSeriesID, LabSource, Status, Note, CreatedAt) "
            "VALUES (?, ?, ?, 'open', '__webtest', NOW())", [trial["id"], sid, src])
    try:
        tab = next(t for t in c.get(f"/api/series/{sid}").json()["tabs"] if t["key"] == key)
        assert {"trial": trial["label"], "note": "__webtest"} in tab["retest"] or any(
            x["note"] == "__webtest" for x in tab["retest"])
    finally:
        execute("DELETE FROM tblTrialRetestFlag WHERE Note = '__webtest'")


def test_materials_and_jet_air_sync_plan():
    """Material line (most frequent yarn per ply + stock summary) and the read-only sync plan of Jet Air."""
    import pytest
    from fastapi.testclient import TestClient
    from app import auth
    from app.main import app
    from db.connection import fetch_all
    from db.yarn_spools import series_materials
    user = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= 1 ORDER BY u.ID LIMIT 1")[0]["Username"]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(user))
    row = fetch_all("SELECT t.TrialSeriesID AS sid FROM tbltrialsettings ts JOIN tbltrial t ON t.ID = ts.TrialID "
                    "WHERE ts.YarnID IS NOT NULL ORDER BY t.ID DESC LIMIT 1")
    if not row:
        pytest.skip("no series with yarns")
    sid = row[0]["sid"]
    m = c.get(f"/api/series/{sid}/materials").json()["materials"]
    assert [x["yarn_id"] for x in m] == [x["yarn_id"] for x in series_materials(sid)]
    plan = c.get(f"/api/series/{sid}/jet-air/sync-plan").json()
    assert plan["status"] in ("unavailable", "nothing_found", "in_sync", "changes")


def test_knowledge_base_links():
    """KB routes like the desktop ui/kb_links: lab tabs, Machine Data rows (DTY / ATY stations), the DTY Process
    cell by its value, Manage Yarn Material / Garntyp values."""
    from fastapi.testclient import TestClient
    from app import auth
    from app.main import app
    from app.series_view import kb_url
    from db.connection import fetch_all
    from ui import kb_links
    assert kb_url(("man_made_fibres", 2, None, "pes")) == "/knowledge-base/man_made_fibres?scene=2&fibre=pes"
    assert kb_url(("filament_spinning", None, None)) == "/knowledge-base/filament_spinning"
    assert kb_url(None) is None
    user = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= 4 ORDER BY u.ID LIMIT 1")[0]["Username"]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(user))
    sid = fetch_all("SELECT TrialSeriesID AS s FROM tbltrial ORDER BY ID DESC LIMIT 1")[0]["s"]
    tabs = c.get(f"/api/series/{sid}").json()["tabs"]
    for t in tabs:
        assert t.get("kb") == kb_url(kb_links.LAB_TABLE_TARGET.get("tbl_" + t["key"]))
    y = c.get("/api/admin/yarn").json()
    sp = y["special"]
    if sp["material"]:
        names = dict((str(i), n) for i, n in y["fk"][sp["material"]])
        for vid, url in y["kb"].get(sp["material"], {}).items():
            assert url == kb_url(kb_links.value_target("material", names[vid]))
