"""Quick search, Recent list and page-open logging (app/search_api.py on db/quick_search.py, db/display_settings)."""
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


def test_quick_search():
    c, _uid = _client()
    assert c.get("/api/quick-search").json()["results"] == []
    s = fetch_all("SELECT SeriesName FROM tblTrialSeries WHERE SeriesName IS NOT NULL AND SeriesName <> '' LIMIT 1")[0]["SeriesName"]
    word = s.split()[-1]
    res = c.get("/api/quick-search", params={"series": word}).json()["results"]
    assert res and all(word.lower() in (r["name"] + " " + r["experiment"]).lower() or r["reasons"] for r in res)


def test_recent_roundtrip():
    c, uid = _client()
    if not ds.has_column():
        return
    before = (ds.load(uid) or {}).get("recent_series")
    sid = fetch_all("SELECT ID FROM tblTrialSeries ORDER BY ID DESC LIMIT 1")[0]["ID"]
    try:
        assert c.post("/api/recent", json={"series_id": sid}).json()["ok"]
        items = c.get("/api/recent").json()["items"]
        assert items[0]["series_id"] == sid and len(items) <= ds.RECENT_MAX
        assert c.post("/api/screen-open", json={"screen": "BacklogScreen"}).json()["ok"]
    finally:
        ds.update(uid, recent_series=before or [])
