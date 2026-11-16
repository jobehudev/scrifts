"""Guides, accented letters (composites) and anchors.

Part of the FontForge worker (worker.py): runs under FontForge's own Python, stdlib and fontforge only."""

import unicodedata

import fontforge

import w_state as state
from w_font import op_points


# ------------------------------------------------------------------ guides

def _is_hline(c):
    return len(c) == 2 and c[0].y == c[1].y


def op_guides():
    """Horizontal guides from the font's guide layer (saved in .sfd)."""
    return sorted({c[0].y for c in state.FONT.guide if _is_hline(c)})


def _is_vline(c):
    return len(c) == 2 and c[0].x == c[1].x and c[0].y != c[1].y


def op_vguides():
    """Vertical guides from the font's guide layer (saved in .sfd): lines at a fixed x, the same for every glyph."""
    return sorted({c[0].x for c in state.FONT.guide if _is_vline(c)})


def op_set_vguides(xs):
    """Replace the vertical guides; the horizontal ones and any other guide shapes are kept."""
    old = state.FONT.guide
    layer = fontforge.layer()
    layer.is_quadratic = old.is_quadratic
    for c in old:
        if not _is_vline(c):
            layer += c
    for x in sorted(set(xs)):
        c = fontforge.contour()
        c.is_quadratic = old.is_quadratic
        c.moveTo(x, -state.FONT.em * 2)
        c.lineTo(x, state.FONT.em * 3)
        layer += c
    state.FONT.guide = layer
    return op_vguides()


def op_set_guides(ys):
    """Replace the horizontal guides; any other guide shapes are kept."""
    old = state.FONT.guide
    layer = fontforge.layer()
    layer.is_quadratic = old.is_quadratic
    for c in old:
        if not _is_hline(c):
            layer += c
    for y in sorted(set(ys)):
        c = fontforge.contour()
        c.is_quadratic = old.is_quadratic
        c.moveTo(-state.FONT.em, y)
        c.lineTo(state.FONT.em * 4, y)
        layer += c
    state.FONT.guide = layer
    return op_guides()


# --------------------------------------------------------------- composites

# Spacing accents Unicode gives no decomposition, so the mark they stand for
# can't be derived (´ U+00B4 decomposes to U+0301; ^ and ˆ decompose to nothing).
SPACING_MARK = {
    0x005E: 0x0302, 0x02C6: 0x0302,  # ^ ˆ circumflex
    0x0060: 0x0300, 0x02CB: 0x0300,  # ` ˋ grave
    0x007E: 0x0303,                  # ~ tilde
    0x02C7: 0x030C,                  # ˇ caron
    0x02C9: 0x0304,                  # ˉ macron
    0x02CA: 0x0301,                  # ˊ acute
    0x02CD: 0x0331,                  # ˍ macron below
}


# Unencoded or variant accent glyphs (e.g. a cap-height "Acute", "acutecomb.case").
NAMED_MARK = {
    "grave": 0x0300, "acute": 0x0301, "circumflex": 0x0302, "tilde": 0x0303, "macron": 0x0304,
    "breve": 0x0306, "dotaccent": 0x0307, "dieresis": 0x0308, "ring": 0x030A,
    "hungarumlaut": 0x030B, "caron": 0x030C, "commaaccent": 0x0326, "cedilla": 0x0327, "ogonek": 0x0328,
}


def _marks_of(accent):
    """Combining marks an accent glyph stands for: its own code point if it is
    a mark, the mark in its compatibility decomposition (U+00B4 acute ->
    U+0301), and the marks used by composites that already reference it."""
    marks = set()
    cp = accent.unicode
    if cp >= 0:
        d = unicodedata.decomposition(chr(cp)).split()
        # a two-accent glyph (dieresistonos = ¨ + ´): it is no single mark, and must not pose as the acute and collect every Á
        if len(d) == 2 and not d[0].startswith("<") and not unicodedata.combining(chr(int(d[0], 16))) and not unicodedata.category(chr(int(d[0], 16))).startswith("L"):
            return marks
    if cp in SPACING_MARK:
        marks.add(SPACING_MARK[cp])
    base_name = accent.glyphname.split(".")[0].lower().removesuffix("comb").removesuffix("cmb")
    if base_name in NAMED_MARK:
        marks.add(NAMED_MARK[base_name])
    if cp >= 0:
        if unicodedata.combining(chr(cp)):
            marks.add(cp)
        for x in unicodedata.decomposition(chr(cp)).split():
            if not x.startswith("<") and unicodedata.combining(chr(int(x, 16))):
                marks.add(int(x, 16))
    for g in state.FONT.glyphs():
        if marks:  # only a glyph whose mark is unknown (a custom accent) learns it from its users; a stray reference must not pull in every other accent's letters
            break
        if g.unicode >= 0 and any(r[0] == accent.glyphname for r in g.references):
            d = unicodedata.decomposition(chr(g.unicode)).split()
            if len(d) == 2 and not d[0].startswith("<"):
                marks.add(int(d[1], 16))
    return marks


_DECOMP = None


def _decompositions():
    """cp -> (base cp, mark cp) for every canonical two-part decomposition."""
    global _DECOMP
    if _DECOMP is None:
        _DECOMP = {}
        for cp in range(0x20, 0x30000):
            d = unicodedata.decomposition(chr(cp)).split()
            if len(d) == 2 and not d[0].startswith("<"):
                _DECOMP[cp] = (int(d[0], 16), int(d[1], 16))
    return _DECOMP


def _multi_accent(cp):
    """True for a glyph that is two accents in one (dieresistonos = ¨ + ´)."""
    d = unicodedata.decomposition(chr(cp)).split() if cp >= 0 else []
    if len(d) != 2 or d[0].startswith("<"):
        return False
    first = chr(int(d[0], 16))
    return not unicodedata.combining(first) and not unicodedata.category(first).startswith("L")


def _wrong_accent_letters():
    """Letters that reference a two-accent glyph their own decomposition does not call for (an old bug built it onto every Á)."""
    bad = {g.glyphname: g.unicode for g in state.FONT.glyphs() if _multi_accent(g.unicode)}
    out = []
    for g in state.FONT.glyphs():
        if g.unicode >= 0 and any(r[0] in bad and bad[r[0]] != g.unicode for r in g.references):
            out.append(g.glyphname)
    return out


def op_repair_stray():
    """Rebuild those letters from their Unicode decomposition."""
    fixed = _wrong_accent_letters()
    for n in fixed:
        g = state.FONT[n]
        g.preserveLayerAsUndo(1)
        g.references = ()
        g.build()
    return {"fixed": fixed}


def op_composites(accent):
    """Every character built from this accent: existing glyphs that use it,
    plus Unicode characters whose decomposition is base + one of its marks."""
    marks = _marks_of(state.FONT[accent])
    by_cp = {g.unicode: g for g in state.FONT.glyphs() if g.unicode >= 0}
    items = {cp: base for cp, (base, mark) in _decompositions().items() if mark in marks}
    # i and j lose their dot under an accent: build í on dotless ı (U+0131) and ĵ on ȷ (U+0237) when the font has them
    for cp, b in items.items():
        if b == 0x69 and 0x131 in by_cp:
            items[cp] = 0x131
        elif b == 0x6A and 0x237 in by_cp:
            items[cp] = 0x237
    for g in state.FONT.glyphs():  # composites using the accent, even unencoded ones
        if any(r[0] == accent for r in g.references) and g.unicode not in items:
            items[g.unicode if g.unicode >= 0 else g.glyphname] = None
    out = []
    for k, base_cp in items.items():
        g = by_cp.get(k) if isinstance(k, int) else state.FONT[k]
        ref = next((r for r in g.references if r[0] == accent), None) if g else None
        out.append({
            "unicode": k if isinstance(k, int) else -1,
            "name": g.glyphname if g else None,
            "base": by_cp[base_cp].glyphname if base_cp in by_cp else None,
            "base_unicode": base_cp if base_cp is not None else -1,
            "uses_accent": ref is not None,
            "offset": [ref[1][4], ref[1][5]] if ref else None,
            "refs": [r[0] for r in g.references] if g else [],
            "has_outline": bool(g and len(g.foreground)),
            "anchor_offset": list(_anchor_offset(by_cp[base_cp].glyphname, accent)[:2])
            if base_cp in by_cp and _anchor_offset(by_cp[base_cp].glyphname, accent) else None,
        })
    out.sort(key=lambda i: (i["unicode"] < 0, i["unicode"]))
    return {"accent": accent, "marks": sorted(marks), "items": out, "stray": _wrong_accent_letters()}


# ------------------------------------------------------------------ anchors

MARK_LOOKUP = "Scrifts mark positioning"


def op_anchor_classes():
    """Anchor classes of every mark-to-base / mark-to-mark lookup."""
    out = []
    for lk in state.FONT.gpos_lookups:
        kind = state.FONT.getLookupInfo(lk)[0]
        if kind in ("gpos_mark2base", "gpos_mark2mark", "gpos_mark2ligature"):
            for st in state.FONT.getLookupSubtables(lk):
                out += [{"name": c, "kind": kind[5:], "subtable": st} for c in state.FONT.getLookupSubtableAnchorClasses(st)]
    return out


def op_add_anchor_class(name):
    """New anchor class in the font's mark-to-base lookup, creating that
    lookup (feature 'mark', DFLT + latn) when the font has none."""
    if any(c["name"] == name for c in op_anchor_classes()):
        return op_anchor_classes()
    lookup = next((lk for lk in state.FONT.gpos_lookups if state.FONT.getLookupInfo(lk)[0] == "gpos_mark2base"), None)
    if lookup is None:
        lookup = MARK_LOOKUP
        state.FONT.addLookup(lookup, "gpos_mark2base", (), (("mark", (("DFLT", ("dflt",)), ("latn", ("dflt",)))),))
        state.FONT.addLookupSubtable(lookup, lookup + " subtable")
    state.FONT.addAnchorClass(state.FONT.getLookupSubtables(lookup)[0], name)
    return op_anchor_classes()


def op_set_anchor(name, cls, type, x, y):
    """Add or move an anchor (FontForge replaces one of the same class and type). Every letter built
    from this glyph follows at once: the anchors are a link, not a one-off placement."""
    state.FONT[name].addAnchorPoint(cls, type, float(x), float(y))
    _follow_anchors(name)
    return op_points(name)


def op_delete_anchor(name, cls, type):
    g = state.FONT[name]
    g.anchorPoints = tuple(a for a in g.anchorPoints if not (a[0] == cls and a[1] == type))
    return op_points(name)


def _follow_anchors(part):
    """Re-place, by anchors, the accent in every composite that has `part` as its base or as its accent.
    Composites whose parts share no anchor keep the placement they have."""
    moved = []
    for g in state.FONT.glyphs():
        refs = list(g.references)
        if len(refs) < 2 or not any(r[0] == part for r in refs):
            continue
        # the base is the part that sits unmoved at the origin (FontForge may list the accent first)
        b = next((r for r in refs if not r[1][4] and not r[1][5]), refs[0])
        new = []
        for r in refs:
            off = _anchor_offset(b[0], r[0]) if r is not b else None
            new.append((r[0], tuple(r[1][:4]) + (off[0], off[1])) + tuple(r[2:]) if off else r)
        if new != refs:
            g.references = tuple(new)
            moved.append(g.glyphname)
    return moved


def _anchor_offset(base, accent):
    """Offset that puts the accent's mark anchor on the base's base anchor,
    for the first class both have; None if they share none."""
    # an explicit "_top"-style anchor (Glyphs' spelling: this point sits on the letter's top) wins over a mark anchor of the
    # same class, then come mark anchors, then a plain "top" on the accent
    marks = {}
    for a in state.FONT[accent].anchorPoints:
        if a[1] == "base" and a[0].startswith("_"):
            marks.setdefault(a[0][1:], a)
    for a in state.FONT[accent].anchorPoints:
        if a[1] == "mark":
            marks.setdefault(a[0], a)
    for a in state.FONT[accent].anchorPoints:
        if a[1] == "base" and not a[0].startswith("_"):
            marks.setdefault(a[0], a)
    for a in state.FONT[base].anchorPoints:
        if a[1] == "base" and a[0] in marks:
            m = marks[a[0]]
            return a[2] - m[2], a[3] - m[3], a[0]
    return None


def _link_anchors(base, accent, dx, dy):
    """The accent was put at (dx, dy) on `base`, by dragging or by centring. Make that a link: the accent gets a mark
    anchor where it touches its letter (unless it has one, "_bottom" first), and the letter's base anchor of that
    class moves to where the accent now sits, so every other letter on this base follows."""
    mark = next((a for a in state.FONT[accent].anchorPoints if a[1] == "base" and a[0].startswith("_")), None) \
        or next((a for a in state.FONT[accent].anchorPoints if a[1] == "mark"), None)
    if mark:
        cls, mx, my = mark[0].lstrip("_"), mark[2], mark[3]
    else:
        below = state.FONT[accent].glyphname.lower().startswith(("cedilla", "ogonek", "dotbelow", "commaaccent"))
        cls = "bottom" if below else "top"
        b = state.FONT[accent].boundingBox()
        mx, my = (b[0] + b[2]) / 2, (b[3] if below else b[1])  # the accent touches its letter on the side facing it
    if not any(c["name"] == cls for c in op_anchor_classes()):
        op_add_anchor_class(cls)
    if not mark:
        state.FONT[accent].addAnchorPoint(cls, "mark", float(mx), float(my))
    state.FONT[base].addAnchorPoint(cls, "base", float(mx + dx), float(my + dy))
    return cls


def op_place_by_anchors(accent):
    """Re-place the accent in every composite that uses it, by anchors.
    Composites whose base has no matching anchor are left alone."""
    placed, skipped = [], []
    for g in state.FONT.glyphs():
        refs = list(g.references)
        if not any(r[0] == accent for r in refs):
            continue
        base = next((r[0] for r in refs if r[0] != accent), None)
        off = _anchor_offset(base, accent) if base else None
        if off is None:
            skipped.append(g.glyphname)
            continue
        g.preserveLayerAsUndo(1)
        g.references = tuple(
            (r[0], tuple(r[1][:4]) + (off[0], off[1])) + tuple(r[2:]) if r[0] == accent else r for r in refs)
        placed.append(g.glyphname)
    return {"placed": placed, "skipped": skipped}
