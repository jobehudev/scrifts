"""Scrifts backend: FastAPI on localhost.

Two halves:
- FontForge core, reached through `Worker` (a long-lived ffpython subprocess
  running worker.py). Every font read/write goes through it.
- fontTools, in-process, for variable fonts only (fvar axes, per-location
  outlines, instancing, export).
"""
import json
import os
import subprocess
import sys
import threading
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from pydantic import BaseModel

ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
_BUNDLED_FF = ROOT / "FontForgeBuilds" / "bin" / "ffpython.exe"
FFPYTHON = os.environ.get("SCRIFTS_FFPYTHON") or os.environ.get(  # FORGE_FFPYTHON: the name before the rename
    "FORGE_FFPYTHON",
    str(_BUNDLED_FF) if _BUNDLED_FF.exists() else r"C:\Program Files\FontForgeBuilds\bin\ffpython.exe",
)
# frozen (installer): the worker and its helper modules ship as plain .py under ROOT/backend, for FontForge's own Python
WORKER = str(ROOT / "backend" / "worker.py") if getattr(sys, "frozen", False) else str(Path(__file__).with_name("worker.py"))
_NO_WINDOW = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


class WorkerError(RuntimeError):
    pass


class Worker:
    """One FontForge process, one request at a time.

    Cancel = kill the process. FontForge has no cooperative cancellation, so
    this is the only honest way to stop a long open/save. The open font is
    lost with it; the caller re-opens.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._proc = None
        self._next = 0
        self._cancelled = False

    def _ensure(self):
        if self._proc is None or self._proc.poll() is not None:
            variables.clear()  # every open font died with the old worker
            self._proc = subprocess.Popen(
                [FFPYTHON, "-u", WORKER], stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, encoding="utf-8", bufsize=1,
                creationflags=_NO_WINDOW)

    def call(self, op, **args):
        with self._lock:
            self._ensure()
            self._cancelled = False
            self._next += 1
            proc = self._proc
            try:
                proc.stdin.write(json.dumps({"id": self._next, "op": op, "args": args}) + "\n")
                proc.stdin.flush()
                line = proc.stdout.readline()
            except OSError:  # it died between two calls: the pipe is gone
                line = ""
        if not line:
            raise WorkerError("cancelled" if self._cancelled else "FontForge stopped unexpectedly (it crashed)")
        res = json.loads(line)
        if not res["ok"]:
            raise WorkerError(res["error"])
        return res["result"]

    def cancel(self):
        # Not under the lock: the lock is held by the call we want to stop.
        p = self._proc
        if p and p.poll() is None:
            self._cancelled = True
            p.kill()
            p.wait(5)  # gone for certain before the next call looks, or that call would write to a dead worker

    def close(self):
        self.cancel()


# ---------------------------------------------------------------- variable


class Variable:
    """fontTools view of the opened file, present only if it has fvar."""

    def __init__(self, path):
        self.path = path
        self.font = TTFont(path)
        self.axes = [
            {"tag": a.axisTag, "min": a.minValue, "default": a.defaultValue, "max": a.maxValue,
             "name": self.font["name"].getDebugName(a.axisNameID) or a.axisTag}
            for a in self.font["fvar"].axes]
        name = self.font["name"]
        self.instances = [
            {"name": name.getDebugName(i.subfamilyNameID) or "?", "location": dict(i.coordinates)}
            for i in self.font["fvar"].instances]
        self._glyphsets = lru_cache(maxsize=32)(self._glyphset)

    def _glyphset(self, loc_key):
        # getGlyphSet(location=...) applies gvar lazily per glyph: no
        # recompiling the font when a slider moves.
        return self.font.getGlyphSet(location=dict(loc_key))

    def outlines(self, location, names):
        key = tuple(sorted((k, round(float(v), 2)) for k, v in location.items()))
        gs = self._glyphsets(key)
        out = []
        for n in names:
            if n not in gs:
                continue
            pen, bounds = SVGPathPen(gs), BoundsPen(gs)
            g = gs[n]
            g.draw(pen)
            g.draw(bounds)
            x0, x1 = (bounds.bounds[0], bounds.bounds[2]) if bounds.bounds else (0, 0)
            out.append({"name": n, "width": g.width, "d": pen.getCommands(),
                        "lsb": x0, "rsb": g.width - x1})
        return out


# ---------------------------------------------------------------- app

app = FastAPI(title="Scrifts")
# only answer requests addressed to this machine: a web page cannot reach the API through a DNS name pointing at 127.0.0.1 (DNS rebinding)
from starlette.middleware.trustedhost import TrustedHostMiddleware  # noqa: E402
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]", "testserver"])


@app.middleware("http")
async def same_origin_only(request, call_next):
    """A page on another site can still fire GETs at localhost (an image, a link, a redirect), and several routes
    open the file a query names. Browsers say where a request comes from: only our own pages get the API."""
    if request.url.path.startswith("/api/") and request.headers.get("sec-fetch-site") in ("cross-site", "same-site"):
        return Response("cross-site request refused", status_code=403)
    return await call_next(request)


worker = Worker()
variables: dict[int, "Variable"] = {}  # fid -> fontTools view, for fonts with fvar


# ops that only read: anything else may have changed a font, which makes the compiled copy /api/shape keeps stale
_READS = {"webfont", "outlines", "points", "info", "kerning", "features", "ping", "open", "close", "point_data"}
_shape = {"rev": 0, "key": None, "font": b""}  # rev counts calls that may have changed a font; key is the (fid, rev) `font` was compiled for


def _call(op, **args):
    if op not in _READS:
        _shape["rev"] += 1
    try:
        return worker.call(op, **args)
    except WorkerError as e:
        msg = str(e)
        # 410: the font this client was showing is gone (closed, or worker
        # killed by Cancel). The client must reopen, never fall back to
        # whichever font happens to be open.
        code = 409 if msg == "cancelled" else 410 if msg.startswith("LookupError") else 400
        raise HTTPException(code, msg)


class FontReq(BaseModel):
    fid: int


class GlyphReq(FontReq):
    name: str
