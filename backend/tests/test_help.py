"""Help in the web (app/help.py on ui/help_index.py, ui/kb_search.py, the desktop help text modules):
context help per screen, help search incl. Knowledge Base hits, usage events, no Ask AI. Read-only
(the usage log calls are replaced)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import auth, help as help_api
from app.main import app

from db.connection import fetch_all


@pytest.fixture()
def c(monkeypatch):
    logged = []
    monkeypatch.setattr(help_api, "log_usage_event", lambda *a: logged.append(a))
    rows = fetch_all("SELECT u.Username FROM tblUser u WHERE COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")
    if not rows:
        pytest.skip("no user")
    client = TestClient(app)
    client.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    client.logged = logged
    return client


def test_context_help_all_languages(c):
    for screen in ("all_experiments", "backlog", "show_experiment", "report", "create_experiment", "experiment_request"):
        d = c.get(f"/api/help/screen/{screen}").json()
        assert set(d["texts"]) == {"en", "de", "es"}, screen
        keys = {lang: [t["key"] for t in d["texts"][lang]["tabs"]] for lang in d["texts"]}
        assert keys["en"] == keys["de"] == keys["es"], screen      # same tabs in every language
        kinds = {b["t"] for t in d["texts"]["en"]["tabs"] for b in t["blocks"]}
        assert kinds <= {"p", "h", "task", "note", "warn", "ul", "areas", "table", "svg"}
    svgs = [b for t in c.get("/api/help/screen/show_experiment").json()["texts"]["en"]["tabs"]
            for b in t["blocks"] if b["t"] == "svg"]
    assert all(b["src"].startswith("data:image/svg+xml;base64,") for b in svgs)
    assert c.get("/api/help/screen/nope").status_code == 404


def test_search_routes_and_kb(c):
    hits = c.get("/api/help/search", params={"q": "alle Aufträge einer Maschine"}).json()["hits"]
    assert hits and hits[0]["screen"] == "all_experiments" and hits[0]["route"] == "/experiments"
    assert hits[0]["web_ready"] is True and hits[0]["best_lang"] == "de"
    assert set(hits[0]["by_lang"]) == {"en", "de", "es"}
    kb = [h for h in c.get("/api/help/search", params={"q": "set heater"}).json()["hits"] if h["kb"]]
    assert kb and kb[0]["route"].startswith("/knowledge-base/")
    assert c.get("/api/help/search", params={"q": ""}).json()["hits"] == []


def test_usage_events(c):
    assert c.post("/api/help/log", json={"event": "help_search_open", "detail": "x -> backlog:tasks:0"}).json()["ok"]
    assert c.logged and c.logged[-1][1] == "help_search_open"
    assert c.post("/api/help/log", json={"event": "drop_tables", "detail": ""}).status_code == 400


def test_no_ask_ai_in_web(c):
    """Ask AI is deliberately not in the web app (user decision 2026-11-13)."""
    assert c.get("/api/help/ai").status_code in (404, 405)
    assert c.post("/api/help/ai", json={"q": "x", "lang": "de"}).status_code in (404, 405)
    hits = c.get("/api/help/search", params={"q": "label"}).json()["hits"]
    assert hits and all("ai_answer" not in h for h in hits)
