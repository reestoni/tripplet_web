"""Jet drawing hover box (app/jet_drawing.py, 2026-11-26): pictures / PDF of a jet from tblJetFile, newest first, BMP as PNG,
PDF as its first page, unknown jets and other files give nothing; the web bridge carries the legend hover code.
Dummy pictures in a tmp folder - no real drawings, nothing written to the DB."""
from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import auth, jet_drawing as jd
from app.main import app
from db.connection import fetch_all


@pytest.fixture
def client():
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel <= 1 AND COALESCE(u.Active, 1) <> 0 ORDER BY ar.AccessLevel, u.ID")
    if not rows:
        pytest.skip("no read-only user on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))   # everyone who gets in sees it
    return c


@pytest.fixture
def files(tmp_path, monkeypatch):
    (tmp_path / "7").mkdir()
    Image.new("RGB", (40, 20), "red").save(tmp_path / "7" / "a.png")
    Image.new("RGB", (40, 20), "blue").save(tmp_path / "7" / "b.bmp")
    (tmp_path / "7" / "c.txt").write_text("x")
    rows = {7: [{"ID": 3, "FileName": "b.bmp", "RelativePath": "7/b.bmp"},      # newest first
                {"ID": 2, "FileName": "a.png", "RelativePath": "7/a.png"},
                {"ID": 4, "FileName": "c.txt", "RelativePath": "7/c.txt"},
                {"ID": 5, "FileName": "gone.png", "RelativePath": "7/gone.png"}]}
    paths = {r["ID"]: str(tmp_path / r["RelativePath"]) for r in rows[7]}
    monkeypatch.setattr(jd.ja, "files_root", lambda: str(tmp_path))
    monkeypatch.setattr(jd.ja, "list_files", lambda jid: rows.get(jid, []))
    monkeypatch.setattr(jd.ja, "file_path", lambda fid: paths.get(fid))
    monkeypatch.setattr(jd, "fetch_all", lambda sql, p=(): [{"ID": 7, "Jet": "LB-04"}] if p and p[0] in (7, "LB-04") else [])
    return tmp_path


def test_list_and_files(client, files):
    j = client.get("/api/jet-drawings?name=LB-04").json()
    assert j["jet_id"] == 7 and [f["id"] for f in j["files"]] == [3, 2]          # txt and missing file left out
    assert client.get("/api/jet-drawings?name=Nope").json() == {"jet_id": None, "name": "Nope", "files": []}
    r = client.get("/api/jet-drawings/file/3")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"      # BMP converted
    assert Image.open(io.BytesIO(r.content)).size == (40, 20)
    assert client.get("/api/jet-drawings/file/2").headers["content-type"] == "image/png"
    assert client.get("/api/jet-drawings/file/4").status_code == 404
    assert client.get("/api/jet-drawings/file/99").status_code == 404
    assert TestClient(app).get("/api/jet-drawings?name=LB-04").status_code == 401  # not logged in


def test_pdf_first_page(client, files, monkeypatch):
    fitz = pytest.importorskip("fitz")
    doc = fitz.open()
    doc.new_page(width=200, height=100)
    doc.save(str(files / "7" / "d.pdf"))
    monkeypatch.setattr(jd.ja, "file_path", lambda fid: str(files / "7" / "d.pdf"))
    r = client.get("/api/jet-drawings/file/6")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"


def test_bridge_has_legend_hover(client):
    js = client.get("/report-assets/web_bridge.js").text
    assert "/api/jet-drawings?name=" in js and "g.legend g.traces" in js
