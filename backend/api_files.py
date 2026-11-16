"""Files and the app around them: dialogs, open/new/save, autosave, snapshots, Glyphs files, generate, plugins, scripts."""

import json
import os
import subprocess
import sys
import threading
from pathlib import Path

from fastapi import HTTPException
from fontTools.ttLib import TTFont
from pydantic import BaseModel

from core import FontReq, ROOT, Variable, WorkerError, _call, app, variables, worker
from api_family import _family, _verify_ttf, family_of


class OpenReq(BaseModel):
    path: str


class SaveReq(FontReq):
    path: str | None = None


class PickReq(BaseModel):
    mode: str = "open"  # open | save | outline | image | folder
    initial: str | None = None


FONT_TYPES = [("Fonts", "*.sfd *.ttf *.otf *.ufo metainfo.plist *.designspace *.glyphs *.svg"), ("All files", "*.*")]


OUTLINE_TYPES = [("Outlines", "*.svg *.eps *.pdf *.glif"), ("All files", "*.*")]


PICTURE_TYPES = [("Pictures", "*.png *.jpg *.jpeg *.bmp *.gif *.tif *.tiff *.webp"), ("All files", "*.*")]


@app.post("/api/pick")
def pick(req: PickReq):
    """Native file dialog on this machine. Scrifts is local-only, so the backend
    can show it; a browser cannot hand out real paths."""
    import gc
    import tkinter
    from tkinter import filedialog

    with _PICK_LOCK:  # one dialog at a time
        try:
            return _pick(req, tkinter, filedialog)
        finally:
            gc.collect()  # Tcl aborts the process if its objects are freed on another thread: free them on this one


_PICK_LOCK = threading.Lock()


def _pick(req, tkinter, filedialog):
    root = tkinter.Tk()
    root.withdraw()
    root.attributes("-topmost", True)  # otherwise it opens behind the browser
    kw = {"parent": root, "filetypes": OUTLINE_TYPES if req.mode == "outline" else PICTURE_TYPES if req.mode == "image" else FONT_TYPES}
    if req.initial:
        kw["initialdir"] = os.path.dirname(req.initial) or home_folder()
        kw["initialfile"] = os.path.basename(req.initial)
    else:
        kw["initialdir"] = home_folder()
    try:
        if req.mode == "folder":
            path = filedialog.askdirectory(parent=root, title="Generate fonts into",
                                           initialdir=req.initial or None)
        elif req.mode == "save":
            path = filedialog.asksaveasfilename(title="Save font as", **kw)
        else:
            path = filedialog.askopenfilename(
                title="Import outlines into glyph" if req.mode == "outline" else "Pick a picture" if req.mode == "image"
                else "Open font (for a .ufo, pick its metainfo.plist)", **kw)
    finally:
        root.destroy()
    if path and os.path.basename(path) == "metainfo.plist":
        path = os.path.dirname(path)  # a .ufo is a folder
    return {"path": os.path.normpath(path) if path else None}


@app.get("/api/ping")
def ping():
    return _call("ping")


class RevealReq(BaseModel):
    path: str


class UrlReq(BaseModel):
    url: str


@app.post("/api/open-url")
def open_url(req: UrlReq):
    """Open a web page in the system browser (the desktop window would otherwise open it inside itself).
    Only https links, so a page cannot use this to start programs."""
    if not req.url.startswith("https://"):
        raise HTTPException(400, "only https links")
    import webbrowser
    webbrowser.open(req.url)
    return {"ok": True}


@app.post("/api/reveal")
def reveal(req: RevealReq):
    """Show a file in the system file manager (Scrifts runs on this machine, so it can)."""
    p = os.path.abspath(req.path)
    if not os.path.exists(p):
        raise HTTPException(404, f"No such file: {p}")
    if sys.platform == "win32":
        subprocess.Popen(["explorer", f"/select,{p}"])  # no shell: the path is one argument
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", p])
    else:
        subprocess.Popen(["xdg-open", p if os.path.isdir(p) else os.path.dirname(p)])
    return {"ok": True}


class PathsReq(BaseModel):
    paths: list[str]


@app.post("/api/missing")
def missing(req: PathsReq):
    """Which of these paths no longer exist (for greying out Recent)."""
    return {"missing": [p for p in req.paths if not os.path.exists(p)]}


@app.post("/api/open")
def open_font(req: OpenReq):
    # Windows "Copy as path" wraps the path in quotes.
    path = os.path.abspath(req.path.strip().strip('"').strip("'"))
    if not os.path.exists(path):
        raise HTTPException(404, f"No such file: {path}")
    is_ufo = os.path.isdir(path) and os.path.exists(os.path.join(path, "metainfo.plist"))
    if os.path.isdir(path) and not is_ufo:
        raise HTTPException(400, f"{path} is a folder, not a font (a .ufo folder needs metainfo.plist)")
    try:
        info = worker.call("open", path=path)
    except WorkerError as e:
        # FontForge reports every unreadable file as a bare "Open failed".
        raise HTTPException(409 if str(e) == "cancelled" else 400,
                            f"FontForge could not open {os.path.basename(path)}: {e}. "
                            "Supported here: .sfd, .ttf, .otf, .ufo, .glyphs, .svg")
    var = None
    if path.lower().endswith((".ttf", ".otf")) and _has_fvar(path):
        var = variables[info["fid"]] = Variable(path)
    info["axes"] = var.axes if var else []
    info["instances"] = var.instances if var else []
    info["mtime"] = os.path.getmtime(path)  # when the file was last saved: shown after a crash ("reopened from the save of 14:32")
    return info


def _has_fvar(path):
    with TTFont(path, lazy=True) as f:
        return "fvar" in f


class NewReq(BaseModel):
    path: str
    family: str
    style: str = "Regular"
    em: int = 1000
    quadratic: bool = False
    own_folder: bool = True  # put the font in a folder named after its family (so its masters can sit together)


@app.post("/api/new")
def new_font(req: NewReq):
    """Create an empty font, saved as .sfd at `path`, and open it."""
    path = os.path.abspath(req.path.strip().strip('"'))
    if not path.lower().endswith(".sfd"):
        path += ".sfd"
    if not req.family.strip():
        raise HTTPException(400, "A family name is required")
    if not 16 <= req.em <= 16384:
        raise HTTPException(400, "Units per em must be between 16 and 16384")
    if not os.path.isdir(os.path.dirname(path)):
        raise HTTPException(404, f"No such folder: {os.path.dirname(path)}")
    if req.own_folder:
        parent = os.path.dirname(path)
        name = "".join(c for c in req.family.strip() if c not in '<>:"/\\|?*').strip(" .")
        if name and os.path.basename(parent).lower() != name.lower():  # already in a folder of that name: stay there
            os.makedirs(os.path.join(parent, name), exist_ok=True)
            path = os.path.join(parent, name, os.path.basename(path))
    info = _call("new", path=path, family=req.family.strip(), style=req.style.strip() or "Regular",
                 em=req.em, quadratic=req.quadratic)
    info["axes"], info["instances"] = [], []
    return info


@app.post("/api/close")
def close_font(req: FontReq):
    v = variables.pop(req.fid, None)
    if v:
        v.font.close()
    try:
        return worker.call("close", fid=req.fid)
    except WorkerError:
        return {"closed": True}  # already gone


class ScriptReq(FontReq):
    code: str


_PREVIEWS: dict = {}


@app.get("/api/preview")
def preview(path: str, text: str = "Abg"):
    """A few letters of a font file as outlines, for the start screen. Opened for a moment through
    FontForge (so every format works) and cached until the file changes."""
    text = text[:8]
    if not os.path.isfile(path):
        raise HTTPException(404, f"no such file: {path}")
    if path.lower().endswith(".glyphs"):  # shown from its Scrifts project, once it has been opened
        import glyphs_io
        folder = glyphs_io.project_folder(path)
        proj = glyphs_io._read_project(folder, os.path.join(folder, os.path.splitext(os.path.basename(path))[0] + ".designspace")) if os.path.isdir(folder) else None
        if not proj:
            raise HTTPException(404, "this Glyphs file has not been opened in Scrifts yet")
        path = proj["default"]
    key = (os.path.normcase(os.path.abspath(path)), os.path.getmtime(path), text)
    if key in _PREVIEWS:
        return _PREVIEWS[key]
    info = _call("open", path=path)
    try:
        by = {g["unicode"]: g["name"] for g in info["glyphs"] if g["unicode"] >= 0}
        names = [by[ord(c)] for c in text if ord(c) in by]
        if not names:  # no such letters (a symbol font): whatever glyphs it starts with
            names = [g["name"] for g in info["glyphs"] if g["name"] != ".notdef"][:3]
        outs = _call("outlines", fid=info["fid"], names=names)
    finally:
        _call("close", fid=info["fid"])
    out = {"em": info["em"], "ascent": info["ascent"], "descent": info["descent"], "glyphs": outs}
    if len(_PREVIEWS) >= 64:
        _PREVIEWS.pop(next(iter(_PREVIEWS)))  # oldest first
    _PREVIEWS[key] = out
    return out


class ImportGlyphsReq(BaseModel):
    path: str  # a .glyphs file


@app.post("/api/import/glyphs")
def import_glyphs_file(req: ImportGlyphsReq):
    """Open a Glyphs (.glyphs) file as a Scrifts project: a folder next to it with one .sfd per master and
    a .designspace. The .glyphs file is not changed. Opening it again reopens the project as it is now."""
    import glyphs_io
    if not req.path.lower().endswith(".glyphs") or not os.path.isfile(req.path):
        raise HTTPException(400, "not a .glyphs file")

    def convert(ufo, sfd):
        fid = _call("open", path=ufo)["fid"]
        try:
            _call("strip_persistent", fid=fid)
            _call("save", fid=fid, path=sfd)
        finally:
            _call("close", fid=fid)

    try:
        return glyphs_io.import_glyphs(req.path, convert)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 -- glyphsLib raises many kinds on files it can't read
        raise HTTPException(400, f"couldn't read this .glyphs file: {type(e).__name__}: {e}")


class ExportGlyphsReq(BaseModel):
    path: str                    # the .glyphs file to write
    family: str | None = None    # a .designspace: every master of it
    fid: int | None = None       # or one open font


@app.post("/api/export/glyphs")
def export_glyphs_file(req: ExportGlyphsReq):
    """Write a Glyphs (.glyphs) file from a family or a single font. Masters are exported as they are in
    memory (unsaved edits included); axis curves kept from a Glyphs import are written back."""
    import glyphs_io
    from fontTools.designspaceLib import DesignSpaceDocument
    if not req.path.lower().endswith(".glyphs"):
        raise HTTPException(400, "the file name must end in .glyphs")
    if req.family:
        fam = _family(req.family)
        maps = glyphs_io.lib_get(DesignSpaceDocument.fromfile(req.family).lib, glyphs_io.AXIS_MAPS_KEY, {})
        axes = [{**a, "map": maps.get(a["name"], [])} for a in fam["axes"]]
        masters = [m["path"] for m in fam["masters"]]
        locations = [m["location"] for m in fam["masters"]]
    elif req.fid is not None:
        masters, axes, locations = [_call("info", fid=req.fid)["path"]], None, None
    else:
        raise HTTPException(400, "give a family or an open font")

    def to_ufo(sfd, ufo):
        fid = _call("open", path=sfd)["fid"]  # the open copy, so unsaved edits are included
        try:
            _call("save", fid=fid, path=ufo)
        finally:
            _call("close", fid=fid)

    try:
        return glyphs_io.export_glyphs(req.path, masters, locations, axes, to_ufo)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 -- glyphsLib raises many kinds
        raise HTTPException(400, f"couldn't write the .glyphs file: {type(e).__name__}: {e}")


# ------------------------------------------------------ snapshots

def _project(path: str):
    """(main file, every file of the project) for a font on disk: its family if it belongs to one, else itself."""
    path = os.path.abspath(path)
    if not path.lower().endswith(".sfd"):
        raise HTTPException(400, "snapshots work on .sfd projects (Scrifts' own format); this font isn't one")
    fam = family_of(path)
    if fam:
        files = [fam["path"]] + [m["path"] for m in fam["masters"]] + [b["path"] for b in fam["braces"]]
        return os.path.abspath(fam["path"]), [os.path.abspath(f) for f in files]
    return path, [path]


def _flush(files):
    """Save any unsaved changes of the project's open fonts first, so a snapshot holds what is on screen."""
    for f in files:
        if f.lower().endswith(".sfd") and os.path.isfile(f):
            fid = _call("open", path=f)["fid"]  # the open copy if there is one
            try:
                _call("autosave", fid=fid)
            finally:
                _call("close", fid=fid)


class SnapReq(BaseModel):
    path: str          # any font file of the project
    label: str = ""
    id: str | None = None


@app.get("/api/snapshots")
def snapshots_list(path: str):
    import snapshots
    main, files = _project(path)
    return {"main": main, "files": len(files), "items": snapshots.list_snapshots(main)}


@app.post("/api/snapshots")
def snapshots_create(req: SnapReq):
    import snapshots
    main, files = _project(req.path)
    _flush(files)
    return snapshots.create(main, files, req.label or "Snapshot", "manual")


@app.post("/api/snapshots/auto")
def snapshots_auto(req: SnapReq):
    """Take an automatic snapshot if it has been a while (the app calls this after it autosaved something)."""
    import snapshots
    main, files = _project(req.path)
    if not snapshots.due_for_auto(main):
        return {"made": False}
    _flush(files)
    return {"made": True, "snapshot": snapshots.create(main, files, "Automatic", "auto")}


@app.post("/api/snapshots/delete")
def snapshots_delete(req: SnapReq):
    import snapshots
    main, _ = _project(req.path)
    try:
        snapshots.delete(main, req.id or "")
    except ValueError as e:
        raise HTTPException(404, str(e))
    return {"deleted": req.id}


@app.post("/api/snapshots/restore")
def snapshots_restore(req: SnapReq):
    """Put a snapshot back over the project. The project's fonts must be closed first, or Scrifts would
    write the old copy over the restored one the next time it autosaved."""
    import snapshots
    main, files = _project(req.path)
    same = lambda p: os.path.abspath(p).replace("\\", "/").lower()  # the worker's Python spells Windows paths with slashes
    opened = {same(p) for p in _call("open_paths")}
    busy = [f for f in files if same(f) in opened]
    if busy:
        raise HTTPException(409, "close the project before restoring (it is still open)")
    try:
        return snapshots.restore(main, req.id or "", files)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.get("/api/snapshots/compare")
def snapshots_compare(path: str, id: str):
    """Which glyphs of this font differ from a snapshot: changed (shape, width, components or anchors), added, removed."""
    import snapshots
    main, _ = _project(path)
    try:
        folder = snapshots.path_of(main, id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    old_file = os.path.join(folder, os.path.relpath(os.path.abspath(path), os.path.dirname(main)))
    if not os.path.isfile(old_file):
        raise HTTPException(404, "this font was not part of that snapshot")
    new = _call("open", path=path)
    try:
        now = _call("point_data", fid=new["fid"])
    finally:
        _call("close", fid=new["fid"])
    old_fid = _call("open", path=old_file)["fid"]
    try:
        then = _call("point_data", fid=old_fid)
    finally:
        _call("close", fid=old_fid)
    same = lambda a, b: json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    return {"changed": sorted(n for n in now if n in then and not same(now[n], then[n])),
            "added": sorted(n for n in now if n not in then), "removed": sorted(n for n in then if n not in now)}


def home_folder() -> str:
    """Documents/Scrifts: where new fonts, the sample and file dialogs start. Windows "Controlled folder
    access" can block Documents, so ~/Scrifts Fonts is the fallback. A sample made by the old name
    (Documents/Forge) is copied over once."""
    for cand in (Path.home() / "Documents" / "Scrifts", Path.home() / "Scrifts Fonts"):
        try:
            cand.mkdir(parents=True, exist_ok=True)
        except OSError:
            continue
        old = Path.home() / "Documents" / "Forge" / "Forge Sample.sfd"
        if old.is_file() and not (cand / old.name).exists():
            try:
                import shutil
                shutil.copy2(old, cand / old.name)
            except OSError:
                pass
        return str(cand)
    return str(Path.home())


class SampleReq(BaseModel):
    folder: str | None = None  # default: Documents/Scrifts


@app.post("/api/sample")
def make_sample(req: SampleReq):
    """A small font to try Scrifts on, written to Documents/Scrifts (left alone if it is already there)."""
    folder = req.folder or home_folder()
    return _call("make_sample", path=os.path.join(folder, "Scrifts Sample.sfd"))


@app.post("/api/autosave")
def autosave(req: FontReq):
    """Save this font in place if it is an .sfd with unsaved changes; says whether it did, and whether
    something unsaved is left (a binary font is never overwritten)."""
    return _call("autosave", fid=req.fid)


class AutosaveAllReq(BaseModel):
    fids: list[int]


@app.post("/api/autosave/all")
def autosave_all(req: AutosaveAllReq):
    """Autosave several open fonts (the one being edited and the masters open beside it) in one request."""
    results = {f: _call("autosave", fid=f) for f in req.fids}
    return {"saved": any(r["saved"] for r in results.values()), "results": results}


# ------------------------------------------------------ plugins

PLUGINS_BUNDLED = str(ROOT / "plugins")


def _plugins():
    import plugins
    return plugins.discover_user(PLUGINS_BUNDLED)


@app.get("/api/plugins")
def list_plugins():
    """Plugins in the user's plugins folder (the ones that ship with Scrifts are put there if missing; broken ones are listed with their error)."""
    import plugins
    return {"folders": [{"label": l, "path": p} for l, p in plugins.plugin_dirs(PLUGINS_BUNDLED)],
            "plugins": [{k: v for k, v in p.items() if k != "folder"} for p in _plugins()]}


class RunPluginReq(FontReq):
    id: str
    params: dict = {}
    selected: str | None = None


@app.post("/api/plugins/run")
def run_plugin(req: RunPluginReq):
    """Run a plugin on the open font with the values the user chose (checked against its manifest)."""
    import plugins
    found = next((p for p in _plugins() if p["id"] == req.id), None)
    if not found:
        raise HTTPException(404, f"no plugin {req.id}")
    if "error" in found:
        raise HTTPException(400, f"{found['name']} can't run: {found['error']}")
    try:
        params = plugins.coerce(found["params"], req.params)
    except ValueError as e:
        raise HTTPException(400, str(e))
    r = _call("run_plugin", fid=req.fid, folder=found["folder"], params=params, selected=req.selected)
    if r["error"]:
        detail = f"{found['name']} stopped with an error:\n{r['error']}"
        if r["output"]:
            detail += f"\nIt printed: {r['output']}"
        raise HTTPException(400, detail)
    return {"log": r["log"], "output": r["output"]}


@app.post("/api/plugins/open-folder")
def open_plugins_folder():
    """Open your plugins folder in the file manager (made if it isn't there yet)."""
    import plugins
    folder = plugins.user_dir()
    os.makedirs(folder, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(folder)  # noqa: S606 -- the user's own folder
    elif sys.platform == "darwin":
        subprocess.Popen(["open", folder])
    else:
        subprocess.Popen(["xdg-open", folder])
    return {"path": folder}


@app.post("/api/script")
def run_script(req: ScriptReq):
    """Arbitrary Python in the FontForge worker, like FontForge's Execute
    Script. Scrifts only listens on localhost; this is the user's own machine."""
    return _call("run_script", fid=req.fid, code=req.code)


@app.post("/api/save")
def save(req: SaveReq):
    return _call("save", fid=req.fid, path=req.path)


class GenerateReq(FontReq):
    folder: str
    name: str
    formats: list[str]
    hinting: str = "keep"  # keep | none | auto


class FixReq(FontReq):
    bit: int


@app.get("/api/validate")
def validate(fid: int):
    return _call("validate", fid=fid)


@app.post("/api/validate/fix")
def validate_fix(req: FixReq):
    return _call("fix_problem", fid=req.fid, bit=req.bit)


@app.post("/api/generate")
def generate(req: GenerateReq):
    """FontForge writes each format; fontTools then reads every table back
    (WOFF2 included), so a broken file fails here, not in a user's browser."""
    if not os.path.isdir(req.folder):
        raise HTTPException(400, f"not a folder: {req.folder}")
    name = req.name.strip()
    if not name or any(c in name for c in '\\/:*?"<>|'):
        raise HTTPException(400, "file name is empty or has characters a file name can't have")
    out = []
    for fmt in req.formats:
        if fmt not in ("otf", "ttf", "woff", "woff2"):
            raise HTTPException(400, f"unsupported format: {fmt}")
        res = _call("generate", fid=req.fid, path=os.path.join(req.folder, f"{name}.{fmt}"), hinting=req.hinting)
        res.update(_verify_ttf(res["path"], expect_fvar=False))
        out.append(res)
    return out


@app.post("/api/cancel")
def cancel():
    worker.cancel()
    variables.clear()  # every open font died with the worker
    return {"cancelled": True}
