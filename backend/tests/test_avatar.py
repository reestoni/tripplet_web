"""Profile picture (settings_api avatar routes on db/user_avatar.py) - stored in a temp folder."""
import io

from app import core  # noqa: F401
from fastapi.testclient import TestClient
from PIL import Image

from app import auth
from app.main import app
from db.connection import fetch_all


def _client():
    u = fetch_all("SELECT ID, UserName FROM tblUser WHERE COALESCE(Active, 1) <> 0 ORDER BY ID LIMIT 1")[0]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u["UserName"]))
    return c, u["ID"]


def _jpeg(w=400, h=300):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (20, 120, 200)).save(buf, format="JPEG")
    return buf.getvalue()


def test_avatar_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("TRIPPLET_DIR_USER_AVATARS", str(tmp_path))
    c, uid = _client()
    assert c.get("/api/settings").json()["avatar"] == 0
    assert c.get(f"/api/avatar/{uid}").status_code == 404
    r = c.post("/api/settings/avatar", files={"file": ("me.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 200 and r.json()["avatar"] > 0
    assert c.get("/api/me").json()["avatar"] > 0
    img = c.get(f"/api/avatar/{uid}?v=1")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(img.content)).size == (256, 256)
    bad = c.post("/api/settings/avatar", files={"file": ("x.png", b"nope", "image/png")})
    assert bad.status_code == 400 and bad.json()["code"] == "not_image"
    assert c.delete("/api/settings/avatar").json()["avatar"] == 0
    assert c.get(f"/api/avatar/{uid}").status_code == 404


def test_avatar_needs_login():
    assert TestClient(app).get("/api/avatar/1").status_code == 401
