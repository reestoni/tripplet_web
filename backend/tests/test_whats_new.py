"""Fresh off the Spool (app/whats_new_api.py on ui/whats_new_data.py + ui/widgets/whats_new_texts.py)."""
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from db import display_settings as ds
from db.connection import fetch_all


def _client():
    u = fetch_all("SELECT u.ID, u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                  "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")[0]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u["UserName"]))
    return c, u["ID"]


def test_releases_search_sketch():
    c, _uid = _client()
    d = c.get("/api/whats-new?lang=zh").json()
    assert d["lang"] == "en" and d["releases"] and d["labels"]["WINDOW_TITLE"]
    card = next(f for s in d["releases"][0]["sections"] for f in s["features"])
    assert card["title"] and card["text"]
    de = c.get("/api/whats-new?lang=de").json()
    assert len(de["releases"]) == len(d["releases"])
    hits = c.get("/api/whats-new/search", params={"q": "reference", "lang": "de"}).json()["hits"]
    assert hits and all(h["version"] for h in hits)
    sk = next((f["sketch"] for r in d["releases"] for s in r["sections"] for f in s["features"] if f["sketch"]), None)
    if sk:
        assert c.get(f"/api/whats-new/sketch/{sk}").status_code == 200
    assert c.get("/api/whats-new/sketch/..%5C..%5Cmain.py").status_code == 404


def test_seen():
    c, uid = _client()
    if not ds.has_column():
        return
    before = (ds.load(uid) or {}).get("whats_new_seen") or ""
    try:
        ds.update(uid, whats_new_seen="0.0.0")
        assert c.get("/api/whats-new/status").json()["has_unseen"]
        c.post("/api/whats-new/seen", json={})
        assert not c.get("/api/whats-new/status").json()["has_unseen"]
    finally:
        ds.update(uid, whats_new_seen=before)
