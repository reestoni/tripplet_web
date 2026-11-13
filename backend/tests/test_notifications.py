"""The bell (app/notifications_api.py on ui/notifications.py): own notifications only; marking someone else's
notification as read does nothing."""
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from db.connection import execute, fetch_all


def _client():
    u = fetch_all("SELECT u.ID, u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                  "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")[0]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u["UserName"]))
    return c, int(u["ID"])


def test_list_and_read():
    c, uid = _client()
    d = c.get("/api/notifications").json()
    assert d["unread"] == c.get("/api/notifications/count").json()["unread"]
    other = fetch_all("SELECT ID FROM tblNotification WHERE RecipientUserID <> ? AND ReadAt IS NULL LIMIT 1", [uid])
    if other:
        c.post(f"/api/notifications/{other[0]['ID']}/read")
        assert fetch_all("SELECT ReadAt FROM tblNotification WHERE ID = ?", [other[0]["ID"]])[0]["ReadAt"] is None
    mine = fetch_all("SELECT ID FROM tblNotification WHERE RecipientUserID = ? AND ReadAt IS NULL LIMIT 1", [uid])
    if mine:
        c.post(f"/api/notifications/{mine[0]['ID']}/read")
        assert fetch_all("SELECT ReadAt FROM tblNotification WHERE ID = ?", [mine[0]["ID"]])[0]["ReadAt"] is not None
        execute("UPDATE tblNotification SET ReadAt = NULL WHERE ID = ?", [mine[0]["ID"]])   # leave it as it was
