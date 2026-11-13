"""Settings in the web (app/settings_api.py on db/user_account.py + db/display_settings.py).
Everything runs on a test user (created and deleted here), so no real account is touched:
forced password change at login (password = user name), the settings round trip, the password change."""
from __future__ import annotations

import random
import string

import pytest
from fastapi.testclient import TestClient

from app import auth, settings_api
from app.main import app

from db import display_settings as ds
from db import user_account as uacc
from db import user_admin as uadm


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setattr(settings_api, "log_usage_event", lambda *a: None)


@pytest.fixture()
def test_user():
    n = min(uadm.username_max_len() or 5, 5)
    taken = {u.lower() for u in uadm.existing_usernames()}
    for _ in range(50):
        name = "z" + "".join(random.choices(string.ascii_lowercase, k=n - 1))
        if name.lower() not in taken:
            break
    else:
        pytest.skip("no free test user name")
    uid = uadm.create_user(name, "Start-" + name + "1", "Test", "Settings")
    assert uid
    try:
        yield name, uid
    finally:
        uadm.delete_users([uid])
        auth.forget(name)


def test_login_password_is_username_then_initial_change(test_user):
    name, _uid = test_user
    assert uadm.reset_password(name, name)            # password = user name (like a fresh desktop account)
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"username": name, "password": name})
    assert r.status_code == 401 and r.json()["code"] == "insecure_password"
    # wrong old password / same as user name -> desktop codes
    bad = c.post("/api/auth/initial-password", json={"username": name, "old": "nope", "new": "Neu-Pw-77", "repeat": "Neu-Pw-77"})
    assert bad.json()["code"] == uacc.PW_WRONG_OLD
    bad = c.post("/api/auth/initial-password", json={"username": name, "old": name, "new": "Neu-Pw-77", "repeat": "Neu-Pw-78"})
    assert bad.json()["code"] == uacc.PW_MISMATCH
    ok = c.post("/api/auth/initial-password", json={"username": name, "old": name, "new": "Neu-Pw-77", "repeat": "Neu-Pw-77"})
    assert ok.status_code == 200, ok.text
    assert c.get("/api/me").json()["user"]["username"].lower() == name.lower()   # logged in by the cookie


def test_settings_round_trip(test_user):
    name, uid = test_user
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(name))
    d = c.get("/api/settings").json()
    assert d["welcome_max"] == uacc.WELCOME_MAX_LEN and d["default_accent"] == uacc.DEFAULT_ACCENT
    assert all(set(o) == {"key", "nav_route", "web"} for o in d["start_options"])
    assert "display" in c.get("/api/me").json()

    assert c.post("/api/settings", json={"accent": "rot"}).json()["code"] == "bad_colour"
    assert c.post("/api/settings", json={"start": "no_such_screen"}).json()["code"] == "bad_start"

    start = d["start_options"][0]["key"] if d["start_options"] else None
    body = {"welcome": "Hallo Test", "accent": "#123abc", "prefs": {"contrast": True, "readbar": True, "scale": 130, "bogus": 1}}
    if start:
        body["start"] = start
    r = c.post("/api/settings", json=body)
    assert r.status_code == 200, r.text
    assert uacc.load_welcome_message(uid) == "Hallo Test"
    me = c.get("/api/me").json()
    assert me["user"]["accent_colour"].lower() == "#123abc"          # profile cache forgotten -> new colour at once
    if ds.has_column():
        p = ds.load(uid)
        assert p["contrast"] is True and p["readbar"] is True and p["scale"] == 130 and "bogus" not in p
        if start:
            assert p["start"] == start
        c.post("/api/settings/prefs", json={"prefs": {"scale": 150}})
        assert ds.load(uid)["scale"] == 150
        assert me["display"]["contrast"] is True


def test_change_password(test_user):
    name, _uid = test_user
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(name))
    old = "Start-" + name + "1"
    assert c.post("/api/settings/password", json={"old": old, "new": "", "repeat": ""}).json()["code"] == uacc.PW_INCOMPLETE
    assert c.post("/api/settings/password", json={"old": old, "new": name, "repeat": name}).json()["code"] == uacc.PW_SAME_AS_USER
    assert c.post("/api/settings/password", json={"old": old, "new": old, "repeat": old}).json()["code"] == uacc.PW_SAME_AS_OLD
    r = c.post("/api/settings/password", json={"old": old, "new": "Anders-99", "repeat": "Anders-99"})
    assert r.status_code == 200, r.text
    assert auth.attempt_login(name, "Anders-99")["username"].lower() == name.lower()
