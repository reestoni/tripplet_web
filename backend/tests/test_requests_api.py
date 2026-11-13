"""Experiment Requests through the web API (rules from db/experiment_requests): real round trip on
dev_local that removes everything it created."""
from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app

from db import experiment_request_images as ei
from db.connection import execute, fetch_all

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4//8/AAX+Av7czFnnAAAAAElFTkSuQmCC")


@pytest.fixture()
def client():
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID")
    if not rows:
        pytest.skip("no superuser on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c


def _count():
    return (fetch_all("SELECT COUNT(*) AS n FROM tblExperimentRequests")[0]["n"],
            fetch_all("SELECT COUNT(*) AS n FROM tblExperimentRequestImage")[0]["n"])


def test_needs_login():
    assert TestClient(app).get("/api/requests").status_code == 401


def test_list_and_form(client):
    d = client.get("/api/requests").json()
    assert d["is_superuser"] and "rows" in d
    f = client.get("/api/requests/form").json()
    assert any(x["name"] == "Titel" and x["required"] for x in f["fields"])
    assert client.get("/api/requests/987654321").status_code == 404


def test_round_trip(client, monkeypatch):
    import db.experiment_requests as er
    monkeypatch.setattr(er, "notify_owner", lambda *a, **k: None)
    before = _count()
    fields = client.get("/api/requests/form").json()["fields"]
    values = {f["name"]: "" for f in fields}
    assert client.post("/api/requests", json={"values": {"Titel": "x"}}).json()["kind"] == "invalid"
    for name in ("Titel", "Versuchsgrund", "Aufgabe", "Beurteilungsparameter", "Versuchsbedingungen"):
        if name in values:
            values[name] = f"WEBTEST {name}"
    values["Wunschtermin"] = "2026-12-01"
    res = client.post("/api/requests", json={"values": values}).json()
    assert res["kind"] == "inserted", res
    rid = res["request_id"]
    try:
        d = client.get(f"/api/requests/{rid}").json()
        assert d["status_id"] == 1 and all("FullPath" not in i for i in d["images"])
        form = {k: ("" if v is None else str(v)[:10] if k == "Wunschtermin" else str(v)) for k, v in d["form"].items()}
        assert client.put(f"/api/requests/{rid}", json={"values": form}).json()["kind"] == "unchanged"
        form["Bemerkungen"] = "WEBTEST changed"
        assert client.put(f"/api/requests/{rid}", json={"values": form}).json()["kind"] == "updated"   # superuser
        st = client.post(f"/api/requests/{rid}/status", json={"status_id": 2}).json()
        assert st["kind"] == "needs_reason"
        assert client.post(f"/api/requests/{rid}/status", json={"status_id": 2, "reason": "web test"}).json()["kind"] == "changed"
        assert client.post(f"/api/requests/{rid}/status", json={"status_id": 3}).json()["kind"] == "changed"
        up = client.post(f"/api/requests/{rid}/images", files=[("files", ("x.png", PNG, "image/png"))]).json()
        assert up["stored"] == 1, up
        imgs = client.get(f"/api/requests/{rid}/images").json()["images"]
        assert client.get(f"/api/requests/{rid}/images/{imgs[0]['id']}/file").content == PNG
        assert client.post(f"/api/requests/{rid}/images/delete", json={"image_ids": [imgs[0]["id"]]}).json()["deleted"]
    finally:
        for img in ei.list_images(rid):
            execute("DELETE FROM tblExperimentRequestImage WHERE ID = ?", [img["ID"]])
        execute("DELETE FROM tblExperimentRequests WHERE PriorVersionOfID = ?", [rid])
        execute("DELETE FROM tblExperimentRequests WHERE ID = ?", [rid])
        execute("DELETE FROM tblnotification WHERE Message LIKE ?", [f"%#{rid}%"])
    assert _count() == before
