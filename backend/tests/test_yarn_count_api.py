"""Yarn Count Converter in the web (app/yarn_count_api.py on ui/yarn_count.py). No database writes."""
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from db.connection import fetch_all


def _client():
    u = fetch_all("SELECT u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                  "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")[0]["UserName"]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u))
    return c


def test_meta_and_convert():
    c = _client()
    m = c.get("/api/yarn-count/meta").json()
    assert any(u["key"] == "Ne" for u in m["units"]) and m["densities"]
    r = c.post("/api/yarn-count/convert", json={"value": "167", "unit": "dtex", "filaments": "48", "plies": "2", "density": 1.38}).json()
    assert r["ok"] and r["values"]["den"] == "150.3" and r["values"]["tex"] == "16.7"
    assert r["filament"]["total_dtex"] == "334" and r["filament"]["total_fil"] == "96"
    assert r["filament"]["designation"].startswith("2 × dtex 167 f48")
    bad = c.post("/api/yarn-count/convert", json={"value": "-3", "unit": "dtex"}).json()
    assert not bad["ok"] and bad["invalid"] and bad["values"]["den"] is None
    assert c.post("/api/yarn-count/convert", json={"value": "1", "unit": "xx"}).json()["code"] == "bad_unit"


def test_notation():
    c = _client()
    p = c.post("/api/yarn-count/notation", json={"text": "2x150D/48F"}).json()
    assert p["ok"] and p["unit"] == "den" and p["filaments"] == 48 and p["plies"] == 2 and p["count"] == "150"
    assert not c.post("/api/yarn-count/notation", json={"text": "hello"}).json()["ok"]
