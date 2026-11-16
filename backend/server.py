"""Scrifts backend: FastAPI on localhost. This file is the entry point (`server:app`).

core.py holds the app, the FontForge worker and the fontTools view of variable fonts; the routes live by topic in
api_family.py, api_glyphs.py, api_import.py and api_files.py and register themselves on the app when imported.
"""
import os
import sys
from pathlib import Path

from fastapi.staticfiles import StaticFiles

import api_family  # noqa: F401 -- imported for its routes
import api_files  # noqa: F401
import api_glyphs  # noqa: F401
import api_import  # noqa: F401
from core import FFPYTHON, ROOT, Worker, app, worker  # noqa: F401
# names the tests and bench scripts reach for as server.X
from api_family import _compare_instance, _family  # noqa: F401
from api_files import home_folder  # noqa: F401
from api_glyphs import _smart_regen  # noqa: F401
from core import TTFont, _call, subprocess, variables  # noqa: F401

_DIST = ROOT / "frontend" / "dist"


class _Fresh(StaticFiles):
    """The app is served from this machine, so always revalidate: otherwise the desktop shell's browser keeps showing
    the previous version's index.html after an upgrade."""

    async def get_response(self, path, scope):
        r = await super().get_response(path, scope)
        r.headers["Cache-Control"] = "no-cache"
        return r


if _DIST.is_dir():
    app.mount("/", _Fresh(directory=str(_DIST), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    if getattr(sys, "frozen", False):
        # the installed app has no console: keep what the server says (errors included) in a log users can send
        log_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Scrifts"
        log_dir.mkdir(parents=True, exist_ok=True)
        sys.stdout = sys.stderr = open(log_dir / "backend.log", "a", encoding="utf8", buffering=1)
        print(f"--- start {__import__('datetime').datetime.now():%Y-%m-%d %H:%M:%S}")

    import shutil, tempfile, time
    for p in Path(tempfile.gettempdir()).glob("scrifts-*"):
        try:
            if time.time() - p.stat().st_mtime > 86400:
                shutil.rmtree(p, True) if p.is_dir() else p.unlink()
        except OSError:
            pass
    port = int(os.environ.get("SCRIFTS_PORT") or os.environ.get("FORGE_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
