"""Saving, validation, generating fonts, hinting, whole-glyph data, masters, the sample font.

Part of the FontForge worker (worker.py): runs under FontForge's own Python, stdlib and fontforge only."""

import os
import tempfile

import fontforge

import w_state as state
from w_font import _apply_linking, _expanded, _save_svg, op_font_info
from w_edit import _contour, op_edit
from w_spacing import _save_sfd


def op_autosave():
    """Save the font in place if it has unsaved changes and is an .sfd project (FontForge's own
    format, which a save never degrades). Other formats are only reported as changed: writing a
    binary font back would be a re-export, not a save."""
    changed = bool(state.FONT.changed)
    if changed and state.PATH and state.PATH.lower().endswith(".sfd"):
        _save_sfd(state.PATH)
        return {"saved": True, "changed": False, "path": state.PATH}
    return {"saved": False, "changed": changed, "path": state.PATH}


def op_strip_persistent():
    """Prepare a font opened from a UFO for saving as .sfd: drop the UFO lib data FontForge keeps as Python
    objects (saving it tries to pickle them, which crashes FontForge's embedded interpreter) and any extra layers."""
    n = 0
    if state.FONT.persistent is not None:
        state.FONT.persistent = None
        n += 1
    for g in state.FONT.glyphs():
        if g.persistent is not None:
            g.persistent = None
            n += 1
    # extra layers (Glyphs' smart-component extremes, brace layers) crash the save the same way
    dropped = [name for name in list(state.FONT.layers) if name not in ("public.default", "public.background", "Fore", "Back")]
    for name in dropped:
        del state.FONT.layers[name]
    return {"cleared": n, "layers_dropped": dropped}


def op_save(path=None):
    """Save to `path` (default: the opened path). Format follows the extension."""
    path = path or state.PATH
    ext = os.path.splitext(path)[1].lower()
    if ext == ".svg":
        _save_svg(path)
        try:
            state.FONT.changed = False
        except Exception:  # noqa: BLE001
            pass
    elif ext == ".sfd":
        _save_sfd(path)
    elif ext in (".ttf", ".otf", ".ufo", ".ufo3", ".ufo2"):
        with _expanded(list(state.FONT.glyphs())):
            state.FONT.generate(path, flags=("opentype",))
    else:
        raise ValueError(f"unsupported save format: {ext}")
    return {"path": path}


# FontForge's per-glyph validation bits (splinefont.h, enum validation_state):
# bit -> (label, level, edit kind that fixes it in place, if any)
VALIDATION = {
    0x2: ("Open contour", "error", None),
    0x4: ("Self-intersecting", "warning", "remove_overlap"),
    0x8: ("Wrong direction", "error", "correct_direction"),
    0x10: ("Flipped reference", "error", None),
    0x20: ("Missing points at extrema", "warning", "add_extrema"),
    0x40: ("Unknown glyph in a substitution or positioning lookup", "error", None),
    0x80: ("Too many points", "warning", None),
    0x100: ("Too many hints", "warning", None),
    0x200: ("Bad glyph name", "error", None),
    0x400: ("More points than maxp allows", "warning", None),
    0x800: ("More contours than maxp allows", "warning", None),
    0x1000: ("More component points than maxp allows", "warning", None),
    0x2000: ("More component contours than maxp allows", "warning", None),
    0x4000: ("Instructions longer than maxp allows", "warning", None),
    0x8000: ("More references than maxp allows", "warning", None),
    0x10000: ("References nested deeper than maxp allows", "warning", None),
    0x40000: ("Points too far apart", "error", None),
    0x80000: ("Non-integral coordinates", "warning", "round"),
    0x100000: ("Missing anchor", "warning", None),
    0x200000: ("Duplicate glyph name", "error", None),
    0x400000: ("Duplicate Unicode", "error", None),
    0x800000: ("Overlapping hints", "warning", None),
}


def op_validate():
    """FontForge's Find Problems / Validate: per problem, the glyphs that have it."""
    state.FONT.validate(True)
    found = {}
    for g in state.FONT.glyphs():
        v = g.validate(False)
        for bit in VALIDATION:
            if v & bit:
                found.setdefault(bit, []).append(g.glyphname)
    return [{"bit": bit, "label": VALIDATION[bit][0], "level": VALIDATION[bit][1],
             "fix": VALIDATION[bit][2], "glyphs": names} for bit, names in found.items()]


def op_fix_problem(bit):
    """Apply the in-place fix for one validation problem to every glyph that
    has it (each glyph keeps its own undo), then validate again."""
    fix = VALIDATION[bit][2]
    if not fix:
        raise ValueError(f"no automatic fix for: {VALIDATION[bit][0]}")
    for p in op_validate():
        if p["bit"] == bit:
            for name in p["glyphs"]:
                op_edit(name, fix)
    return op_validate()


def _plain(v):
    """A value from FontForge's private dictionary as JSON can carry it."""
    return [_plain(x) for x in v] if isinstance(v, (tuple, list)) else v


def op_hints(name=None):
    """What hinting the font holds, so "keep the font's own hints" is not a guess: how many outlined glyphs have
    PostScript stem hints and how many have TrueType instructions, the alignment zones, and one glyph's stems."""
    outlined = hinted = instructed = 0
    for g in state.FONT.glyphs():
        if not len(g.foreground):
            continue
        outlined += 1
        hinted += bool(g.hhints or g.vhints)
        instructed += bool(g.ttinstrs)
    zones = {}
    for k in ("BlueValues", "OtherBlues", "StdHW", "StdVW"):
        try:
            zones[k] = _plain(state.FONT.private[k])
        except Exception:  # noqa: BLE001 -- not set
            pass
    out = {"outlined": outlined, "hinted": hinted, "instructed": instructed, "quadratic": bool(state.FONT.is_quadratic), "zones": zones}
    if name and name in state.FONT:
        g = state.FONT[name]
        out["glyph"] = {"h": _plain(g.hhints), "v": _plain(g.vhints), "instructions": len(g.ttinstrs or b"")}
    return out


def op_auto_hint(names=None, clear=False):
    """FontForge's autohinter on these glyphs (default: every outlined glyph), TrueType instructions too when the
    outlines are quadratic. `clear` removes hints and instructions instead."""
    glyphs = [state.FONT[n] for n in names if n in state.FONT] if names else [g for g in state.FONT.glyphs() if len(g.foreground)]
    for g in glyphs:
        if clear:
            g.hhints, g.vhints = (), ()
            if g.ttinstrs:
                g.ttinstrs = b""
        else:
            g.autoHint()
            if state.FONT.is_quadratic:
                g.autoInstr()
    return {"glyphs": len(glyphs), **op_hints(names[0] if names else None)}


def op_generate(path, hinting="keep"):
    """Generate one font file; the extension picks the format. hinting: keep
    (the font's own hints/instructions), none (no TrueType instructions), or auto (FontForge autohints;
    TrueType instructions too when the outlines are quadratic)."""
    ext = os.path.splitext(path)[1].lower()
    if ext not in (".otf", ".ttf", ".woff", ".woff2"):
        raise ValueError(f"unsupported format: {ext}")
    truetype = ext == ".ttf" or (ext != ".otf" and state.FONT.is_quadratic)
    flags = ["opentype"]
    instructed = False
    if hinting == "none" and truetype:
        # Never "no-hints": FontForge then writes no glyf (or CFF) table at
        # all. So "none" strips TrueType instructions; CFF keeps its hints.
        flags.append("omit-instructions")
    was = state.FONT.changed
    with _expanded(list(state.FONT.glyphs())):  # strokes become outlines for the file, and are skeletons again after
        if hinting == "auto":
            state.FONT.selection.all()
            state.FONT.autoHint()
            if truetype and state.FONT.is_quadratic:
                state.FONT.autoInstr()
                instructed = True
        state.FONT.generate(path, flags=tuple(flags))
    try:
        state.FONT.changed = was  # writing a font file is not an edit: autosave must not save the project because of it
    except Exception:  # noqa: BLE001
        pass
    return {"path": path, "size": os.path.getsize(path), "truetype": truetype, "instructed": instructed}


def op_structure():
    """What interpolation needs to match between masters, per glyph: each
    contour's on/off-curve pattern, closedness and direction; component
    names; anchor names. Read only; no geometry is compared here."""
    out = {}
    for g in state.FONT.glyphs():
        contours = []
        for c in g.foreground:
            try:
                cw = bool(c.isClockwise()) if c.closed and len(c) > 2 else None
            except Exception:  # noqa: BLE001 -- degenerate contour: no direction
                cw = None
            contours.append(["".join("1" if p.on_curve else "0" for p in c), bool(c.closed), cw])
        # component order is FontForge's bookkeeping, not design: compare sorted
        out[g.glyphname] = {"contours": contours, "refs": sorted(r[0] for r in g.references),
                            "anchors": sorted(a[0] for a in g.anchorPoints)}
    return out


def op_point_data(names=None):
    """Raw numbers for blending masters, for many glyphs in one call: width,
    on/off-curve points, open/closed, component transforms, anchors."""
    glyphs = [state.FONT[n] for n in names if n in state.FONT] if names is not None else list(state.FONT.glyphs())
    return {g.glyphname: _glyph_data(g) for g in glyphs}


def _glyph_data(g):
    return {
        "width": g.width,
        "contours": [[[p.x, p.y, 1 if p.on_curve else 0] for p in c] for c in g.foreground],
        "closed": [bool(c.closed) for c in g.foreground],
        # sorted, so masters that store the same components in another order still blend
        "refs": sorted([r[0], list(r[1])] for r in g.references),
        "anchors": [list(a) for a in g.anchorPoints],
    }


def op_restore_glyphs(names):
    """Put glyphs back as they are in the saved file: outlines, components,
    anchors, width. The saved file is read from a temporary copy, because
    opening the same path again would just return this (edited) font.
    Each glyph keeps its undo, so a restore can itself be undone. A glyph
    the saved file doesn't have is emptied."""
    import shutil
    import tempfile
    if not state.PATH or not os.path.exists(state.PATH):
        raise ValueError("this font hasn't been saved yet, so there is nothing to restore from")
    tmp = tempfile.mkdtemp(prefix="scrifts-restore-")
    try:
        copy = os.path.join(tmp, os.path.basename(os.path.normpath(state.PATH)))
        (shutil.copytree if os.path.isdir(state.PATH) else shutil.copyfile)(state.PATH, copy)  # a .ufo is a folder
        saved = fontforge.open(copy, ("hidewindow", "alltables"))
        try:
            data = {n: _glyph_data(saved[n]) if n in saved else
                    {"width": state.FONT[n].width, "contours": [], "closed": [], "refs": [], "anchors": []}
                    for n in names if n in state.FONT}
        finally:
            saved.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    op_set_point_data(data)
    return {"restored": sorted(data)}


def op_set_point_data(glyphs):
    """Write glyphs in the op_point_data format (e.g. blended ones) into this font."""
    for name, d in glyphs.items():
        g = state.FONT[name] if name in state.FONT else state.FONT.createChar(-1, name)
        g.preserveLayerAsUndo(1)  # outline edits by copy stay undoable in the glyph view
        layer = fontforge.layer()
        if state.FONT.is_quadratic:
            layer.is_quadratic = True
        for pts, closed in zip(d["contours"], d["closed"]):
            layer += _contour(pts, closed, state.FONT.is_quadratic)
        g.foreground = layer
        g.references = tuple((r, tuple(xf)) for r, xf in d["refs"])
        g.anchorPoints = tuple(tuple(a) for a in d["anchors"])
        g.width = int(round(d["width"]))
    return {"written": len(glyphs)}


def op_normalise_components():
    """Re-assign every composite's components, which puts them in FontForge's
    own order. Masters saved at different times can list the same components
    in different orders; compiled, that order becomes the contour order, so
    it must agree before masters are merged into a variable font. In memory
    only; the glyphs look exactly the same."""
    n = 0
    for g in state.FONT.glyphs():
        refs = g.references
        if len(refs) > 1:
            g.references = refs
            n += 1
    return {"glyphs": n}


def op_duplicate_master(path, style, weight):
    """A new master for a family: this master saved, its file copied to
    `path`, and the copy renamed. Masters stay point-compatible as long as
    the copy is only reshaped (moved points), never restructured."""
    import shutil
    if not state.PATH.lower().endswith(".sfd"):
        raise ValueError("masters are .sfd files: save this font as .sfd first")
    if os.path.exists(path):
        raise ValueError(f"{os.path.basename(path)} already exists in this folder, so nothing was changed. "
                         "Use another style name, or move or rename that file first (it may be a master you made earlier).")
    _save_sfd(state.PATH)
    shutil.copyfile(state.PATH, path)
    f = fontforge.open(path, ("hidewindow", "alltables"))
    try:
        f.fontname = (f.familyname + "-" + style).replace(" ", "")
        f.fullname = f"{f.familyname} {style}"
        f.weight = style
        f.os2_weight = int(weight)
        _apply_linking(f, style, weight)
        f.save(path)
    finally:
        f.close()
    return {"path": path}


def op_set_master_style(style, weight):
    """Rename the open master's style: its font name, full name, weight and the linked style names."""
    f = state.FONT
    f.fontname = (f.familyname + "-" + style).replace(" ", "")
    f.fullname = f"{f.familyname} {style}"
    f.weight = style
    f.os2_weight = int(weight)
    _apply_linking(f, style, weight)
    return op_font_info()


def op_link_style(style, weight):
    """Give the open font the style bits and names its style and weight call for."""
    _apply_linking(state.FONT, style, weight)
    return op_font_info()


def op_make_sample(path):
    """A small, plain font to try Scrifts on: HELOITF drawn from bars and a ring, spaced and named properly.
    Never overwrites: if the file is there (and perhaps edited), it is left alone."""
    if os.path.exists(path):
        return {"path": path, "created": False}
    f = fontforge.font()
    f.encoding = "UnicodeBmp"
    f.em = 1000
    f.familyname, f.fontname, f.fullname, f.weight = "Scrifts Sample", "ScriftsSample-Regular", "Scrifts Sample Regular", "Regular"
    cap, stem = 700, 84
    K = 0.5522847498

    def bar(g, x, y, w, h):
        p = g.glyphPen(replace=False)  # add to the glyph; the default would clear what is there
        p.moveTo((x, y)); p.lineTo((x, y + h)); p.lineTo((x + w, y + h)); p.lineTo((x + w, y)); p.closePath()

    def oval(g, cx, cy, rx, ry):
        p = g.glyphPen(replace=False)  # add to the glyph; the default would clear what is there
        p.moveTo((cx, cy + ry))
        p.curveTo((cx + K * rx, cy + ry), (cx + rx, cy + K * ry), (cx + rx, cy))
        p.curveTo((cx + rx, cy - K * ry), (cx + K * rx, cy - ry), (cx, cy - ry))
        p.curveTo((cx - K * rx, cy - ry), (cx - rx, cy - K * ry), (cx - rx, cy))
        p.curveTo((cx - rx, cy + K * ry), (cx - K * rx, cy + ry), (cx, cy + ry))
        p.closePath()

    shapes = {
        "I": (220, lambda g: bar(g, 68, 0, stem, cap)),
        "H": (560, lambda g: (bar(g, 68, 0, stem, cap), bar(g, 408, 0, stem, cap), bar(g, 68, cap / 2 - stem / 2, 420, stem))),
        "E": (480, lambda g: (bar(g, 68, 0, stem, cap), bar(g, 68, 0, 360, stem), bar(g, 68, cap / 2 - stem / 2, 300, stem), bar(g, 68, cap - stem, 360, stem))),
        "F": (450, lambda g: (bar(g, 68, 0, stem, cap), bar(g, 68, cap / 2 - stem / 2, 290, stem), bar(g, 68, cap - stem, 340, stem))),
        "L": (430, lambda g: (bar(g, 68, 0, stem, cap), bar(g, 68, 0, 330, stem))),
        "T": (500, lambda g: (bar(g, 40, cap - stem, 420, stem), bar(g, 250 - stem / 2, 0, stem, cap))),
        "O": (640, lambda g: (oval(g, 320, cap / 2, 270, cap / 2), oval(g, 320, cap / 2, 270 - stem, cap / 2 - stem))),
    }
    f.createChar(32, "space").width = 250
    for ch, (width, draw) in shapes.items():
        g = f.createChar(ord(ch))
        draw(g)
        g.width = width
        g.correctDirection()  # the ring's inner oval becomes a hole
    f.createChar(-1, ".notdef").width = 500
    os.makedirs(os.path.dirname(path), exist_ok=True)
    f.save(path)
    f.close()
    return {"path": path, "created": True}


def op_open_paths():
    """The files that are open right now (any handle), normalised."""
    return sorted({os.path.normcase(os.path.abspath(p)) for _, p in state.FONTS.values()})


def op_ping():
    return {"fontforge": fontforge.version()}
