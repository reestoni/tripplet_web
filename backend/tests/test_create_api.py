"""Create Experiment / Add Trial Series / Add Lab Machines in the web (app/create_api.py on
db/experiment_create.py). Read-only checks plus one real round trip on dev_local: new experiment,
second series in it, lab machines for its trials - everything is removed again afterwards
(recycle bin + permanent delete; the experiment goes with its last series)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth, create_api, user_context
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
    monkeypatch.setattr(create_api, "log_usage_event", lambda *a: None)


def _remove_series(sid):
    uid = fetch_all("SELECT u.ID FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                    "WHERE ar.AccessLevel >= 4 ORDER BY u.ID LIMIT 1")[0]["ID"]
    tok = user_context.set_user({"id": int(uid), "access_level": 5})
    try:
        recycle_bin.delete_permanently(recycle_bin.delete_series(sid, "web test"))
    finally:
        user_context.reset(tok)


def _first(groups, key):
    for g in groups:
        if g[key]:
            return g[key][0]
    pytest.skip(f"no {key}")


def test_setup_lists():
    c = _client()
    d = c.get("/api/create/setup?mode=create").json()
    assert d["product_groups"] and d["order_types"] and d["machines"] and d["housings"]
    assert d["yarns"]["groups"] and d["jets"] and d["lab_machines"]
    assert {"Backlog"} <= {s["name"] for s in d["backlog_statuses"]}
    assert all(lm["input"] in ("none", "itemat", "csv", "value") for lm in d["lab_machines"])
    a = c.get("/api/create/setup?mode=addlab").json()
    assert a["experiments"] and "yarns" not in a
    assert c.get("/api/create/setup?mode=nonsense").status_code == 400
    pg, ot = d["product_groups"][0]["id"], d["order_types"][0]["id"]
    assert len(c.get(f"/api/create/next-number?pg={pg}&ot={ot}").json()["number"]) == 3


def test_rules_ply_and_lab_planning():
    c = _client()
    d = c.get("/api/create/setup?mode=create").json()
    y1 = d["yarns"]["groups"][0]["yarns"][0]["id"]
    y2 = d["yarns"]["groups"][0]["yarns"][1]["id"]
    assert c.post("/api/create/ply", json={"materials": [], "yarn_id": y1}).json()["ply"] == "Ply 1"
    mats = [{"yarn_id": y1, "ply": "Ply 1"}, {"yarn_id": y1, "ply": "Ply 1"}]
    assert c.post("/api/create/ply", json={"materials": mats, "yarn_id": y1}).json()["ply"] == "Ply 1"
    assert c.post("/api/create/ply", json={"materials": mats, "yarn_id": y2}).json()["ply"] == "Ply 3"
    itemat = next((m for m in d["lab_machines"] if m["input"] == "itemat"), None)
    if itemat:
        r = c.post("/api/create/lab-entries", json={"mode": "create", "lm_id": itemat["id"], "tensions": [0.3]}).json()
        assert [e["value"] for e in r["entries"]] == [0.0, 0.3]
        ents = r["entries"]
        assert c.post("/api/create/lab-can-delete", json={"entries": ents, "index": 0}).json()["ok"] is False
        assert c.post("/api/create/lab-can-delete", json={"entries": ents, "index": 1}).json()["ok"] is True
        again = c.post("/api/create/lab-entries", json={"mode": "create", "lm_id": itemat["id"], "entries": ents,
                                                        "tensions": [0.3]}).json()
        assert again["entries"] == []
        assert c.post("/api/create/lab-entries", json={"mode": "create", "lm_id": itemat["id"],
                                                       "tensions": [0.5]}).status_code == 400
    csv = next((m for m in d["lab_machines"] if m["input"] == "csv"), None)
    if csv:
        r = c.post("/api/create/lab-entries", json={"mode": "create", "lm_id": csv["id"], "text": "4, 5"}).json()
        assert [e["value"] for e in r["entries"]] == [4.0, 5.0] and all(e["freeform"] for e in r["entries"])
        assert c.post("/api/create/lab-entries", json={"mode": "create", "lm_id": csv["id"], "text": "4, x"}).status_code == 400


def test_save_refuses_bad_input():
    c = _client()
    d = c.get("/api/create/setup?mode=create").json()
    base = {"mode": "create", "product_group": d["product_groups"][0]["id"], "order_type": d["order_types"][0]["id"],
            "series_name": "x", "machine_id": d["machines"][0]["id"],
            "materials": [{"yarn_id": _first(d["yarns"]["groups"], "yarns")["id"], "ply": "Ply 1"}],
            "jets": [{"jet_id": _first(d["jets"], "jets")["id"], "housing_id": d["housings"][0]["id"],
                      "plates": "1,2", "pressure": "4"}]}
    for patch, code in (({"series_name": " "}, "no_series_name"),
                        ({"materials": []}, "no_material"),
                        ({"materials": [{"yarn_id": base["materials"][0]["yarn_id"], "ply": "Ply 2"}]}, "bad_ply"),
                        ({"jets": [{**base["jets"][0], "housing_id": None}]}, "no_housing"),
                        ({"jets": [{**base["jets"][0], "pressure": "4.123"}]}, "bad_jet_row"),
                        ({"machine_values": {"99999": "1"}}, "bad_input"),
                        ({"lab": [{"lm_id": 99999}]}, "bad_input")):
        r = c.post("/api/create/save", json={**base, **patch})
        assert r.status_code == 400 and r.json()["code"] == code, (patch, r.text)


def test_read_only_user_cannot_create():
    c = _client(0, 1)
    d = c.get("/api/create/setup?mode=create")
    nav = c.get("/api/nav").json()
    routes = {it["route"] for s in nav["sections"] for it in s["items"]}
    # whoever does not see "New Experiment" in the sidebar may not use the endpoints either
    assert ("/experiments/new" in routes) == (d.status_code == 200)


def test_create_addseries_addlab_roundtrip():
    c = _client()
    d = c.get("/api/create/setup?mode=create").json()
    machine = next((m for m in d["machines"] if not m["joker"]), None)
    if machine is None:
        pytest.skip("no normal machine")
    fields = c.get(f"/api/create/machine-fields/{machine['id']}").json()["fields"]
    yarn = _first(d["yarns"]["groups"], "yarns")
    jet = _first(d["jets"], "jets")
    housing = d["housings"][0]["id"]
    titer = next((m for m in d["lab_machines"] if m["input"] == "none" and not m["freeform"]), None)
    lab = []
    if titer:
        lab = c.post("/api/create/lab-entries", json={"mode": "create", "lm_id": titer["id"]}).json()["entries"]
    values = {}
    num = next((f for f in fields if f["kind"] in ("double", "int")), None)
    if num:
        values[str(num["fno"])] = "3"
    body = {"mode": "create", "product_group": d["product_groups"][0]["id"], "order_type": d["order_types"][0]["id"],
            "series_name": "web test create", "backlog_status": d["backlog_default"], "backlog_prio": 2,
            "machine_id": machine["id"], "machine_values": values,
            "materials": [{"yarn_id": yarn["id"], "ply": "Ply 1"}, {"yarn_id": yarn["id"], "ply": "Ply 1"}],
            "jets": [{"jet_id": jet["id"], "housing_id": housing, "plates": "1,2,3", "pressure": "4,5"}],
            "lab": lab}
    created = []
    try:
        r = c.post("/api/create/save", json=body)
        assert r.status_code == 200, r.text
        res = r.json()
        created.append(res["series_id"])
        assert res["trials"] == 3 and res["label"].count("-") == 2
        s = fetch_all("SELECT SeriesName, MachineID, BacklogPrio FROM tblTrialSeries WHERE ID = ?", [res["series_id"]])[0]
        assert s["SeriesName"] == "01 web test create" and int(s["MachineID"]) == machine["id"] and int(s["BacklogPrio"]) == 2
        trials = fetch_all("SELECT ID, Versuchsnummer AS V, AirPressure AS P, JetPlate AS J FROM tblTrial WHERE TrialSeriesID = ? "
                           "ORDER BY Versuchsnummer", [res["series_id"]])
        assert [int(t["V"]) for t in trials] == [1, 2, 3] and float(trials[0]["P"]) == 4.5
        assert [str(t["J"]) for t in trials] == ["1", "2", "3"]
        plies = fetch_all("SELECT Ply FROM tblTrialSettings WHERE TrialID = ?", [trials[0]["ID"]])
        assert [p["Ply"] for p in plies] == ["Ply 1", "Ply 1"]
        assert c.get(f"/api/series/{res['series_id']}").status_code == 200

        # "Copy TrialSeries" prefill: experiment + jet rows of the series
        cp = c.get(f"/api/create/series/{res['series_id']}/jets").json()
        assert cp["experiment_id"] == res["experiment_id"]
        assert [(j["jet_id"], j["housing_id"], j["plates"]) for j in cp["jets"]] == [(jet["id"], housing, "1,2,3")]

        # a second series in the same experiment ("Add Trial Series")
        r2 = c.post("/api/create/save", json={**body, "mode": "addseries", "experiment_id": res["experiment_id"],
                                              "series_name": "web test series", "lab": []})
        assert r2.status_code == 200, r2.text
        created.append(r2.json()["series_id"])
        assert r2.json()["label"] == res["label"]
        name2 = fetch_all("SELECT SeriesName FROM tblTrialSeries WHERE ID = ?", [created[1]])[0]["SeriesName"]
        assert name2 == "02 web test series"

        # Add Lab Machines on the second series
        a = c.get("/api/create/setup?mode=addlab").json()
        itemat = next((m for m in a["lab_machines"] if m["input"] == "itemat"), None)
        if itemat is None:
            pytest.skip("no Itemat machine")
        tids = [t["id"] for t in c.get(f"/api/create/series/{created[1]}/trials").json()["trials"]]
        ents = c.post("/api/create/lab-entries", json={"mode": "addlab", "lm_id": itemat["id"], "tensions": [0.6],
                                                       "trial_ids": tids[:2]}).json()["entries"]
        r3 = c.post("/api/create/lab-save", json={"series_id": created[1], "trial_ids": tids[:2], "lab": ents})
        assert r3.status_code == 200, r3.text
        assert r3.json()["created"] == 4 and r3.json()["skipped"] == 0
        r4 = c.post("/api/create/lab-save", json={"series_id": created[1], "trial_ids": tids[:2], "lab": ents})
        assert r4.json()["created"] == 0 and r4.json()["skipped"] == 4
        # the 0.0 baseline is not offered again once every chosen trial has it
        again = c.post("/api/create/lab-entries", json={"mode": "addlab", "lm_id": itemat["id"], "tensions": [1.0],
                                                        "trial_ids": tids[:2]}).json()["entries"]
        assert [e["value"] for e in again] == [1.0]
        assert c.post("/api/create/lab-save", json={"series_id": res["series_id"], "trial_ids": tids[:1],
                                                     "lab": ents}).json()["code"] == "bad_trial"
    finally:
        for sid in reversed(created):
            _remove_series(sid)
    for sid in created:
        assert not fetch_all("SELECT ID FROM tblTrialSeries WHERE ID = ?", [sid])


def test_legacy_addtrials_trial_ply_roundtrip():
    """Legacy import (typed ID, no duplicates), then "+T" add trials with a "+ Trial" ply on that series."""
    c = _client()
    d = c.get("/api/create/setup?mode=legacy").json()
    assert d["requests"] == [] and d["product_groups"]
    pg, ot = d["product_groups"][-1]["id"], d["order_types"][-1]["id"]
    if ot > 9:
        pytest.skip("order type id with more than one digit")
    legacy = f"1999-{pg}{ot}-001"
    if c.get(f"/api/create/legacy-id?id={legacy}").json()["taken"]:
        pytest.skip("test id taken on dev_local")
    assert c.get("/api/create/legacy-id?id=1999-7-01").json()["code"] == "legacy_format"
    machine = next((m for m in d["machines"] if not m["joker"]), None)
    yarn = _first(d["yarns"]["groups"], "yarns")
    jet = _first(d["jets"], "jets")
    body = {"mode": "legacy", "legacy_id": legacy, "series_name": "web test legacy", "backlog_status": d["backlog_default"],
            "machine_id": machine["id"], "materials": [{"yarn_id": yarn["id"], "ply": "Ply 1"}],
            "jets": [{"jet_id": jet["id"], "housing_id": d["housings"][0]["id"], "plates": "1,2", "pressure": "4"}]}
    created, shadow = [], []
    try:
        r = c.post("/api/create/save", json=body)
        assert r.status_code == 200, r.text
        sid = r.json()["series_id"]
        created.append(sid)
        assert r.json()["label"] == legacy
        assert c.get(f"/api/create/legacy-id?id={legacy}").json()["taken"] is True
        again = c.post("/api/create/save", json=body)
        assert again.status_code == 400 and again.json()["code"] == "legacy_taken"

        # "+T": add trials to that series, second ply = output of its trial V1 ("+ Trial")
        a = c.get(f"/api/create/setup?mode=addtrials&series={sid}").json()
        assert a["series_info"]["machine_id"] == machine["id"] and a["series_info"]["ply_offset"] == 1
        v1 = c.get(f"/api/create/series/{sid}/trials").json()["trials"][0]["id"]
        found = c.get(f"/api/create/trials-search?q={legacy} legacy").json()["trials"]
        assert any(t["id"] == v1 for t in found)
        ty = c.post("/api/create/trial-yarn", json={"trial_id": v1}).json()
        shadow.append(ty["yarn_id"])
        assert c.post("/api/create/trial-yarn", json={"trial_id": v1}).json()["yarn_id"] == ty["yarn_id"]  # reused
        p1 = c.post("/api/create/ply", json={"materials": [], "yarn_id": yarn["id"], "series_id": sid}).json()
        assert p1["ply"] == "Ply 1"                                   # same yarn keeps its ply in the series
        mats = [{"yarn_id": yarn["id"], "ply": "Ply 1"}]
        p2 = c.post("/api/create/ply", json={"materials": mats, "yarn_id": ty["yarn_id"], "series_id": sid}).json()
        assert p2["ply"] == "Ply 3" and p2["conflict"] is None         # offset 1 + 1 row + 1
        add = {"mode": "addtrials", "series_id": sid, "machine_id": 999999,   # ignored: the series' machine
               "materials": mats + [{"yarn_id": ty["yarn_id"], "ply": "Ply 3"}],
               "jets": [{"jet_id": jet["id"], "housing_id": d["housings"][0]["id"], "plates": "5", "pressure": "3,5"}],
               "lab": a["series_lab"]}
        r2 = c.post("/api/create/save", json=add)
        assert r2.status_code == 200, r2.text
        assert r2.json()["series_id"] == sid and r2.json()["trials"] == 1
        trials = fetch_all("SELECT ID, Versuchsnummer AS V FROM tblTrial WHERE TrialSeriesID = ? ORDER BY Versuchsnummer", [sid])
        assert [int(t["V"]) for t in trials] == [1, 2, 3]
        plies = fetch_all("SELECT Ply, YarnID FROM tblTrialSettings WHERE TrialID = ? ORDER BY Ply", [trials[-1]["ID"]])
        assert [(p["Ply"], int(p["YarnID"])) for p in plies] == [("Ply 1", yarn["id"]), ("Ply 3", ty["yarn_id"])]

        st = c.get(f"/api/create/stock/{yarn['id']}").json()
        assert "spools" in st and all("location" in s for s in st["spools"])
    finally:
        # the recycle bin refuses a series whose trials have semi-finished yarns -> those first
        for y in shadow:
            execute("DELETE FROM tblTrialSettings WHERE YarnID = ?", [y])
            execute("DELETE FROM tblYarn WHERE ID = ? AND SourceTrialID IS NOT NULL", [y])
        for s in reversed(created):
            _remove_series(s)
    assert not fetch_all("SELECT ID FROM tblTrialSeries WHERE ID IN (%s)" % ",".join(str(s) for s in created or [0]))
