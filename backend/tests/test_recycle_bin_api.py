"""Recycle Bin in the web (app/recycle_bin_api.py on db/recycle_bin.py). One real round trip on dev_local: a small
series is created, deleted into the bin, previewed (back / keep), restored and finally removed permanently."""
from __future__ import annotations

import pytest

from app import core, user_context  # noqa: F401  (core first: sys.path for db/)
from db import recycle_bin
from db.connection import fetch_all

from test_create_api import _client, _first, _remove_series


def _make_series(c) -> int:
    d = c.get("/api/create/setup?mode=create").json()
    machine = next((m for m in d["machines"] if not m["joker"]), None)
    if machine is None:
        pytest.skip("no normal machine")
    yarn = _first(d["yarns"]["groups"], "yarns")
    jet = _first(d["jets"], "jets")
    body = {"mode": "create", "product_group": d["product_groups"][0]["id"], "order_type": d["order_types"][0]["id"],
            "series_name": "web test recycle", "backlog_status": d["backlog_default"], "backlog_prio": 2,
            "machine_id": machine["id"], "machine_values": {},
            "materials": [{"yarn_id": yarn["id"], "ply": "Ply 1"}],
            "jets": [{"jet_id": jet["id"], "housing_id": d["housings"][0]["id"], "plates": "1", "pressure": "4"}], "lab": []}
    r = c.post("/api/create/save", json=body)
    assert r.status_code == 200, r.text
    return int(r.json()["series_id"])


def _to_bin(sid: int) -> int:
    uid = fetch_all("SELECT u.ID FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                    "WHERE ar.AccessLevel >= 4 ORDER BY u.ID LIMIT 1")[0]["ID"]
    tok = user_context.set_user({"id": int(uid), "access_level": 5})
    try:
        return recycle_bin.delete_series(sid, "web test recycle")
    finally:
        user_context.reset(tok)


def _exists(sid: int) -> bool:
    return bool(fetch_all("SELECT ID FROM tblTrialSeries WHERE ID = ?", [sid]))


def test_roundtrip():
    if not recycle_bin.available():
        pytest.skip("no recycle bin")
    c = _client()
    sid = _make_series(c)
    try:
        bin_id = _to_bin(sid)
        assert not _exists(sid)
        lst = c.get("/api/superuser/recycle-bin").json()
        entry = next(e for e in lst["entries"] if e["id"] == bin_id)
        assert entry["type"] == "trial series"
        when = entry["deleted_at"]
        # preview -> read only banner -> back into the bin with the same date
        assert c.post(f"/api/superuser/recycle-bin/{bin_id}/preview").json()["series_id"] == sid
        assert _exists(sid)
        assert c.get(f"/api/series/{sid}").json()["recycle_preview"]["deleted_at"] == when
        assert not any(e["id"] == bin_id for e in c.get("/api/superuser/recycle-bin").json()["entries"])
        assert c.post(f"/api/superuser/recycle-bin/preview/{sid}/back").json()["ok"]
        assert not _exists(sid)
        entry = next(e for e in c.get("/api/superuser/recycle-bin").json()["entries"] if e["object_id"] == sid)
        assert entry["deleted_at"] == when
        # preview -> keep
        c.post(f"/api/superuser/recycle-bin/{entry['id']}/preview")
        assert c.post(f"/api/superuser/recycle-bin/preview/{sid}/keep").json()["ok"]
        assert _exists(sid) and c.get(f"/api/series/{sid}").json()["recycle_preview"] is None
        # plain restore
        bin_id = _to_bin(sid)
        assert c.post(f"/api/superuser/recycle-bin/{bin_id}/restore").json()["label"]
        assert _exists(sid)
    finally:
        if _exists(sid):
            _remove_series(sid)


def test_superuser_only():
    c = _client(1, 3)
    assert c.get("/api/superuser/recycle-bin").json()["code"] == "superuser_only"
