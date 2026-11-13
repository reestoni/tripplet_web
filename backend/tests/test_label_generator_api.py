"""Label Generator in the web (app/label_generator_api.py on ui/label_designer.py + db/label_sheets.py).
The design test writes one design into tblLabelDesign and deletes it; the sheet template is put back."""
import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app
from db import label_sheets as ls
from db.connection import execute, fetch_all, table_exists
from ui import label_designer as ld


def _client():
    u = fetch_all("SELECT u.UserName FROM tblUser u JOIN tblAccessRight ar ON u.AccessRights = ar.ID "
                  "WHERE ar.AccessLevel >= 4 AND COALESCE(u.Active, 1) <> 0 ORDER BY u.ID LIMIT 1")[0]["UserName"]
    c = TestClient(app)
    c.cookies.set(auth.COOKIE_NAME, auth.make_cookie(u))
    return c


ELS = [{"type": "text", "x_mm": 2, "y_mm": 2, "w_mm": 30, "h_mm": 8,
        "parts": [{"source": "field", "field_key": "header"}, {"source": "static", "text": " V"},
                  {"source": "field", "field_key": "trial_nr"}]},
       {"type": "table", "rows": 2, "cols": 2}, {"type": "logo", "x_mm": 40, "y_mm": 2, "w_mm": 15, "h_mm": 10},
       {"type": "evil"}]


def test_meta_series_preview_pdf():
    c = _client()
    m = c.get("/api/label-generator/meta").json()
    assert m["template"]["ColumnCount"] >= 1 and "trial_nr" in m["fields"]
    sid = fetch_all("SELECT TrialSeriesID FROM tbltrial GROUP BY TrialSeriesID HAVING COUNT(*) > 2 LIMIT 1")[0]["TrialSeriesID"]
    s = c.get(f"/api/label-generator/series/{sid}").json()
    assert s["header"] and len(s["trials"]) > 2
    v = c.get(f"/api/label-generator/series/{sid}/trial/{s['trials'][0]}").json()["values"]
    assert v["trial_nr"] == str(s["trials"][0])
    p = c.post("/api/label-generator/preview", json={"elements": ELS, "w_mm": 60, "h_mm": 30, "values": v})
    assert p.status_code == 200 and p.content[:4] == b"\x89PNG"
    assert c.post("/api/label-generator/pdf", json={"elements": ELS, "mode": "copies"}).json()["code"] == "need_trial"
    r = c.post("/api/label-generator/pdf", json={"elements": ELS, "mode": "range", "series_id": sid,
                                                 "frm": s["trials"][0], "to": s["trials"][2], "start_index": 1})
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
    assert c.post("/api/label-generator/pdf", json={"elements": [], "mode": "copies"}).json()["code"] == "no_elements"


def test_label_size_and_design_round_trip():
    if not table_exists(ld.DESIGN_TABLE):
        pytest.skip("no tblLabelDesign")
    c = _client()
    before = ls.load_label_template(ld.TEMPLATE_NAME)
    had = bool(fetch_all("SELECT 1 FROM tblLabelTemplate WHERE Name = ?", [ld.TEMPLATE_NAME]))
    try:
        t = c.post("/api/label-generator/label-size", json={"w_mm": 51, "h_mm": 22}).json()["template"]
        assert t["LabelWidthMm"] == 51 and t["LabelHeightMm"] == 22
    finally:
        if had:
            ls.save_label_template(ld.TEMPLATE_NAME, before)
        else:
            execute("DELETE FROM tblLabelTemplate WHERE Name = ?", [ld.TEMPLATE_NAME])
    name = "zz web test design"
    try:
        r = c.post("/api/label-generator/designs", json={"name": name, "elements": ELS}).json()
        assert name in r["designs"]
        d = c.get(f"/api/label-generator/designs/{name}").json()
        assert [e["type"] for e in d["elements"]] == ["text", "table", "logo"]
    finally:
        execute(f"DELETE FROM {ld.DESIGN_TABLE} WHERE Name = ?", [name])
    assert c.post("/api/label-generator/designs", json={"name": " ", "elements": []}).json()["code"] == "no_name"
