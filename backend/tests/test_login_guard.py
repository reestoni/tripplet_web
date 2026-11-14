"""Web login: lock after too many wrong passwords (db/login_guard.py, shared with the desktop)."""
from app import core  # noqa: F401
from fastapi.testclient import TestClient

from app.main import app
from db import login_guard as lg
from db.connection import execute

NAME = "zz_guard_test_web"


def test_web_login_locks():
    execute("DELETE FROM tblUsageLog WHERE Username = ? AND EventType = 'security'", [NAME])
    try:
        c = TestClient(app)
        for i in range(lg.MAX_FAILS - 1):
            r = c.post("/api/auth/login", json={"username": NAME, "password": "wrong"})
            assert r.status_code == 401 and r.json()["code"] == "invalid" and r.json()["left"] == lg.MAX_FAILS - 1 - i
        r = c.post("/api/auth/login", json={"username": NAME, "password": "wrong"})
        assert r.status_code == 429 and r.json()["code"] == "locked"
        r = c.post("/api/auth/login", json={"username": NAME, "password": "anything"})
        assert r.status_code == 429 and r.json()["code"] == "locked" and r.json()["minutes"] >= 1
    finally:
        execute("DELETE FROM tblUsageLog WHERE Username = ? AND EventType = 'security'", [NAME])
