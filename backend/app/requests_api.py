"""requests_api.py - Experiment Requests (Create + My Requests + read-only view) in the browser.
All rules live in db/experiment_requests.py and db/experiment_request_images.py (shared with
the desktop screens); this module only maps them to HTTP. The user comes from the session.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from . import core  # noqa: F401
from .deps import current_user, require_feature

from db import experiment_request_changes as rc  # noqa: E402
from db import experiment_request_images as ei  # noqa: E402
from db import experiment_requests as er  # noqa: E402
from db import series_overview as so  # noqa: E402

router = APIRouter(prefix="/api/requests")
# links from series to requests/reports (ER + RE icons, Experiment ID -> series)
links_router = APIRouter()


def _json(obj: Any, status: int = 200) -> Response:
    return Response(json.dumps(obj, default=str), media_type="application/json", status_code=status)


def _err(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code, "detail": detail})


def _guard(fn, *a, **k):
    """Shared PermissionError/LookupError -> HTTP."""
    try:
        return fn(*a, **k), None
    except PermissionError as e:
        return None, _err(403, "forbidden", str(e) or "You are not allowed to do this.")
    except LookupError as e:
        return None, _err(404, "not_found", str(e) or "Not found.")


# --------------------------------------------------------------------------- list + form
@router.get("")
def list_requests(search: str = "", status: Optional[int] = None, project: Optional[str] = None,
                  owner: Optional[str] = None, user: Dict[str, Any] = Depends(require_feature("my_requests"))):
    data = er.list_requests(user, search=search, status_id=status, project=project or None, owner=owner or None)
    try:
        versioned = rc.versioned_ids([r["id"] for r in data.get("rows", [])])
    except Exception:
        versioned = set()
    for r in data.get("rows", []):
        r.pop("values", None)          # the list does not need the whole row
        r["has_history"] = r["id"] in versioned   # context menu "View version history…"
    return _json(data)


@router.get("/form")
def form(_user: Dict[str, Any] = Depends(require_feature("create_request"))):
    return _json({"fields": er.form_schema(), "required": list(er.REQUIRED_FIELDS)})


@router.get("/{request_id}")
def load(request_id: int, user: Dict[str, Any] = Depends(current_user)):
    data, err = _guard(er.load_request, request_id, user)
    if err:
        return err
    if data is None:
        return _err(404, "not_found", "This request does not exist.")
    data.pop("values", None)                 # raw row incl. system columns - the page uses form/display
    # never send file paths to the browser - images are served by id
    data["images"] = [{"id": i.get("ID"), "name": i.get("OriginalFilename") or i.get("StoredFilename")}
                      for i in data.get("images") or [] if i.get("ID") is not None]
    data["is_superuser"] = er.is_superuser(user)
    data["can_edit"] = er.is_superuser(user) or data.get("status_id") in (None, er.STATUS_REQUEST, er.STATUS_DENIED,
                                                                          er.STATUS_APPROVED, er.STATUS_EXPERIMENT)
    return _json(data)


class SaveBody(BaseModel):
    values: Dict[str, Any]


def _save(user, request_id, body: SaveBody):
    values = er.coerce_values(body.values)
    res, err = _guard(er.save_request, user, request_id, values)
    if err:
        return err
    return _json({"kind": res.kind, "request_id": res.request_id, "title": res.title,
                  "message": res.message, "missing": res.missing})


@router.post("")
def create(body: SaveBody, user: Dict[str, Any] = Depends(require_feature("create_request"))):
    return _save(user, None, body)


@router.put("/{request_id}")
def update(request_id: int, body: SaveBody, user: Dict[str, Any] = Depends(current_user)):
    return _save(user, request_id, body)


# --------------------------------------------------------------------------- status / review / assign
class StatusBody(BaseModel):
    status_id: int
    reason: Optional[str] = None
    confirmed: bool = False


@router.post("/{request_id}/status")
def set_status(request_id: int, body: StatusBody, user: Dict[str, Any] = Depends(current_user)):
    res, err = _guard(er.set_status, user, request_id, body.status_id, body.reason, confirmed=body.confirmed)
    return err or _json(res)


@router.get("/{left_id}/compare/{right_id}")
def compare(left_id: int, right_id: int, user: Dict[str, Any] = Depends(current_user)):
    if not er.is_superuser(user):
        return _err(403, "forbidden", "Only superusers review changes.")
    return _json(er.compare_requests(left_id, right_id))


@router.post("/{copy_id}/accept")
def accept(copy_id: int, user: Dict[str, Any] = Depends(current_user)):
    res, err = _guard(er.accept_pending_change, user, copy_id)
    if err:
        return err
    original, archived = res
    return _json({"original_id": original, "archived_version_id": archived})


class RejectBody(BaseModel):
    original_id: int


@router.post("/{copy_id}/reject")
def reject(copy_id: int, body: RejectBody, user: Dict[str, Any] = Depends(current_user)):
    res, err = _guard(er.reject_pending_change, user, copy_id, body.original_id)
    return err or _json({"ok": True, "result": res})


@router.get("/{request_id}/assign-options")
def assign_options(request_id: int, user: Dict[str, Any] = Depends(current_user)):
    if not er.is_superuser(user):
        return _err(403, "forbidden", "Only superusers assign experiments.")
    fld = er.resolve_experiment_request_field()
    if not fld:
        return _json({"options": []})
    exp_id_field, pk_field = er.experiment_id_fields()
    opts = [{"pk": pk, "label": er.experiment_choice_label(pk, eid)}
            for pk, eid in er.unlinked_experiments(fld, exp_id_field, pk_field)]
    return _json({"options": opts})


class AssignBody(BaseModel):
    experiment_pk: int


@router.post("/{request_id}/assign")
def assign(request_id: int, body: AssignBody, user: Dict[str, Any] = Depends(current_user)):
    res, err = _guard(er.assign_experiment, user, request_id, body.experiment_pk)
    return err or _json(res)


# --------------------------------------------------------------------------- images
@router.get("/{request_id}/images")
def images(request_id: int, user: Dict[str, Any] = Depends(current_user)):
    row = er.fetch_request(request_id)
    if row is None:
        return _err(404, "not_found", "This request does not exist.")
    if not er.can_view(user, row):
        return _err(403, "forbidden", "You are not allowed to open this request.")
    own = er.can_open(user, row)
    return _json({"images": [{"id": i["ID"], "name": i["OriginalFilename"] or i["StoredFilename"],
                              "can_delete": own and ei.can_delete(user, i),
                              "can_rename": own and ei.can_delete(user, i)} for i in ei.list_images(request_id)]})


@router.get("/{request_id}/images/{image_id}/file")
def image_file(request_id: int, image_id: int, user: Dict[str, Any] = Depends(current_user)):
    row = er.fetch_request(request_id)
    if row is None or not er.can_view(user, row):
        return _err(404, "not_found", "File not found.")
    path = ei.image_file(request_id, image_id)
    if not path:
        return _err(404, "not_found", "File not found.")
    return FileResponse(path, content_disposition_type="inline")


@router.post("/{request_id}/images")
async def upload(request_id: int, files: List[UploadFile] = File(...), user: Dict[str, Any] = Depends(current_user)):
    data = [(f.filename or "image", await f.read()) for f in files]
    res, err = _guard(ei.add_images, user, request_id, data)
    if err:
        return err
    stored, errors = res
    return _json({"stored": stored, "errors": errors})


class DeleteImagesBody(BaseModel):
    image_ids: List[int]


@router.post("/{request_id}/images/delete")
def delete_images(request_id: int, body: DeleteImagesBody, user: Dict[str, Any] = Depends(current_user)):
    res, err = _guard(ei.delete_images, user, request_id, body.image_ids)
    return err or _json(res)


class RenameBody(BaseModel):
    name: str


@router.post("/{request_id}/images/{image_id}/rename")
def rename(request_id: int, image_id: int, body: RenameBody, user: Dict[str, Any] = Depends(current_user)):
    res, err = _guard(ei.rename_image, user, request_id, image_id, body.name)
    return err or _json({"name": res})


# --------------------------------------------------------------------------- read-only popup + versions
def _viewable(request_id: int, user) -> Any:
    row = er.fetch_request(request_id)
    if row is None:
        return None, _err(404, "not_found", "This request does not exist.")
    if not er.can_view(user, row):
        return None, _err(403, "forbidden", "You are not allowed to open this request.")
    return row, None


@router.get("/{request_id}/view")
def view(request_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Read-only popup (desktop _ExperimentRequestReadOnlyDialog): fields, images, version history flag."""
    _row, err = _viewable(request_id, user)
    if err:
        return err
    data = er.popup_data(request_id)
    if data is None:
        return _err(404, "not_found", "This request does not exist.")
    data["images"] = [{"id": i.get("ID"), "name": i.get("OriginalFilename") or i.get("StoredFilename")}
                      for i in data.get("images") or [] if i.get("ID") is not None]
    from db import series_conclusion
    data["conclusions"] = series_conclusion.for_request(request_id)   # results of the linked series
    return _json(data)


@router.get("/{request_id}/versions")
def versions(request_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Version history: the live row and every archived prior version, newest first."""
    _row, err = _viewable(request_id, user)
    if err:
        return err
    return _json({"versions": er.version_history(request_id)})


@router.get("/{request_id}/versions/{older_id}/compare")
def compare_version(request_id: int, older_id: int, user: Dict[str, Any] = Depends(current_user)):
    """Archived version (left) vs. the live row (right), read-only."""
    _row, err = _viewable(request_id, user)
    if err:
        return err
    if not any(v["id"] == older_id for v in er.version_history(request_id) if not v["current"]):
        return _err(404, "not_found", "This version does not belong to the request.")
    return _json(er.compare_requests(older_id, request_id))


# --------------------------------------------------------------------------- links from series
@links_router.get("/api/series/{series_id}/request")
def series_request(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """Experiment Request linked to the series' experiment (Report header ER icon)."""
    return _json({"request_id": er.request_id_for_series(series_id)})


@links_router.get("/api/series/{series_id}/reports")
def series_reports(series_id: int, _user: Dict[str, Any] = Depends(current_user)):
    """Saved Smart-Chart reports of the series (RE icon: one = open, several = pick)."""
    return _json({"reports": [{"id": int(r["ID"]), "title": str(r.get("Title") or "").strip(),
                               "author": str(r.get("Author") or "").strip()}
                              for r in so.reports_for_series(series_id)]})


@links_router.get("/api/experiment-series")
def experiment_series(exp_id: str, _user: Dict[str, Any] = Depends(require_feature("my_requests"))):
    """My Requests: click on an Experiment ID -> its trial series (one = open, several = pick)."""
    pk, rows = er.series_for_experiment_id(exp_id)
    return _json({"experiment_pk": pk, "series": rows})
