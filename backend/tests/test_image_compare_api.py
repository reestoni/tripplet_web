"""Image Compare in the web (app/image_compare_api.py on db/image_compare.py + ui/doc_render.py).
Reads series images; the upload test writes only into the temporary upload folder."""
import io

import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from db import series_attachments as sa
from db.connection import fetch_all


def _client():
    u = fetch_all("SELECT u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                  "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")[0]["UserName"]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u))
    return c


def test_series_images_and_file():
    c = _client()
    s = c.get("/api/image-compare/series").json()["series"]
    assert s
    for grp in s[:15]:
        imgs = c.get(f"/api/image-compare/series/{grp['id']}/images").json()["images"]
        hit = next((i for i in imgs if sa.file_for_download("image", grp["id"], i["id"])), None)
        if hit:
            info = c.get(f"/api/image-compare/series/{grp['id']}/images/{hit['id']}/info").json()
            assert info["kind"] in ("image", "pdf", "vk4", "excel", "word") and "radar" in info
            f = c.get(f"/api/image-compare/series/{grp['id']}/images/{hit['id']}/file?max=200")
            assert f.status_code == 200 and f.headers["content-type"] == "image/png"
            return
    pytest.skip("no image file reachable on this computer")


def test_upload_local_and_render():
    c = _client()
    from openpyxl import Workbook
    buf = io.BytesIO()
    wb = Workbook()
    wb.active.append([1, 2])
    wb.save(buf)
    r = c.post("/api/image-compare/upload", files={"file": ("data.xlsx", buf.getvalue())}).json()
    assert r["kind"] == "excel" and r["sheets"] == ["Sheet"]
    png = c.get(f"/api/image-compare/local/{r['token']}/file")
    assert png.status_code == 200 and png.content[:4] == b"\x89PNG"
    assert c.post("/api/image-compare/upload", files={"file": ("x.exe", b"MZ")}).json()["code"] == "unsupported"
    assert c.get("/api/image-compare/local/../../etc/file").status_code == 404
    assert c.get("/api/image-compare/local/" + "0" * 32 + "/file").json()["code"] == "not_found"
