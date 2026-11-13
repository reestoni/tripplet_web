"""Series attachments upload / rename / delete through the web API (rules from db/series_uploads):
real round trip on dev_local that removes everything it created (rows, files, folders)."""
from __future__ import annotations

import base64
import os

import pytest
from fastapi.testclient import TestClient

from app import auth, uploads
from app.main import app

from db import series_uploads as su
from db.connection import execute, fetch_all

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4//8/AAX+Av7czFnnAAAAAElFTkSuQmCC")
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
TABLES = ("tblTrialSeriesImage", "tblTrialSeriesPDF", "tblTrialSeriesImageAnalysis", "tblFeatureUsage")


@pytest.fixture()
def client():
    rows = fetch_all("SELECT u.Username FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID")
    if not rows:
        pytest.skip("no superuser on dev_local")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["Username"]))
    return c


@pytest.fixture()
def series():
    """A series without local attachment folders; afterwards every row/file/folder created is removed."""
    assert su.series_dir("image", 1).lower().startswith("c:\\ttt"), "dev_local must write to the local test folders"
    sid = None
    for r in fetch_all("SELECT ID FROM tblTrialSeries ORDER BY ID DESC LIMIT 50"):
        if not any(os.path.exists(su.series_dir(k, r["ID"])) for k in su.KINDS):
            sid = r["ID"]
            break
    if sid is None:
        pytest.skip("no series without local attachment folders")
    max_ids = {t: fetch_all(f"SELECT COALESCE(MAX(ID), 0) AS m FROM {t}")[0]["m"] for t in TABLES}
    yield sid
    execute("DELETE FROM tblTrialSeriesImageAnalysis WHERE ID > ? AND TrialSeriesImageID IN "
            "(SELECT ID FROM tblTrialSeriesImage WHERE TrialSeriesID = ?)", [max_ids["tblTrialSeriesImageAnalysis"], sid])
    for t in ("tblTrialSeriesImage", "tblTrialSeriesPDF"):
        execute(f"DELETE FROM {t} WHERE ID > ? AND TrialSeriesID = ?", [max_ids[t], sid])
    execute("DELETE FROM tblFeatureUsage WHERE ID > ? AND FeatureID IN (3, 4) AND ExtraInfo = ?",
            [max_ids["tblFeatureUsage"], str(sid)])
    for k in su.KINDS:
        d = su.series_dir(k, sid)
        if os.path.isdir(d):
            for f in os.listdir(d):
                os.remove(os.path.join(d, f))
            os.rmdir(d)


def _files(*items):
    return [("files", (name, data, "application/octet-stream")) for name, data in items]


def test_needs_login():
    assert TestClient(app).post("/api/series/1/attachments", files=_files(("a.png", PNG))).status_code == 401


def test_unknown_series(client):
    assert client.post("/api/series/987654321/attachments", files=_files(("a.png", PNG))).status_code == 404


def test_sniff_kind():
    assert su.sniff_kind(PNG) == "image"
    assert su.sniff_kind(b"\xff\xd8\xff\xe0abc") == "image"
    assert su.sniff_kind(PDF) == "pdf"
    assert su.sniff_kind(b"MZ\x90\x00") is None
    assert su.sniff_kind(b"") is None


def test_round_trip(client, series, monkeypatch):
    sid = series
    monkeypatch.setattr(uploads, "MAX_FILE_BYTES", 1000)
    res = client.post(f"/api/series/{sid}/attachments", files=_files(
        ("photo.png", PNG), ("report.pdf", PDF), ("..\\evil.png", PNG),
        ("fake.png", b"just text"), ("pdf-as.png", PDF), ("big.png", PNG + b"\0" * 2000))).json()
    assert res["images"] == 2 and res["pdfs"] == 1, res
    assert len(res["errors"]) == 3 and res["errors"][0].startswith("big.png")

    # rows and files as the desktop writes them
    imgs = fetch_all("SELECT * FROM tblTrialSeriesImage WHERE TrialSeriesID=? ORDER BY ID", [sid])
    new_imgs = [r for r in imgs if r["RelativePath"] == su.relative_path_for_db("image", sid)]
    assert sorted(r["OriginalFilename"] for r in new_imgs) == ["evil.png", "photo.png"]
    for r in new_imgs:
        assert os.path.isfile(os.path.join(su.series_dir("image", sid), r["StoredFilename"]))
    usage = fetch_all("SELECT FeatureID FROM tblFeatureUsage WHERE ExtraInfo=? ORDER BY ID DESC LIMIT 2", [str(sid)])
    assert sorted(u["FeatureID"] for u in usage) == [3, 4]

    att = client.get(f"/api/series/{sid}/attachments").json()
    pdf = next(p for p in att["pdfs"] if p["name"] == "report.pdf")
    img = next(i for i in att["images"] if i["name"] == "photo.png")
    assert pdf["can_delete"] and img["can_delete"]
    assert client.get(f"/api/series/{sid}/attachments/pdf/{pdf['id']}").content == PDF

    # rename keeps the extension, strips slashes
    r = client.post(f"/api/series/{sid}/attachments/pdf/{pdf['id']}/rename", json={"name": "a/b.txt"}).json()
    assert r["name"] == "a_b.pdf"
    assert client.post(f"/api/series/{sid}/attachments/pdf/{pdf['id']}/rename", json={"name": "  "}).status_code == 400
    assert client.post(f"/api/series/{sid}/attachments/pdf/999999999/rename", json={"name": "x"}).status_code == 404

    # other users may not delete
    other = su.delete({"id": -1, "access_level": 1}, "image", sid, [img["id"]])
    assert other["deleted"] == [] and other["skipped"] == 1

    # delete everything again
    ids = [i["id"] for i in att["images"] if i["name"] in ("photo.png", "evil.png")]
    d = client.post(f"/api/series/{sid}/attachments/image/delete", json={"ids": ids}).json()
    assert sorted(d["deleted"]) == sorted(ids) and not d["errors"]
    d = client.post(f"/api/series/{sid}/attachments/pdf/delete", json={"ids": [pdf["id"]]}).json()
    assert d["deleted"] == [pdf["id"]]
    assert client.post(f"/api/series/{sid}/attachments/zip/delete", json={"ids": [1]}).status_code == 404
