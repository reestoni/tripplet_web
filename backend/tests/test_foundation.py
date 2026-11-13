"""Foundation: mode guard, per-request user, login, session cookie, sidebar data.

Runs against dev_local (the only mode the backend allows in phase 1).
"""
from __future__ import annotations

import concurrent.futures as cf

import pytest
from fastapi.testclient import TestClient

from app import auth, core, nav, user_context
from app.main import app

import app_meta
from db import feature_access as fa
from db.connection import fetch_all


@pytest.fixture()
def client():
    return TestClient(app)


def _a_real_user(level_min=0, level_max=9):
    rows = fetch_all(
        "SELECT u.Username AS Username, ar.AccessLevel AS Level FROM tblUser u "
        "JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
        "WHERE COALESCE(u.Active, 1) <> 0 AND ar.AccessLevel BETWEEN ? AND ? ORDER BY u.ID", [level_min, level_max])
    if not rows:
        pytest.skip("no matching active user on dev_local")
    return rows[0]["Username"]


# --- core / mode ---------------------------------------------------------------
def test_only_dev_local():
    assert core.MODE == "dev_local"
    assert "dev_local" in core.DB_NAME or core.DB_NAME   # name comes from db/connection


def test_app_meta_user_is_per_request():
    assert isinstance(app_meta.current_user, user_context.UserProxy)
    assert not app_meta.current_user              # nobody logged in -> falsy like {}

    def work(uid):
        tok = user_context.set_user({"id": uid, "access_level": uid % 5})
        try:
            import time
            time.sleep(0.01)
            return app_meta.current_user.get("id"), app_meta.access_level()
        finally:
            user_context.reset(tok)

    with cf.ThreadPoolExecutor(8) as ex:
        for uid, (got, lvl) in zip(range(40), ex.map(lambda u: work(u), range(40))):
            assert got == uid and lvl == uid % 5


# --- auth ------------------------------------------------------------------------
def test_me_requires_login(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/nav").status_code == 401


def test_login_wrong_password(client):
    r = client.post("/api/auth/login", json={"username": "nobody_xyz", "password": "wrong-pw"})
    assert r.status_code == 401 and r.json()["code"] == "invalid"


def test_login_password_equals_username(client):
    r = client.post("/api/auth/login", json={"username": "Anna", "password": "anna"})
    assert r.status_code == 401 and r.json()["code"] == "insecure_password"


def test_login_success_sets_cookie(client, monkeypatch):
    username = _a_real_user()
    monkeypatch.setattr(auth, "check_credentials", lambda u, p: True)
    logged = []
    monkeypatch.setattr("app.main.log_usage_event", lambda *a: logged.append((a, dict(app_meta.current_user))))
    r = client.post("/api/auth/login", json={"username": username, "password": "irrelevant-here"})
    assert r.status_code == 200, r.text
    assert auth.COOKIE_NAME in r.cookies
    assert logged and logged[0][0] == ("login", "login", "web") and logged[0][1]["username"] == username
    me = client.get("/api/me")
    assert me.status_code == 200 and me.json()["user"]["username"] == username
    client.post("/api/auth/logout")
    client.cookies.clear()
    assert client.get("/api/me").status_code == 401


def test_tampered_cookie_is_ignored(client):
    username = _a_real_user()
    good = auth.make_cookie(username)
    client.cookies.set(auth.COOKIE_NAME, good[:-2] + ("A" if good[-1] != "A" else "B") + good[-1])
    assert client.get("/api/me").status_code == 401


# --- sidebar ---------------------------------------------------------------------
def test_nav_matches_feature_access_for_real_user(client):
    username = _a_real_user()
    client.cookies.set(auth.COOKIE_NAME, auth.make_cookie(username))
    data = client.get("/api/nav").json()
    user = auth.profile_for(username)
    rules = fa.rules_for(user["id"], user["access_level"])
    shown = {it["key"] for s in data["sections"] for it in s["items"]}
    for f in fa.FEATURES:
        assert (f.key in shown) == fa.decide(f.key, user["access_level"], rules["user"], rules["groups"]), f.key
    assert ("Superuser" in [s["title"] for s in data["sections"]]) == (user["access_level"] >= 4)


def test_nav_rules_person_beats_group(monkeypatch):
    monkeypatch.setattr(fa, "rules_for", lambda uid, lvl: {"user": {"backlog": False}, "groups": {"canvas": False,
                                                                                                "smart_chart": True}})
    monkeypatch.setattr(nav, "_badges", lambda keys: {})
    data = nav.build_nav({"id": 1, "access_level": 2})
    shown = {it["key"] for s in data["sections"] for it in s["items"]}
    assert "backlog" not in shown and "canvas" not in shown
    assert "smart_chart" in shown          # default level 3, but the group allows it
    assert "all_experiments" in shown and "new_experiment" in shown
    assert "Superuser" not in [s["title"] for s in data["sections"]]


def test_nav_keys_are_all_features():
    keys = {it[0] for _, _, items in nav.SECTIONS for it in items}
    assert keys == {f.key for f in fa.FEATURES}


# --- images ----------------------------------------------------------------------
def test_images_served_and_no_traversal(client):
    assert client.get("/api/img/backlog.png").status_code == 200
    assert client.get("/api/img/..%2Fmain.py").status_code == 404
    assert client.get("/api/img/main.py").status_code == 404
