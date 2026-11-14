"""Transport tuning for the web app (no effect on results, only on speed).

- ``TextGZipMiddleware``: gzip for text answers only (JSON, JavaScript, CSS, HTML, SVG). Pictures, PDFs and
  downloads are already compressed or large - compressing them again only costs CPU.
- ``TimingMiddleware``: adds a ``Server-Timing`` header (visible in the browser's network tab) and writes
  requests slower than ``TRIPPLET_WEB_SLOW_MS`` (default 800 ms) to the server log, so slow pages can be found on
  the test server where the database sits across the network. Only method, path and status are logged -
  never query strings or bodies.
- ``CachedStaticFiles``: the built frontend files have a content hash in their name, so the browser may keep
  them for a year; ``index.html`` is never cached, so a new release is picked up on the next reload.
"""
from __future__ import annotations

import logging
import os
import time

from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.gzip import GZipResponder, IdentityResponder
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

COMPRESSIBLE = ("application/json", "text/", "application/javascript", "image/svg+xml")
IMMUTABLE = "public, max-age=31536000, immutable"

_log = logging.getLogger("uvicorn.error")


def _slow_ms() -> float:
    try:
        return float(os.environ.get("TRIPPLET_WEB_SLOW_MS", "800"))
    except ValueError:
        return 800.0


class _TextOnlyGZip(GZipResponder):
    async def send_with_compression(self, message: Message) -> None:
        await super().send_with_compression(message)
        if message["type"] == "http.response.start":
            ct = Headers(raw=message["headers"]).get("content-type", "")
            if not ct.startswith(COMPRESSIBLE):
                self.content_type_is_excluded = True       # pass through unchanged


class TextGZipMiddleware:
    def __init__(self, app: ASGIApp, minimum_size: int = 1024, compresslevel: int = 6) -> None:
        self.app = app
        self.minimum_size = minimum_size
        self.compresslevel = compresslevel

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if "gzip" in Headers(scope=scope).get("Accept-Encoding", ""):
            responder: ASGIApp = _TextOnlyGZip(self.app, self.minimum_size, compresslevel=self.compresslevel)
        else:
            responder = IdentityResponder(self.app, self.minimum_size)
        await responder(scope, receive, send)


class TimingMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.slow_ms = _slow_ms()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        t0 = time.perf_counter()

        async def timed_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                ms = (time.perf_counter() - t0) * 1000
                MutableHeaders(raw=message["headers"]).append("Server-Timing", f"app;dur={ms:.1f}")
                if ms >= self.slow_ms and scope.get("path", "").startswith("/api/"):
                    _log.warning("slow request %.0f ms: %s %s -> %s", ms, scope.get("method"), scope.get("path"),
                                 message.get("status"))
            await send(message)

        await self.app(scope, receive, timed_send)


class CachedStaticFiles(StaticFiles):
    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = IMMUTABLE
        return resp
