"""Machine path schema (app/schema.py): same data as the desktop panel (db/machine_schema.py)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app

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


def _series(machine_type: int, multi_ply: bool = True):
    having = "HAVING COUNT(TS.ID) > COUNT(DISTINCT T.ID)" if multi_ply else ""
    rows = fetch_all(f"""SELECT S.ID FROM tblTrialSeries S JOIN tblmaschine M ON M.ID = S.MachineID
        JOIN tblTrial T ON T.TrialSeriesID = S.ID JOIN tblTrialSettings TS ON TS.TrialID = T.ID
        WHERE M.Maschinentyp = ? GROUP BY S.ID {having} ORDER BY S.ID DESC LIMIT 1""", [machine_type])
    if not rows:
        pytest.skip(f"no series of machine type {machine_type} on dev_local")
    return rows[0]["ID"]


def test_needs_login():
    assert TestClient(app).get("/api/series/1/schema").status_code == 401


def test_unknown_series(client):
    assert client.get("/api/series/999999999/schema").status_code == 404


def test_dty_schema(client):
    sid = _series(1)
    d = client.get(f"/api/series/{sid}/schema?mode=single").json()
    if d["profile"] is None:
        pytest.skip("tbldtyprocess missing on dev_local")
    assert d["profile"] == "dty"
    assert d["trials"] and d["trial_id"] == d["trials"][0]["trial_id"]
    assert len(d["plies"]) >= 2 and sorted(d["order"]) == list(range(len(d["plies"])))
    assert d["main"] in d["order"]
    assert {"lw2", "mainjet", "winder"} <= set(d["stations"])
    meta = d["meta"]
    assert meta["mainjet"]["kb"]["module"] == "dty_intermingling"
    assert "jet" in meta["mainjet"]["rows"] and meta["creel"]["per_ply"] and not meta["lw2"]["per_ply"]
    assert meta["elastane"]["kb"] is None
    # other plies run into a ply of the trial at a station
    for k, pl in enumerate(d["plies"]):
        if k != d["main"]:
            assert pl["into"] in range(len(d["plies"])) and pl["at"]
    # second trial
    if len(d["trials"]) > 1:
        t2 = d["trials"][1]["trial_id"]
        d2 = client.get(f"/api/series/{sid}/schema?trial={t2}").json()
        assert d2["trial_id"] == t2


def test_dty_matches_desktop_builder(client):
    """The endpoint returns exactly what db/machine_schema builds for the desktop."""
    from db import machine_data as mdm
    from db import machine_schema as ms
    from db import series_tables as stb
    sid = _series(1)
    d = client.get(f"/api/series/{sid}/schema").json()
    if d["profile"] is None:
        pytest.skip("tbldtyprocess missing on dev_local")
    st = stb.load_trials(sid)
    md = mdm.build_machine_data(st, "single")
    src = ms.MachineDataSource(md, mdm.load_jets_lookup().map, mdm.load_housing_lookup().map)
    ref = ms.build_dty_path(src, 0, ms.load_yarn_types(md.col_specs))
    assert d["values"] == ref["values"] and d["warnings"] == ref["warnings"]
    assert [pl["values"] for pl in d["plies"]] == [pl["values"] for pl in ref["plies"]]


def test_aty_schema(client):
    sid = _series(3)
    d = client.get(f"/api/series/{sid}/schema").json()
    assert d["profile"] == "aty"
    assert {"feed", "jet", "winder"} <= set(d["stations"])
    assert d["meta"]["jet"]["kb"]["module"] == "aty_air_texturing"
    assert all(pl["role"] in ("core", "effect", "elastane", None) for pl in d["plies"])


def test_no_schema_on_other_machines(client):
    rows = fetch_all("""SELECT S.ID FROM tblTrialSeries S JOIN tblmaschine M ON M.ID = S.MachineID
        JOIN tblTrial T ON T.TrialSeriesID = S.ID WHERE M.Maschinentyp NOT IN (1, 3)
        GROUP BY S.ID ORDER BY S.ID DESC LIMIT 1""")
    if not rows:
        pytest.skip("no other machine type")
    assert client.get(f"/api/series/{rows[0]['ID']}/schema").json()["profile"] is None
