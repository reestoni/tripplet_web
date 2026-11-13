"""TDMS Inspector in the web (app/tdms_inspector.py + the YarnScope routes for negative series numbers).
The file is uploaded into the temporary folder; the ATY signal reader is replaced by a synthetic signal;
nothing is written to the database."""
import pytest
from fastapi.testclient import TestClient

from app import auth, tdms_inspector, yarnscope_aty
from app.main import app
from db.connection import fetch_all
from ui.yarnscope import aty_service as svc
from test_yarnscope_aty import _signal


def _client(n=0):
    rows = fetch_all("SELECT u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID")
    if len(rows) <= n:
        pytest.skip("not enough users")
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[n]["UserName"]))
    return c


def test_upload_analyse_and_limits(monkeypatch):
    c = _client()
    assert c.post("/api/tdms-inspector/upload", files={"file": ("x.txt", b"no")}).json()["code"] == "not_tdms"
    r = c.post("/api/tdms-inspector/upload", files={"file": ("probe.tdms", b"TDSm fake")}).json()
    sid = r["series_id"]
    assert sid < 0 and r["name"] == "probe.tdms"
    t = c.get(f"/api/series/{sid}/aty").json()
    assert t["inspector"] and [x["label"] for x in t["trials"]] == ["probe.tdms"] and t["trials"][0]["has_file"]
    d = c.get(f"/api/series/{sid}/yarnscope").json()
    assert d["inspector"] and d["trials"][0]["trial_id"] == 0
    arr, mm_pp, ell = _signal(3)
    monkeypatch.setattr(svc, "read_signal", lambda path: (arr, mm_pp, ell))
    monkeypatch.setattr(yarnscope_aty, "log_usage_event", lambda *a: None)
    res = c.post(f"/api/series/{sid}/aty/0/analyse").json()
    assert abs(res["total_m"] - 30.0) < 0.01
    assert c.get(f"/api/series/{sid}/aty/0/hist", params={"feature": "F02_height_um"}).status_code == 200
    for url, body in ((f"/api/series/{sid}/aty/0/save", None), (f"/api/series/{sid}/aty/compare", {"trial_ids": [0]}),
                      (f"/api/series/{sid}/yarnscope/0/save", None), (f"/api/series/{sid}/yarnscope/compare", {"trial_ids": [0, 1]})):
        assert c.post(url, json=body).json()["code"] == "inspector"
    # another user does not see this file
    other = _client(1)
    assert other.get(f"/api/series/{sid}/aty").json()["trials"] == []
    assert other.post(f"/api/series/{sid}/aty/0/analyse").status_code == 404
    tdms_inspector._files[sid]["path"].unlink()


def test_real_tdms_file_dty_and_aty():
    """The desktop's test fixture through both real analyses."""
    from app import core
    f = core.CORE_PATH / "tests" / "fixtures" / "271_24_130426_1255.tdms"
    if not f.is_file():
        pytest.skip("fixture missing")
    c = _client()
    sid = c.post("/api/tdms-inspector/upload", files={"file": (f.name, f.read_bytes())}).json()["series_id"]
    try:
        d = c.post(f"/api/series/{sid}/yarnscope/0/analyse")
        assert d.status_code in (200, 422)            # 422 = the file has no DTY signal
        if d.status_code == 200:
            assert c.get(f"/api/series/{sid}/yarnscope/0/segment?start=0&window=3").status_code == 200
        a = c.post(f"/api/series/{sid}/aty/0/analyse")
        assert a.status_code in (200, 422)
        assert d.status_code == 200 or a.status_code == 200
    finally:
        tdms_inspector._files[sid]["path"].unlink()
