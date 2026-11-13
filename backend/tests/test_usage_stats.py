"""Usage Stats in the web (app/usage_stats_api.py on db/usage_stats.py) - superusers only, reads only."""
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from db.connection import fetch_all


def _client(level_min: int, level_max: int = 99):
    rows = fetch_all("SELECT u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                     "WHERE ar.AccessLevel >= ? AND ar.AccessLevel <= ? AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1",
                     [level_min, level_max])
    if not rows:
        return None
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(rows[0]["UserName"]))
    return c


def test_superuser_sees_stats():
    d = _client(4).get("/api/superuser/usage-stats").json()
    assert {"logins", "screens", "features", "ranking", "login_timeline", "help", "help_totals"} <= set(d)
    assert len(d["ranking"]) <= 15
    assert all("KindKey" in r for r in d["help"])


def test_others_refused():
    c = _client(1, 3)
    if c is None:
        return
    assert c.get("/api/superuser/usage-stats").json()["code"] == "superuser_only"
