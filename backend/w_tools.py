"""Scripts, plugins, traced outlines, artboards and outline import.

Part of the FontForge worker (worker.py): runs under FontForge's own Python, stdlib and fontforge only."""

import contextlib
import io
import os
import traceback

import fontforge
import psMat

import w_state as state
from w_font import SvgPen, _DEPS, op_points
from w_edit import _edit, op_create_glyph


def op_run_script(code):
    """Run user Python against the open font, as FontForge's own Execute
    Script does. `font`, `fontforge` and `psMat` are predefined."""
    out = io.StringIO()
    error = None
    env = {"fontforge": fontforge, "psMat": psMat, "font": state.FONT, "__name__": "__forge_script__"}
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        try:
            exec(compile(code, "<script>", "exec"), env)
        except BaseException:  # noqa: BLE001 - report everything, keep the worker alive
            error = traceback.format_exc(limit=-3)
    return {"output": out.getvalue(), "error": error}


class _PluginContext:
    """What a plugin gets next to the font: the selected glyph, helpers, and a log shown to the user."""

    def __init__(self, selected, log):
        self.selected = selected
        self._log = log

    def log(self, *parts):
        self._log.append(" ".join(str(p) for p in parts))

    def glyph(self, name_or_char):
        """A glyph by name or by the character it is for ('H'); None if the font has none."""
        if name_or_char in state.FONT:
            return state.FONT[name_or_char]
        if len(name_or_char) == 1 and ord(name_or_char) in state.FONT:
            return state.FONT[ord(name_or_char)]
        return None

    def glyphs(self, scope="selected"):
        """The glyphs to work on: just the selected one, or every glyph."""
        if scope == "all":
            return list(state.FONT.glyphs())
        g = self.glyph(self.selected) if self.selected else None
        return [g] if g else []

    def undoable(self, *glyphs):
        """Call before changing glyphs so the editor's Undo can take the change back (per glyph)."""
        for g in glyphs:
            (state.FONT[g] if isinstance(g, str) else g).preserveLayerAsUndo(1)


def op_run_plugin(folder, params, selected=None):
    """Run a plugin's main.py (its `run(font, ctx, params)`) against the open font, as op_run_script does for a
    script. The server only passes folders it found itself."""
    out = io.StringIO()
    log, error = [], None
    env = {"fontforge": fontforge, "psMat": psMat, "__name__": "__forge_plugin__"}
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        try:
            with open(os.path.join(folder, "main.py"), encoding="utf8") as fh:
                exec(compile(fh.read(), os.path.join(folder, "main.py"), "exec"), env)
            run = env.get("run")
            if not callable(run):
                raise RuntimeError("main.py has no run(font, ctx, params) function")
            run(state.FONT, _PluginContext(selected, log), params)
        except BaseException:  # noqa: BLE001 - report everything, keep the worker alive
            error = traceback.format_exc(limit=-4)
    _DEPS.pop(id(state.FONT), None)  # a plugin may have changed metrics keys
    return {"output": out.getvalue(), "log": log, "error": error}


class _ArtboardPen(SvgPen):
    """SvgPen with the y axis turned over: artboards are y-down, with the baseline `ascent` from the top."""

    def __init__(self, font, ascent):
        super().__init__(font)
        self.ascent = ascent

    def _p(self, *pts):
        return " ".join(f"{x:g} {self.ascent - y:g}" for x, y in pts)


def op_ensure_char(cp):
    """The glyph for a character, made (empty) if the font has none yet."""
    if cp in state.FONT:
        return {"name": state.FONT[cp].glyphname, "created": False}
    return {"name": op_create_glyph(unicode=cp)["name"], "created": True}


def op_set_traced(name, contours, width=None, tidy=True):
    """Replace a glyph's outline with traced contours (closed cubic [x, y, on-curve] lists, y up). FontForge
    removes the overlaps, (with `tidy`) simplifies to fewer points, adds extrema, fixes the direction and
    rounds to whole units; undoable."""
    g = state.FONT[name]

    def build(layer):
        new = fontforge.layer()
        new.is_quadratic = layer.is_quadratic
        for pts in contours:
            c = fontforge.contour()
            for x, y, on in pts:
                c += fontforge.point(x, y, bool(on))
            c.closed = True
            if layer.is_quadratic:
                c.is_quadratic = True  # FontForge's own cubic -> quadratic conversion
            new += c
        new.removeOverlap()
        if tidy:
            new.simplify()
        new.addExtrema()
        new.correctDirection()
        new.round()
        return new

    _edit(g, build)
    if width:
        g.width = int(width)
    return op_points(name)


def _glyph_for(stem):
    """The glyph a file name stands for: its name, or the code point it encodes (u0041 / uni0041)."""
    if stem in state.FONT:
        return state.FONT[stem]
    cp = fontforge.unicodeFromName(stem)
    return state.FONT[cp] if cp >= 0 and cp in state.FONT else None


def op_export_artboards(folder, names=None, chars="", template=False, square=True):
    """One SVG per glyph (see artboards.py). `names` picks glyphs; else every glyph with an outline.
    `chars` adds those characters even if the font has no glyph for them yet (a template to draw them on)."""
    import artboards
    os.makedirs(folder, exist_ok=True)
    todo = []  # (glyph name, advance)
    for n in (names if names is not None else [g.glyphname for g in state.FONT.glyphs() if len(g.foreground) and g.glyphname != ".notdef"]):
        todo.append((n, state.FONT[n].width))
    for ch in chars:
        cp = ord(ch)
        if cp in state.FONT:
            gname = state.FONT[cp].glyphname
            if all(gname != n for n, _ in todo):
                todo.append((gname, state.FONT[cp].width))
        else:
            todo.append((fontforge.nameFromUnicode(cp), state.FONT.em // 2))
    written = []
    for n, adv in todo:
        d = ""
        if not template and n in state.FONT and len(state.FONT[n].foreground):
            pen = _ArtboardPen(state.FONT, state.FONT.ascent)
            state.FONT[n].draw(pen)
            d = " ".join(pen.d)
        xh = state.FONT.xHeight if state.FONT.xHeight > 0 else None
        ch = state.FONT.capHeight if state.FONT.capHeight > 0 else None
        svg = artboards.artboard_svg(d, adv, state.FONT.ascent, state.FONT.descent, xh, ch, board=max(state.FONT.em, adv) if square else None)
        fname = artboards.file_name(n) + ".svg"
        with open(os.path.join(folder, fname), "w", encoding="utf8") as fh:
            fh.write(svg)
        written.append(fname)
    return {"folder": folder, "files": written}


def op_import_artboards(folder, apply=False, create=True, files=None):
    """Read the Outline layer of every SVG in a folder into the glyph its file name stands for.
    Without apply it only reports what would happen: new / replace / empty (nothing drawn, left alone) / unknown."""
    import artboards
    report, tmp = [], os.path.join(folder, ".scrifts-import.svg")
    for fn in sorted(os.listdir(folder)):
        if not fn.lower().endswith(".svg") or fn.startswith("."):
            continue
        stem = artboards.glyph_name(fn[:-4])
        svg = open(os.path.join(folder, fn), encoding="utf8").read()
        g = _glyph_for(stem) or _glyph_for("." + stem[1:] if stem.startswith("_") else stem)
        if not artboards.has_shapes(svg):
            report.append({"file": fn, "glyph": g.glyphname if g else stem, "status": "empty"})
            continue
        if g is None:
            if not create:
                report.append({"file": fn, "glyph": stem, "status": "unknown"})
                continue
            status = "new"
        else:
            status = "replace" if len(g.foreground) else "new"
        if apply and files is not None and fn not in files:
            status = "skipped"  # not ticked
        elif apply:
            if g is None:
                cp = fontforge.unicodeFromName(stem)
                g = state.FONT.createChar(cp, stem) if cp >= 0 else state.FONT.createChar(-1, stem)
                if g.width == state.FONT.em:
                    adv = artboards.advance_of(svg)
                    g.width = int(round(adv)) if adv else state.FONT.em // 2
            with open(tmp, "w", encoding="utf8") as fh:
                fh.write(artboards.outline_only(svg))
            g.preserveLayerAsUndo(1)
            g.foreground = fontforge.layer()
            g.importOutlines(tmp)
            # the edge guides set the sidebearing and the advance: the origin is the left-edge line, the advance runs to the right-edge line
            left, right = artboards.edges_of(svg)
            if left:
                g.transform((1, 0, 0, 1, -left, 0))
            if right is not None and right - (left or 0) > 0:
                g.width = int(round(right - (left or 0)))
        report.append({"file": fn, "glyph": g.glyphname if g else stem, "status": status})
    if os.path.exists(tmp):
        os.remove(tmp)
    return {"folder": folder, "applied": apply, "glyphs": report}


def op_import_outlines(name, path, flags=()):
    """FontForge's own SVG/EPS/PDF/GLIF import, into the glyph, undoable."""
    g = state.FONT[name]
    g.preserveLayerAsUndo(1)
    g.importOutlines(path, tuple(flags))
    return op_points(name)
