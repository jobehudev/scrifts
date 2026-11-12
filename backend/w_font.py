"""The font as a whole: opening and closing, SVG drawings, font info, OpenType features, font-wide undo, outlines and points for drawing.

Part of the FontForge worker (worker.py): runs under FontForge's own Python, stdlib and fontforge only."""

import contextlib
import os
import re
import sys
import tempfile

import fontforge

import w_state as state
from strokes import parse as stroke_of


class SvgPen:
    """Collects fontforge's glyph.draw() output as SVG path data (y-up font units)."""

    def __init__(self, font, depth=0):
        self.d = []
        self.font = font
        self.depth = depth

    def _p(self, *pts):
        return " ".join(f"{x:g} {y:g}" for x, y in pts)

    def moveTo(self, p):
        self.d.append("M" + self._p(p))

    def lineTo(self, p):
        self.d.append("L" + self._p(p))

    def curveTo(self, *pts):
        # fontTools pen semantics: n off-curves + 1 on-curve. FontForge only
        # emits the n=2 case for cubic glyphs.
        self.d.append("C" + self._p(*pts))

    def qCurveTo(self, *pts):
        # TrueType implied on-curve points between consecutive off-curves.
        if pts[-1] is None:  # closed all-off-curve contour
            pts = pts[:-1]
            first = ((pts[-1][0] + pts[0][0]) / 2, (pts[-1][1] + pts[0][1]) / 2)
            self.d.append("M" + self._p(first))
            pts = list(pts) + [first]
        offs, end = pts[:-1], pts[-1]
        for i, off in enumerate(offs):
            nxt = end if i == len(offs) - 1 else (
                (off[0] + offs[i + 1][0]) / 2, (off[1] + offs[i + 1][1]) / 2)
            self.d.append("Q" + self._p(off, nxt))

    def closePath(self):
        self.d.append("Z")

    endPath = closePath

    def addComponent(self, name, t):
        if self.depth > 8 or name not in self.font:
            return
        sub = SvgPen(self.font, self.depth + 1)
        self.font[name].draw(sub)
        # The client composes this with Path2D.addPath(sub, DOMMatrix(t)):
        # a render-time transform, not geometry we compute ourselves.
        self.d.append({"ref": name, "t": list(t), "d": sub.path()})

    def path(self):
        out, refs = [], []
        for x in self.d:
            (refs if isinstance(x, dict) else out).append(x)
        return {"d": "".join(out), "refs": refs} if refs else {"d": "".join(out)}


def _glyph_summary(g):
    return {"name": g.glyphname, "unicode": g.unicode, "width": g.width}


def _expand_layer(layer, only=None):
    """(a layer with the stroke contours replaced by their outlines, how many were). FontForge strokes each
    skeleton with its own settings (see strokes.py), and the new outlines are merged where they overlap.
    `only` limits it to those contour numbers."""
    new = fontforge.layer()
    new.is_quadratic = layer.is_quadratic
    made = fontforge.layer()
    made.is_quadratic = layer.is_quadratic
    n = 0
    for ci, c in enumerate(layer):
        s = stroke_of(c.name)
        if s and (only is None or ci in only):
            one = fontforge.layer()
            one.is_quadratic = layer.is_quadratic
            skeleton = c.dup()
            skeleton.name = ""
            one += skeleton
            one.stroke("circular", s.width, s.cap, s.join)
            for outline in one:
                made += outline
            n += 1
        else:
            new += c
    if n:
        made.removeOverlap()
        for outline in made:
            new += outline
    return new, n


@contextlib.contextmanager
def _expanded(glyphs):
    """Inside the block these glyphs hold the outlines of their strokes instead of the skeletons; afterwards
    the skeletons are put back. For drawing views and for generating fonts, which cannot hold a skeleton."""
    saved = []
    try:
        for g in glyphs:
            if any(stroke_of(c.name) for c in g.foreground):
                saved.append((g.glyphname, g.foreground))
                g.foreground = _expand_layer(g.foreground)[0]
        yield
    finally:
        for name, layer in saved:
            state.FONT[name].foreground = layer


def _outline(g):
    pen = SvgPen(state.FONT)
    with _expanded([g]):
        g.draw(pen)
    out = pen.path()
    out.update(name=g.glyphname, width=g.width,
               lsb=round(g.left_side_bearing, 1), rsb=round(g.right_side_bearing, 1))  # slanted outlines give long decimals; one is plenty
    return out


def op_open(path):
    if path.lower().endswith(".svg"):
        return _open_svg(path)
    # FontForge reuses an open font only for the identical path string; any
    # other spelling (slashes, case) would load a second copy from disk,
    # without the unsaved edits. Match on the normalised path instead.
    key = os.path.normcase(os.path.abspath(path))
    same = next((f for f, p in state.FONTS.values() if os.path.normcase(os.path.abspath(p)) == key), None)
    state.FONT, state.PATH = same or fontforge.open(path, ("hidewindow", "alltables")), path
    state.NEXT_FID += 1
    state.FONTS[state.NEXT_FID] = (state.FONT, state.PATH)
    return {"fid": state.NEXT_FID, **op_info()}


# ---------------------------------------------------------------- SVG drawings
# An .svg opens as a one-glyph "font" so every drawing tool works on it: the page is the glyph (y up, origin at the
# bottom left), each shape is a group of contours whose name carries its colours (see svgdoc.py). Saving writes the
# .svg back. Never autosaved: the file is rewritten from what we understand (no text, gradients, filters).

SVGDOCS = {}  # fid -> {"w", "h", "scale"}


class SvgDocPen(SvgPen):
    endPath = lambda self: None  # an open contour stays open (SvgPen closes both)


def _open_svg(path):
    import svgdoc
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        doc = svgdoc.parse(fh.read())
    W, H = doc["width"], doc["height"]
    scale = 16 / H if H < 16 else 16384 / H if H > 16384 else 1.0
    em = int(round(H * scale))
    f = fontforge.font()
    f.encoding = "UnicodeBmp"
    f.em = em
    f.ascent, f.descent = em, 0
    f.familyname = f.fontname = "Drawing"
    g = f.createChar(-1, "drawing")
    g.width = int(round(W * scale))
    tmp = os.path.join(tempfile.gettempdir(), f"scrifts-svg-{os.getpid()}.svg")
    # FontForge scales an imported SVG by a factor of its own: measure it once with a rectangle the size of the page
    probe = fontforge.font(); probe.em = em; probe.ascent, probe.descent = em, 0
    pg = probe.createChar(-1, "p")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(svgdoc.one_shape_svg(W, H, {"d": f"M0 0H{W:g}V{H:g}H0Z", "transform": ""}))
    pg.importOutlines(tmp)
    xmin, _, xmax, _ = pg.foreground.boundingBox()
    probe.close()
    k = (xmax - xmin) / W if xmax > xmin else 1.0
    a = scale / k  # imported units -> ours (y is also flipped about the page: ascent - y*k  ->  H*scale - y*scale)
    m = (a, 0, 0, a, 0, H * scale - em * a)
    # importOutlines puts new contours at the front of the layer, so the shapes go in back to front
    for idx in range(len(doc["shapes"]) - 1, -1, -1):
        shape = doc["shapes"][idx]
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(svgdoc.one_shape_svg(W, H, shape))
        before = len(g.foreground)
        g.importOutlines(tmp)
        layer = g.foreground
        for i in range(len(layer) - before):
            c = layer[i]
            c.transform(m)
            if shape["fill"]:
                c.closed = True  # a fill closes an open path
            c.name = svgdoc.tag(idx, {**shape, "sw": shape["sw"] * scale})
            layer[i] = c
        g.foreground = layer
    if os.path.exists(tmp):
        os.remove(tmp)
    state.NEXT_FID += 1
    state.FONT, state.PATH = f, path
    state.FONTS[state.NEXT_FID] = (f, path)
    SVGDOCS[state.NEXT_FID] = {"w": W, "h": H, "scale": scale}
    return {"fid": state.NEXT_FID, "svg": {"lost": doc["lost"], "shapes": len(doc["shapes"])}, **op_info()}


def _save_svg(path):
    import svgdoc
    d = SVGDOCS.get(state.FID)
    if d is None:
        raise ValueError("this is not an SVG drawing")
    g = state.FONT["drawing"]
    groups = []  # [(key, [contours])] in drawing order; contours of one shape sit together
    for c in g.foreground:
        t = svgdoc.untag(c.name)
        key = t[0] if t else None
        if groups and key is not None and groups[-1][0] == key:
            groups[-1][1].append(c)
        else:
            groups.append((key, [c]))
    items = []
    for key, cs in groups:
        layer = fontforge.layer()
        layer.is_quadratic = g.foreground.is_quadratic
        for c in cs:
            layer += c.dup()
        pen = SvgDocPen(state.FONT)
        layer.draw(pen)
        dstr = "".join(pen.d)
        t = svgdoc.untag(cs[0].name)
        if t:
            items.append((dstr, t[1], t[2], t[3], t[4]))
        elif all(c.closed for c in cs):
            items.append((dstr, "#000000", None, 1, 1.0))
        else:
            items.append((dstr, None, "#000000", 2 * d["scale"], 1.0))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(svgdoc.write(d["w"], d["h"], d["scale"], items))


def op_new(path, family, style="Regular", em=1000, quadratic=False):
    """A new, empty font from FontForge's own defaults, saved as .sfd at
    `path` and then opened like any other file (so Save knows where to go)."""
    f = fontforge.font()
    f.encoding = "UnicodeBmp"
    f.em = int(em)  # FontForge rescales ascent/descent with it (80/20)
    f.familyname = family
    f.fontname = (family + "-" + style).replace(" ", "")
    f.fullname = f"{family} {style}"
    f.weight = style
    f.is_quadratic = bool(quadratic)
    for cp, name, width in ((-1, ".notdef", f.em // 2), (32, "space", f.em // 4)):
        g = f.createChar(cp, name)
        g.width = width
    f.save(path)
    f.close()
    return op_open(path)


# ---------------------------------------------------------------- font info


TEXT_FIELDS = ("familyname", "fontname", "fullname", "weight", "version", "copyright")


NUMBER_FIELDS = {"italicangle": float, "upos": int, "uwidth": int, "os2_weight": int, "os2_width": int,
                 "os2_fstype": int, "os2_strikeypos": int, "os2_strikeysize": int,
                 "os2_stylemap": int, "macstyle": int}  # style linking: fsSelection bits, head.macStyle (-1: FontForge decides)


# vertical metrics FontForge can compute itself (stored as "add" offsets)
AUTO_METRICS = ("os2_typoascent", "os2_typodescent", "os2_winascent", "os2_windescent", "hhea_ascent", "hhea_descent")


PLAIN_METRICS = ("os2_typolinegap", "hhea_linegap")


NAMES = ("Designer", "Designer URL", "Manufacturer", "Vendor URL", "License", "License URL", "Trademark",
         "Descriptor", "Sample Text", "Preferred Family", "Preferred Styles", "Family", "SubFamily")


LANG = "English (US)"


def op_font_info():
    f = state.FONT
    names = {strid: text for lang, strid, text in f.sfnt_names if lang == LANG and strid in NAMES}
    return {
        "fields": {k: getattr(f, k) for k in TEXT_FIELDS + tuple(NUMBER_FIELDS)},
        "os2_vendor": f.os2_vendor.strip(),
        "use_typo_metrics": bool(f.os2_use_typo_metrics),
        "em": f.em, "ascent": f.ascent, "descent": f.descent,
        # FontForge measures these from x and H; without those glyphs it returns -1e23
        "xheight": f.xHeight if f.xHeight > -1e6 else None, "capheight": f.capHeight if f.capHeight > -1e6 else None,
        # auto: FontForge works the value out at export (offset from its default)
        "metrics": {**{k: {"value": getattr(f, k), "auto": bool(getattr(f, k + "_add"))} for k in AUTO_METRICS},
                    **{k: {"value": getattr(f, k), "auto": False} for k in PLAIN_METRICS}},
        "names": {n: names.get(n, "") for n in NAMES},
    }


_PS_NAME = re.compile(r"^[!-~]{1,63}$")


def op_set_font_info(fields=None, os2_vendor=None, use_typo_metrics=None, ascent=None, descent=None,
                     metrics=None, names=None):
    """Write only the listed fields. Ascent and descent come as a pair whose
    sum must stay the units per em: setting one alone makes FontForge change
    the em without scaling any outline."""
    f = state.FONT
    for k, v in (fields or {}).items():
        if k in TEXT_FIELDS:
            v = str(v)
            if k == "fontname" and (not _PS_NAME.match(v) or set(v) & set("[](){}<>/%")):
                raise ValueError("PostScript name: up to 63 printable ASCII characters, no spaces or [](){}<>/%")
            if k in ("familyname", "fontname", "fullname") and not v.strip():
                raise ValueError(f"{k} can't be empty")
            setattr(f, k, v)
        elif k in NUMBER_FIELDS:
            v = NUMBER_FIELDS[k](v)
            if k == "os2_weight" and not 1 <= v <= 1000:
                raise ValueError("weight class is 1-1000 (400 regular, 700 bold)")
            if k == "os2_width" and not 1 <= v <= 9:
                raise ValueError("width class is 1-9 (5 normal)")
            setattr(f, k, v)
        else:
            raise ValueError(f"not an editable field: {k}")
    if os2_vendor is not None:
        if not re.match(r"^[ -~]{0,4}$", os2_vendor):
            raise ValueError("vendor ID: up to 4 ASCII characters")
        f.os2_vendor = os2_vendor
    if use_typo_metrics is not None:
        f.os2_use_typo_metrics = bool(use_typo_metrics)
    if ascent is not None or descent is not None:
        a, d = int(ascent if ascent is not None else f.ascent), int(descent if descent is not None else f.descent)
        if a + d != f.em or a < 0 or d < 0:
            raise ValueError(f"ascent + descent must equal the units per em ({f.em})")
        f.ascent, f.descent = a, d
    for k, m in (metrics or {}).items():
        if k in AUTO_METRICS:
            if m.get("auto"):
                setattr(f, k + "_add", 1)
                setattr(f, k, 0)
            else:
                setattr(f, k + "_add", 0)
                setattr(f, k, int(m["value"]))
        elif k in PLAIN_METRICS:
            setattr(f, k, int(m["value"]))
        else:
            raise ValueError(f"not an editable metric: {k}")
    if names:
        bad = set(names) - set(NAMES)
        if bad:
            raise ValueError(f"not an editable name: {', '.join(sorted(bad))}")
        _set_names(f, names)
    return op_font_info()


def _set_names(f, names):
    """Write these English names; an empty value removes the name."""
    keep = [x for x in f.sfnt_names if not (x[0] == LANG and x[1] in names)]
    f.sfnt_names = tuple(keep + [(LANG, k, v) for k, v in names.items() if v])


def _apply_linking(f, style, weight):
    """Style bits and family/style names (IDs 1, 2, 16, 17) for a family member."""
    from style_linking import style_linking
    r = style_linking(f.familyname, style, weight)
    for k, v in r["fields"].items():
        setattr(f, k, v)
    _set_names(f, r["names"])


# --------------------------------------------------------- OpenType features
#
# Substitution features (GSUB) are edited as Adobe feature-file code and
# compiled by FontForge. Positioning (kerning, marks) stays with its own
# editors and is never touched here.


_LOOKUP_BLOCK = re.compile(r"(?ms)^lookup (\S+) \{.*?^\} \1;")


_LOOKUP_NAME = re.compile(r"^\s*lookup\s+(\S+)\s*\{", re.M)


_GLYPH_REF = re.compile(r"\\([A-Za-z0-9_.\-]+)")  # FontForge writes glyph names as \name


_RULE = ("sub ", "ignore ", "rsub ", "reversesub ", "substitute ")


def _drop_missing(text):
    """FontForge keeps glyph names in lookups after the glyph is gone, exports
    them, then rejects them on import. Such rules can never apply (FontForge
    leaves them out of compiled fonts too), so they are left out here: whole
    rules that name a missing glyph, and missing names inside class lists."""
    out = []
    for line in text.splitlines():
        missing = [n for n in _GLYPH_REF.findall(line) if n not in state.FONT]
        if not missing:
            out.append(line)
        elif not line.strip().startswith(_RULE):
            for n in missing:
                line = line.replace("\\" + n + " ", "").replace("\\" + n, "")
            out.append(line)
    return "\n".join(out)


def _export_lookup(lk):
    fd, path = tempfile.mkstemp(suffix=".fea")
    os.close(fd)
    try:
        state.FONT.generateFeatureFile(path, lk)
        return _drop_missing(open(path, encoding="utf-8").read().strip())
    finally:
        os.unlink(path)


def op_features():
    """The font's substitution features as one feature file: a languagesystem
    header, then every GSUB lookup as FontForge exports it (each export
    already registers its lookup in its features, scripts and languages)."""
    if any(" NULL " in _export_lookup(lk) for lk in state.FONT.gsub_lookups):
        # Before a font is first compiled, FontForge exports class-based
        # contextual rules with NULL placeholders that it can't read back.
        # Compiling converts the rule; do it once into a throwaway file.
        os.unlink(op_webfont()["path"])
    blocks, langsys, seen = [], [], set()

    def once(m):  # a contextual lookup's export repeats the lookups it calls
        if m.group(1) in seen:
            return ""
        seen.add(m.group(1))
        return m.group(0)

    for lk in state.FONT.gsub_lookups:
        text = _export_lookup(lk)
        if not _LOOKUP_NAME.search(text):
            continue
        blocks.append(_LOOKUP_BLOCK.sub(once, text).strip())
        for _tag, scripts in state.FONT.getLookupInfo(lk)[2]:
            for script, langs in scripts:
                for lang in langs:
                    if (script, lang.strip()) not in langsys:
                        langsys.append((script, lang.strip()))
    langsys.sort(key=lambda sl: (sl[0] != "DFLT", sl))
    out = [f"languagesystem {sc} {la};" for sc, la in langsys] + [""] + blocks
    lookups = [{"name": lk, "type": state.FONT.getLookupInfo(lk)[0],
                "features": sorted({t for t, _ in state.FONT.getLookupInfo(lk)[2]})} for lk in state.FONT.gsub_lookups]
    gpos = sorted({t for lk in state.FONT.gpos_lookups for t, _ in state.FONT.getLookupInfo(lk)[2]})
    return {"code": "\n".join(out).strip() + "\n", "lookups": lookups, "gpos_features": gpos}


def _merge_capturing_errors(code):
    """mergeFeature, with FontForge's messages captured: it reports syntax
    errors and unknown glyphs on stderr and merges what it could anyway."""
    fd, path = tempfile.mkstemp(suffix=".fea")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(code)
    log_fd, log_path = tempfile.mkstemp(suffix=".log")
    saved = os.dup(2)
    os.dup2(log_fd, 2)
    error = None
    try:
        state.FONT.mergeFeature(path)
    except Exception as e:  # noqa: BLE001
        error = str(e)
    finally:
        sys.stderr.flush()
        os.dup2(saved, 2)
        os.close(saved)
        os.close(log_fd)
        os.unlink(path)
    messages = open(log_path, encoding="utf-8", errors="replace").read().strip()
    os.unlink(log_path)
    return error, messages


def op_set_features(code):
    """Replace the font's substitution features with `code`. Atomic: the new
    lookups are compiled next to the old ones first; on any error they are
    removed again and the font is exactly as before."""
    old_sub, old_pos = list(state.FONT.gsub_lookups), list(state.FONT.gpos_lookups)
    error, messages = _merge_capturing_errors(code)
    new_sub = [lk for lk in state.FONT.gsub_lookups if lk not in old_sub]
    new_pos = [lk for lk in state.FONT.gpos_lookups if lk not in old_pos]
    problems = error or ("\n".join(l for l in messages.splitlines() if l.strip()) if messages else "")
    problems = re.sub(r" of \S+\.fea", "", problems)  # the temp file's name means nothing to the user
    if new_pos and not problems:
        problems = "Positioning (pos) rules aren't edited here: kerning lives in Spacing, marks in Anchors."
    if problems:
        for lk in new_sub + new_pos:
            state.FONT.removeLookup(lk)
        raise ValueError(problems)
    for lk in old_sub:
        state.FONT.removeLookup(lk)
    return op_features()


def op_webfont():
    """The open font compiled by FontForge to a temporary OTF/TTF, so the UI
    can be shown in it. Returns the file path; the server reads and deletes it."""
    import tempfile
    fd, path = tempfile.mkstemp(suffix=".ttf" if state.FONT.is_quadratic else ".otf", prefix="forge-ui-")
    os.close(fd)
    # Not "no-hints": for TrueType output FontForge then writes no glyf table
    # at all (every outline gone), which browsers rightly refuse to load.
    with _expanded(list(state.FONT.glyphs())):
        state.FONT.generate(path, flags=("opentype", "omit-instructions"))
    return {"path": path}


def op_close():
    # fontforge.open() hands back the *same* font object for a file that is
    # already open, so several fids can share one font. Close it only when
    # the last of them goes, or the others are left holding a dead font.
    state.FONTS.pop(state.FID)  # this handle; others sharing the font keep it
    if not any(v[0] is state.FONT for v in state.FONTS.values()):
        _drop_checkpoints(state.FONT)
        state.FONT.close()
    return {"closed": True}


# ---------------------------------------------------------------- font-wide undo
# FontForge's undo is per glyph. Changes that reach across the font and have no undo of their own (a plugin, a
# script, a rename, new feature code) get a checkpoint instead: the whole font saved to a temporary .sfd just
# before, and undoing reopens that copy in place of the font.
# Known limit: a whole-font save per step (about 0.3 s at 5000 glyphs) and the glyphs' own undo history does not
# survive the undo; a journal of inverse operations per op if that ever hurts.

FONT_WIDE = {"run_plugin": "the plugin run", "run_script": "the script run", "rename_glyph": "the rename",
             "standard_names": "the standard names", "set_features": "the feature change", "edit_group": "the kerning group change",
             "import_artboards": "the artboard import", "create_many": "the added glyphs", "make_glyphs": "the new glyphs", "place_by_anchors": "the accent placement",
             "repair_stray": "the repair", "apply_metrics_keys": "the spacing update", "fix_problem": "the fix",
             "set_font_info": "the font info change", "auto_hint": "the hinting change"}


CHECKPOINTS = {}  # id(font) -> [{"file", "label"}], newest last


KEEP_CHECKPOINTS = 10


_undo_dir = None


def _checkpoint(op):
    """Keep the font as it is now, so `op` can be taken back. Only .sfd projects: saving anything else as .sfd is
    not always safe (a font opened from a UFO carries data FontForge cannot write)."""
    global _undo_dir
    if not state.PATH or not state.PATH.lower().endswith(".sfd") or state.FID in SVGDOCS:
        return
    if _undo_dir is None:
        _undo_dir = tempfile.mkdtemp(prefix="scrifts-undo-")
    stack = CHECKPOINTS.setdefault(id(state.FONT), [])
    file = os.path.join(_undo_dir, f"{id(state.FONT)}-{len(stack)}-{os.urandom(3).hex()}.sfd")
    was = state.FONT.changed
    state.FONT.save(file)
    state.FONT.changed = was  # a checkpoint is not a save: what was unsaved still is
    stack.append({"file": file, "label": FONT_WIDE[op]})
    for old in stack[:-KEEP_CHECKPOINTS]:
        _remove(old["file"])
    del stack[:-KEEP_CHECKPOINTS]


def _remove(file):
    try:
        os.remove(file)
    except OSError:
        pass


def _drop_checkpoints(font):
    for c in CHECKPOINTS.pop(id(font), []):
        _remove(c["file"])


def op_undo_font():
    """Take back the last font-wide change: the font becomes the checkpoint made just before it. Every handle on
    the font follows. It counts as unsaved, so autosave writes it to the project's own file."""
    stack = CHECKPOINTS.get(id(state.FONT), [])
    if not stack:
        raise ValueError("Nothing to undo: no plugin, script, rename or other font-wide change was made since this font was opened")
    c = stack.pop()
    # under another name: saving the checkpoint made that file "the open font" to FontForge, which would hand back
    # the font we are replacing instead of reading the file
    os.replace(c["file"], c["file"] + ".undo.sfd")
    c["file"] += ".undo.sfd"
    old, new = state.FONT, fontforge.open(c["file"], ("hidewindow", "alltables"))
    for fid, (f, p) in list(state.FONTS.items()):
        if f is old:
            state.FONTS[fid] = (new, p)
    CHECKPOINTS.pop(id(old), None)
    CHECKPOINTS[id(new)] = stack
    _DEPS.pop(id(old), None)
    old.close()
    _remove(c["file"])
    state.FONT = new
    new.changed = True
    return {"undone": c["label"], "left": len(stack), **op_info()}


def op_can_undo_font():
    stack = CHECKPOINTS.get(id(state.FONT), [])
    return {"label": stack[-1]["label"] if stack else None}


def op_info():
    f = state.FONT
    return {
        "path": state.PATH,
        "fontname": f.fontname,
        "familyname": f.familyname,
        "em": f.em,
        "ascent": f.ascent,
        "descent": f.descent,
        "xheight": f.xHeight,
        "capheight": f.capHeight,
        "quadratic": bool(f.is_quadratic),
        "glyphs": [_glyph_summary(g) for g in f.glyphs("encoding")],
    }


def op_outlines(names):
    return [_outline(state.FONT[n]) for n in names if n in state.FONT]


def op_points(name):
    """On/off-curve points of the foreground layer, as FontForge stores them."""
    g = state.FONT[name]
    # [x, y, on-curve, type]; type: 0 corner, 1 curve (smooth), 2 hvcurve, 3 tangent.
    # FontForge derives the type from the handles when a layer is assigned,
    # so it is read-only here: a smooth point is one whose handles line up.
    contours = [[[p.x, p.y, 1 if p.on_curve else 0, p.type] for p in c]
                for c in g.foreground]
    out = _outline(g)
    out["contours"] = contours
    out["shapes"] = [{"closed": bool(c.closed), "cw": bool(c.isClockwise()) if c.closed else None,
                      "name": c.name or ""} for c in g.foreground]
    out["ref_xf"] = [list(r[1]) for r in g.references]
    out["anchors"] = [{"cls": a[0], "type": a[1], "x": a[2], "y": a[3]} for a in g.anchorPoints]
    out["refs_list"] = [r[0] for r in g.references]
    bg = SvgPen(state.FONT)
    g.background.draw(bg)
    out["background"] = bg.path()["d"]
    return out


_DEPS = {}  # id(font) -> {glyph: [glyphs whose keys follow it]}
