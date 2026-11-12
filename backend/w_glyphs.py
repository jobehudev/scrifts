"""Glyph-level odds and ends: placing components, renaming, composing, building, smart components.

Part of the FontForge worker (worker.py): runs under FontForge's own Python, stdlib and fontforge only."""

import re

import fontforge
import psMat

import w_state as state
from smart_components import max_name, read_smart, write_smart
from w_font import op_points
from w_edit import _char, _contour, _without
from w_marks import _anchor_offset, _follow_anchors, _link_anchors


def op_place(name, ref, dx, dy):
    """Move one reference inside a composite (e.g. the accent over its base)."""
    g = state.FONT[name]
    g.preserveLayerAsUndo(1)
    g.references = tuple(
        (r[0], tuple(r[1][:4]) + (float(dx), float(dy))) + tuple(r[2:]) if r[0] == ref else r
        for r in g.references)
    base = next((r[0] for r in g.references if r[0] != ref), None)
    if base and _link_anchors(base, ref, float(dx), float(dy)):
        _follow_anchors(base)
    return op_points(name)


def op_contour_point(name, contour, index, action, x=0, y=0, on=1, count=1, points=None):
    """Delete the point at `index` of a contour, or insert one there (before the point now at that index): the fix
    for two masters whose points do not match. One undo step."""
    g = state.FONT[name]
    layer = g.foreground
    c = layer[contour]
    pts = [[p.x, p.y, 1 if p.on_curve else 0] for p in c]
    if action == "delete":  # `count` points in a row (a cubic curve's two handles must go together)
        if not 0 <= index < len(pts) or index + count > len(pts) or len(pts) - count < 2:
            raise ValueError("no such point, or too few points left")
        del pts[index:index + count]
    elif action == "insert":  # one point, or a run of `points` [[x, y, on], ...]
        new = points if points else [[x, y, on]]
        i = max(0, min(index, len(pts)))
        pts[i:i] = [[float(px), float(py), 1 if pon else 0] for px, py, pon in new]
    else:
        raise ValueError("action is delete or insert")
    new = _contour(pts, c.closed, layer.is_quadratic)  # FontForge refuses a cubic curve without exactly two handles: that error is the answer
    new.name = c.name
    g.preserveLayerAsUndo(1)
    layer[contour] = new
    g.foreground = layer
    return op_points(name)


def op_unicode_of(name):
    """Code point FontForge knows for a glyph name (dotlessi -> 0x131), -1 if none."""
    return fontforge.unicodeFromName(name)


def op_standard_names():
    """Rename glyphs FontForge called glyph74 to their standard name (circumflex, ring, dotlessi).
    FontForge updates components and kerning that point at them. Names already taken are left alone."""
    import re
    renamed = []
    for g in list(state.FONT.glyphs()):
        if g.unicode >= 0 and re.fullmatch(r"glyph\d+", g.glyphname):
            new = fontforge.nameFromUnicode(g.unicode)
            if new and new != g.glyphname and new not in state.FONT:
                renamed.append([g.glyphname, new])
                g.glyphname = new
    return {"renamed": renamed}


def op_rename_glyph(old, new):
    """Rename a glyph; FontForge keeps components, kerning and feature lookups pointing at it."""
    new = (new or "").strip()
    if not new or any(c.isspace() for c in new):
        raise ValueError("A glyph name can't be empty or contain spaces")
    if new == old:
        return {"name": old}
    if new in state.FONT:
        raise ValueError(f"There is already a glyph called {new}")
    state.FONT[old].glyphname = new
    return {"name": new}


def op_make_dotless(unicode):
    """Dotless i (U+0131) from i, or dotless j (U+0237) from j: the letter copied without its highest
    shape (the dot), with the same width and anchors, so accents can sit where the dot was."""
    src = {0x131: "i", 0x237: "j"}[int(unicode)]
    if src not in state.FONT or len(state.FONT[src].foreground) < 2:
        raise ValueError(f"'{src}' needs a stem and a dot (two shapes) to take the dot off")
    s = state.FONT[src]
    layer = s.foreground
    dot = max(range(len(layer)), key=lambda i: layer[i].boundingBox()[1])  # the shape that starts highest
    g = _char(int(unicode))
    g.preserveLayerAsUndo(1)
    g.clear()
    g.foreground = _without(layer, [dot])
    g.width = s.width
    for a in s.anchorPoints:
        g.addAnchorPoint(*a[:4])
    return {"name": g.glyphname, **op_points(g.glyphname)}


def op_compose(unicode, base, accent, dx=None, dy=None, name=None):
    """Create or rebuild a composite as references: base + accent. Without an
    offset the accent is centred over the base and lifted clear of it."""
    for part in (base, accent):
        if not len(state.FONT[part].foreground) and not state.FONT[part].references and part != "space":
            # FontForge does not save a completely empty glyph, so a composite
            # pointing at one would silently lose that part on reload.
            raise ValueError(f"'{part}' has no outline yet; draw it first, then build the composite")
    g = _char(unicode, name) if unicode >= 0 else (state.FONT[name] if name in state.FONT else state.FONT.createChar(-1, name))  # unencoded: your own letter + accent, e.g. Adieresistonos
    g.preserveLayerAsUndo(1)
    g.clear()
    g.addReference(base)
    by_anchor = _anchor_offset(base, accent) if dx is None or dy is None else None
    if by_anchor:
        dx, dy = by_anchor[0], by_anchor[1]
    elif dx is None or dy is None:
        b, m = state.FONT[base].boundingBox(), state.FONT[accent].boundingBox()
        dx = (b[0] + b[2]) / 2 - (m[0] + m[2]) / 2
        gap = state.FONT.em * 0.02
        dy = 0 if m[1] >= b[3] + gap else b[3] + gap - m[1]
    g.addReference(accent, psMat.translate(dx, dy))
    g.width = state.FONT[base].width
    if not by_anchor and _link_anchors(base, accent, dx, dy):
        by_anchor = (dx, dy, "new")
        _follow_anchors(base)
    return {"name": g.glyphname, "placed_by": f"anchor {by_anchor[2]}" if by_anchor else "offset or centred",
            **op_points(g.glyphname)}


def op_build(name):
    """FontForge's Build Accented/Composite: references from Unicode decomposition."""
    g = state.FONT[name]
    g.preserveLayerAsUndo(1)
    old_refs, old_fg, old_w = list(g.references), g.foreground.dup(), g.width
    g.references = ()  # rebuild means from the parts alone: a flattened or broken copy must not stay underneath
    g.clear()
    g.build()
    if not g.references and not len(g.foreground):  # FontForge found no parts to build from (a missing acutecomb, say): put it back
        g.foreground = old_fg
        for r in old_refs:
            g.addReference(r[0], r[1])
        g.width = old_w
        raise ValueError("FontForge found no parts to build this from (a base letter or accent is missing). Nothing was changed.")
    return op_points(name)


# ------------------------------------------------------ smart components
#
# A glyph can be generated from parts that slide between two extremes (rules in
# smart_components.py). The placements live on the glyph's comment; the server
# interpolates the parts and writes the outline.



def op_smart(names=None):
    """{glyph: [placements]} for glyphs built from parts, and the glyphs that can be a part
    (a glyph with a `.max` partner)."""
    out = {}
    for g in (state.FONT[n] for n in names) if names else state.FONT.glyphs():
        p = read_smart(g.comment)
        if p:
            out[g.glyphname] = p
    parts = sorted(g.glyphname for g in state.FONT.glyphs() if max_name(g.glyphname) in state.FONT)
    return {"glyphs": out, "parts": parts}


def op_set_smart(name, parts):
    """Store (or clear, with an empty list) a glyph's placements. Every part needs its .max partner."""
    for p in parts:
        if p["part"] not in state.FONT or max_name(p["part"]) not in state.FONT:
            raise ValueError(f"{p['part']} needs a partner glyph called {max_name(p['part'])}")
        if p["part"] == name or max_name(p["part"]) == name:
            raise ValueError("a glyph can't be built from itself")
    g = state.FONT[name]
    g.comment = write_smart(g.comment, parts)
    return {"parts": read_smart(g.comment)}
