"""Knowledge Base in the web: catalog like the desktop tree, pages only for logged-in users, quiz = usage log."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app import auth, kb
from app.main import app

from ui import onboarding_catalog as cat


def _client():
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie("soj"))
    return c


def test_catalog_has_every_module_once():
    r = _client().get("/api/kb/catalog?lang=de").json()
    keys = [r["start"]["key"]]
    for a in r["areas"]:
        for c in a["categories"]:
            keys += [m["key"] for m in c["modules"]]
            for g in c["groups"]:
                keys += [m["key"] for m in g["modules"]]
    assert sorted(keys) == sorted(m.key for m in cat.MODULES)


def test_module_scenes_and_assets_need_login():
    c = _client()
    m = c.get("/api/kb/module/dty_intermingling?lang=en").json()
    assert m["scenes"][-1] == "Quiz" and m["url"] == "/kb-assets/dty_intermingling.html"
    assert c.get(m["url"]).status_code == 200
    assert c.get("/kb-assets/dty_intermingling_texts.js").status_code == 200
    assert TestClient(app).get(m["url"]).status_code == 401
    assert c.get("/api/kb/module/nope").status_code == 404


def test_quiz_is_logged_and_validated(monkeypatch):
    logged = []
    monkeypatch.setattr(kb, "log_usage_event", lambda *a: logged.append(a))
    c = _client()
    assert c.post("/api/kb/quiz", json={"key": "dty_intermingling", "right": 9, "total": 5}).status_code == 400
    r = c.post("/api/kb/quiz", json={"key": "dty_intermingling", "right": 4, "total": 5, "lang": "de"}).json()
    assert r["passed"] is True
    assert logged == [("feature", "onboarding_quiz", "dty_intermingling 4/5 passed (de)")]
