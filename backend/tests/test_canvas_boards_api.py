"""Canvas boards (app/canvas_api.py on db/canvas_boards.py) - dev_local, test boards are deleted again."""
import base64
import io

from app import core  # noqa: F401
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import auth
from app.main import app
from db import canvas_boards as cb
from db.connection import fetch_all

pytestmark = pytest.mark.skipif(not cb.table_ready(), reason="tblCanvasBoard missing")


def _client():
    u = fetch_all("SELECT u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                  "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")[0]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u["UserName"]))
    return c


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


def test_board_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("TRIPPLET_DIR_CANVAS_FILES", str(tmp_path))
    c = _client()
    up = c.post("/api/image-compare/upload", files={"file": ("pic.png", _png(), "image/png")}).json()
    clip = "data:image/png;base64," + base64.b64encode(_png()).decode()
    content = {"bg": "#202020", "items": [
        {"id": "u", "label": "pic.png", "src": {"kind": "upload", "token": up["token"], "name": "pic.png"}, "cx": 0, "cy": 0, "w": 40, "h": 30},
        {"id": "c", "label": "clip", "src": {"kind": "clip", "data": clip}, "cx": 100, "cy": 0, "w": 40, "h": 30}],
        "annos": [{"tool": "rect", "color": "blue", "size": 2, "points": [[0, 0], [10, 10]]}]}
    r = c.post("/api/canvas/boards", json={"title": "API test", "content": content})
    assert r.status_code == 200, r.text
    bid, ver = r.json()["id"], r.json()["version"]
    try:
        b = c.get(f"/api/canvas/boards/{bid}").json()
        kinds = [i["src"]["kind"] for i in b["content"]["items"]]
        assert kinds == ["file", "file"] and b["can_delete"] and b["title"] == "API test"
        name = b["content"]["items"][0]["src"]["file"]
        f = c.get(f"/api/canvas/boards/{bid}/files/{name}")
        assert f.status_code == 200 and f.content[:4] == b"\x89PNG"
        assert c.get(f"/api/canvas/boards/{bid}/files/..%5Cx.png").status_code == 404
        assert any(x["id"] == bid for x in c.get("/api/canvas/boards").json()["boards"])
        s = c.put(f"/api/canvas/boards/{bid}", json={"content": b["content"], "version": ver, "title": "Renamed"})
        assert s.status_code == 200 and s.json()["version"] == ver + 1
        stale = c.put(f"/api/canvas/boards/{bid}", json={"content": b["content"], "version": ver})
        assert stale.status_code == 409 and stale.json()["code"] == "conflict" and stale.json()["version"] == ver + 1
    finally:
        assert c.delete(f"/api/canvas/boards/{bid}").status_code == 200
    assert c.get(f"/api/canvas/boards/{bid}").status_code == 404
