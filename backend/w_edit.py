"""Outline edits on a glyph, undo and redo, and making glyphs.

Part of the FontForge worker (worker.py): runs under FontForge's own Python, stdlib and fontforge only."""

import math

import fontforge
import psMat

import w_state as state
from w_font import _expand_layer, _glyph_summary, op_points


def _contour(pts, closed, quadratic):
    """A contour from [x, y, on-curve] points, as they are stored. The curve
    kind is set first: FontForge checks the points against it as they are
    added (a cubic contour wants exactly two off-curve points per curve)."""
    c = fontforge.contour()
    c.is_quadratic = bool(quadratic)
    for x, y, on in pts:
        c += fontforge.point(x, y, bool(on))
    c.closed = bool(closed)
    return c


def _split_nearest(pts, closed, x, y, quadratic):
    """The segment of one contour nearest (x, y): (distance, points with a new on-curve point on it), or None.
    Straight segments and cubic curves (de Casteljau split, so the outline does not change); implied-point
    TrueType curves are skipped."""
    on = [i for i, p in enumerate(pts) if p[2]]
    if len(on) < 2:
        return None
    if not pts[0][2]:  # start at an on-curve point so no segment wraps around the list's end except the closing one
        pts = pts[on[0]:] + pts[:on[0]]
        on = [i for i, p in enumerate(pts) if p[2]]
    lerp = lambda p, q, t: (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)
    best = None
    for k in range(len(on) if closed else len(on) - 1):
        i, j = on[k], on[(k + 1) % len(on)]
        mid = pts[i + 1:j] if j > i else pts[i + 1:] + pts[:j]
        if len(mid) == 0:
            curve = None
        elif len(mid) == 2 and not quadratic:
            curve = (pts[i], mid[0], mid[1], pts[j])
        else:
            continue
        at = (lambda t: lerp(pts[i], pts[j], t)) if curve is None else (lambda t: _bez(curve, t))
        steps = 200
        d, t = min((math.hypot(at(s / steps)[0] - x, at(s / steps)[1] - y), s / steps) for s in range(1, steps))
        if best is None or d < best[0]:
            best = (d, k, i, j, t, curve)
    if best is None:
        return None
    d, k, i, j, t, curve = best
    if curve is None:
        new, drop = [(*lerp(pts[i], pts[j], t), True)], 0
    else:
        p0, p1, p2, p3 = (c[:2] for c in curve)
        q0, q1, q2 = lerp(p0, p1, t), lerp(p1, p2, t), lerp(p2, p3, t)
        r0, r1 = lerp(q0, q1, t), lerp(q1, q2, t)
        s = lerp(r0, r1, t)
        new, drop = [(*q0, False), (*r0, False), (*s, True), (*r1, False), (*q2, False)], 2
    new = [(round(p[0], 2), round(p[1], 2), p[2]) for p in new]
    return d, pts[:i + 1] + new + pts[j if j > i else len(pts):]


def _bez(c, t):
    u = 1 - t
    return tuple(u**3 * c[0][n] + 3 * u * u * t * c[1][n] + 3 * u * t * t * c[2][n] + t**3 * c[3][n] for n in (0, 1))


def _edit(g, f):
    """Apply f to a copy of the foreground layer, with FontForge's own undo."""
    g.preserveLayerAsUndo(1)
    layer = g.foreground
    layer = f(layer) or layer
    g.foreground = layer


def _faces(layer, picked):
    """The atomic regions of the given (closed) shapes: every piece of ink that lies under the same set of
    them, as layers. Shapes that overlap are cut along each other's outlines, like Illustrator's Shape Builder."""
    def new():
        l = fontforge.layer()
        l.is_quadratic = layer.is_quadratic
        return l

    def minus(a, b):  # FontForge's naming: b.exclude(a) leaves a minus b
        a2, b2 = new(), new()
        for c in a:
            a2 += c.dup()
        for c in b:
            b2 += c.dup()
        b2.exclude(a2)
        return b2

    def solid(l):  # no sliver or stray line: what FontForge leaves when edges coincide
        return [c for c in l if c.boundingBox()[2] > c.boundingBox()[0] and c.boundingBox()[3] > c.boundingBox()[1]]

    def both(a, b):
        m = new()
        for c in a:
            m += c.dup()
        for c in b:
            m += c.dup()
        m.intersect()
        if len(m):
            return m
        return minus(a, minus(a, b))  # FontForge's intersect gives nothing when edges coincide

    # a shape is an outline with the counters inside it (a D is its outer and its hole, not two filled shapes)
    def box(i):
        return layer[i].boundingBox()
    def size(i):
        x0, y0, x1, y1 = box(i)
        return (x1 - x0) * (y1 - y0)
    outer_dir = layer[max(picked, key=size)].isClockwise()
    outers = [i for i in picked if layer[i].isClockwise() == outer_dir]
    holes = [i for i in picked if layer[i].isClockwise() != outer_dir]
    parts = {i: [i] for i in outers}
    used = list(outers)
    for h in holes:
        hx0, hy0, hx1, hy1 = box(h)
        home = [o for o in outers if box(o)[0] <= hx0 and box(o)[1] <= hy0 and box(o)[2] >= hx1 and box(o)[3] >= hy1]
        if home:
            parts[min(home, key=size)].append(h)
            used.append(h)

    faces = []
    for o in outers:
        shape = new()
        for i in parts[o]:
            shape += layer[i].dup()  # the set operations work in place: always on copies
        rest, out = shape, []
        for f in faces:
            for part in (both(f, shape), minus(f, shape)):
                if len(solid(part)) == len(part) and len(part):
                    out.append(part)
            rest = minus(rest, f)
        if len(rest):
            out.append(rest)
        faces = out
    # a face in several separate pieces (a bar cut in two by the stem it crosses) is one region per piece
    def split(f):
        f.correctDirection()
        cs = list(f)
        out = []
        for c in cs:
            if c.isClockwise() != outer_dir:
                continue
            piece = new()
            piece += c.dup()
            x0, y0, x1, y1 = c.boundingBox()
            for h in cs:
                hx0, hy0, hx1, hy1 = h.boundingBox()
                if h.isClockwise() != outer_dir and x0 <= hx0 and y0 <= hy0 and x1 >= hx1 and y1 >= hy1:
                    piece += h.dup()
            out.append(piece)
        return out

    pieces = [p for f in faces for p in split(f)]
    gaps = []
    if pieces:  # the empty areas the ink closes in (the blank between a stem and a bar) are regions too: fill them like ink
        ink = new()
        for i in used:  # from the shapes themselves: the cut-up pieces share edges, which FontForge's set operations stumble on
            ink += layer[i].dup()
        ink.removeOverlap()
        x0 = min(c.boundingBox()[0] for c in ink) - 10
        y0 = min(c.boundingBox()[1] for c in ink) - 10
        x1 = max(c.boundingBox()[2] for c in ink) + 10
        y1 = max(c.boundingBox()[3] for c in ink) + 10
        frame = new()
        r = fontforge.contour()
        for x, y in ((x0, y0), (x0, y1), (x1, y1), (x1, y0)):
            r += fontforge.point(x, y, True)
        r.closed = True
        r.is_quadratic = bool(layer.is_quadratic)
        frame += r
        for g in split(minus(frame, ink)):
            if g.boundingBox() != (x0, y0, x1, y1):  # the open space around everything is no region
                gaps.append(g)
    return pieces + gaps, len(pieces), used


def op_regions(name, contours):
    """The regions the given shapes make up (read-only): a list of faces, each a list of [x, y, on-curve] contours."""
    layer = state.FONT[name].foreground
    return [[[[p.x, p.y, 1 if p.on_curve else 0] for p in c] for c in f] for f in _faces(layer, sorted(set(contours)))[0]]


def op_edit(name, kind, **a):
    """Outline edits. Every one is a plain call into FontForge's layer/contour
    objects; no geometry is computed here.

    move            moves=[[contour, point, dx, dy], ...]
    delete_points   points=[[contour, point], ...]   (contours left with <2 points go)
    delete_contours contours=[i, ...]
    reorder         order=[i, ...]                   (new stacking/drawing order)
    reverse         contours=[i, ...]
    remove_overlap | correct_direction               (whole glyph)
    pathfinder      mode=union|subtract|intersect, contours=[i, ...]
                    subtract: the first listed shape minus all the others
    shape_build     mode=merge|delete, contours=[i, ...], faces=[j, ...]   (indexes into op_regions' answer)
    transform       matrix=[a,b,c,d,e,f], points=[[c,p],...] or contours=[i,...]
    add_contour     points=[[x, y, on], ...], closed  (cubic; converted if the layer is quadratic)
    """
    g = state.FONT[name]

    def move(layer):
        for ci, pi, dx, dy in a["moves"]:
            c = layer[ci]
            p = c[pi]
            p.x += dx
            p.y += dy
            c[pi] = p
            layer[ci] = c

    def delete_points(layer):
        by_contour = {}
        for ci, pi in a["points"]:
            by_contour.setdefault(ci, []).append(pi)
        drop = []
        for ci, pis in by_contour.items():
            c = layer[ci]
            for pi in sorted(set(pis), reverse=True):
                del c[pi]
            if len(c) < 2:
                drop.append(ci)
            else:
                layer[ci] = c
        return _without(layer, drop)

    def reorder(layer):
        new = fontforge.layer()
        new.is_quadratic = layer.is_quadratic
        for i in a["order"]:
            new += layer[i]
        return new

    def reverse(layer):
        for ci in a["contours"]:
            c = layer[ci]
            c.reverseDirection()
            layer[ci] = c

    def pathfinder(layer):
        picked = sorted(set(a["contours"]))
        sub = fontforge.layer()
        sub.is_quadratic = layer.is_quadratic
        if a["mode"] == "subtract":
            base = fontforge.layer()
            base.is_quadratic = layer.is_quadratic
            base += layer[picked[0]]
            for i in picked[1:]:
                sub += layer[i]
            # FontForge's naming: X.exclude(Y) leaves Y minus X.
            sub.exclude(base)
        else:
            for i in picked:
                sub += layer[i]
            sub.removeOverlap() if a["mode"] == "union" else sub.intersect()
        out = _without(layer, picked)
        for c in sub:
            out += c
        return out

    def shape_build(layer):
        # what is left of the shapes (regions removed, gaps filled) is one outline again: united, its counters stay holes
        picked = sorted(set(a["contours"]))
        faces, n_ink, used = _faces(layer, picked)
        take = set(a["faces"])
        out = _without(layer, used)
        kept = fontforge.layer()
        kept.is_quadratic = layer.is_quadratic
        for j, f in enumerate(faces):
            if (j < n_ink and not (a["mode"] == "delete" and j in take)) or (j >= n_ink and a["mode"] == "merge" and j in take):
                for c in f:
                    kept += c.dup()
        if len(kept):
            kept.removeOverlap()
            for c in kept:
                out += c
        return out

    def transform(layer):
        m = tuple(a["matrix"])
        mirrors = m[0] * m[3] - m[1] * m[2] < 0
        for ci in a.get("contours", []):
            c = layer[ci]
            c.transform(m)
            if mirrors and c.closed:
                c.reverseDirection()  # a mirror flips winding; keep outsides outside
            layer[ci] = c
        for ci, pi in a.get("points", []):
            c = layer[ci]
            p = c[pi]
            p.transform(m)
            c[pi] = p
            layer[ci] = c

    def round_corners(layer):
        # points=[[contour, point], ...] (or none: every corner), radius: see corners.py
        import corners
        picked = {}
        for ci, pi in a.get("points") or []:
            picked.setdefault(ci, set()).add(pi)
        whole = not a.get("points")
        for ci in range(len(layer)):
            if not whole and ci not in picked:
                continue
            c = layer[ci]
            pts = [[p.x, p.y, 1 if p.on_curve else 0] for p in c]
            new = corners.round_points(pts, bool(c.closed), set(range(len(pts))) if whole else picked[ci], float(a["radius"]), a.get("corner", "round"), bool(layer.is_quadratic))
            if len(new) != len(pts):
                n = _contour(new, c.closed, layer.is_quadratic)
                n.name = c.name
                layer[ci] = n

    def add_contour(layer):
        c = fontforge.contour()
        for x, y, on in a["points"]:
            c += fontforge.point(x, y, bool(on))
        c.closed = bool(a.get("closed", True))
        if layer.is_quadratic:
            c.is_quadratic = True  # FontForge's own cubic -> quadratic conversion
        c.name = a.get("label") or ""  # a stroke's settings travel in the contour's name (strokes.py)
        layer += c

    def expand_strokes(layer):
        # the strokes (all, or just `contours`) become plain outlines; everything else stays as it is
        return _expand_layer(layer, set(a["contours"]) if a.get("contours") is not None else None)[0]

    def rename(layer):
        c = layer[a["contour"]]
        c.name = a["label"]  # contour names are saved in .sfd
        layer[a["contour"]] = c

    def paste(layer):
        # contours as copied (points in the layer's own curve kind), added on top
        if bool(a.get("quadratic", layer.is_quadratic)) != bool(layer.is_quadratic):
            raise ValueError("can't paste between a cubic (PostScript) and a quadratic (TrueType) font")
        for pts, closed in zip(a["contours"], a["closed"]):
            layer += _contour(pts, closed, layer.is_quadratic)

    def set_contour(layer):
        ci = a["contour"]
        old = layer[ci]
        c = _contour(a["points"], a.get("closed", old.closed), layer.is_quadratic)
        c.name = old.name
        layer[ci] = c

    def insert_point(layer):
        # a new on-curve point on the path nearest (x, y), shape unchanged (curves are split, not reshaped)
        best = None  # (distance, contour index, new point list)
        for ci, c in enumerate(layer):
            pts = [(p.x, p.y, bool(p.on_curve)) for p in c]
            hit = _split_nearest(pts, bool(c.closed), a["x"], a["y"], bool(layer.is_quadratic))
            if hit and (best is None or hit[0] < best[0]):
                best = (hit[0], ci, hit[1])
        if best is None or best[0] > a.get("tol", 1e9):
            raise ValueError("No path there to add a point to")
        old = layer[best[1]]
        c = _contour(best[2], old.closed, layer.is_quadratic)
        c.name = old.name
        layer[best[1]] = c

    ops = {
        "insert_point": insert_point, "expand_strokes": expand_strokes, "rename": rename, "set_contour": set_contour, "paste": paste,
        "pathfinder": pathfinder, "shape_build": shape_build, "transform": transform, "add_contour": add_contour, "round_corners": round_corners,
        "move": move, "delete_points": delete_points, "reorder": reorder, "reverse": reverse,
        "delete_contours": lambda layer: _without(layer, a["contours"]),
        "remove_overlap": lambda layer: layer.removeOverlap(),
        "correct_direction": lambda layer: layer.correctDirection(),
        "add_extrema": lambda layer: layer.addExtrema(),
        "round": lambda layer: layer.round(),
        # filters: FontForge's own clean-ups, named as in its Element menu
        "simplify": lambda layer: layer.simplify(),
        "add_inflections": lambda layer: layer.addInflections(),
        "balance": lambda layer: layer.balance(),
        "harmonize": lambda layer: layer.harmonize(),
        "clean_up": lambda layer: _without(layer, [i for i, c in enumerate(layer) if _stray(c)]),
    }
    if kind == "clear":  # empty the glyph (outlines and components), keep its name, code point, width and kerning
        g.preserveLayerAsUndo(1)
        w = g.width
        g.clear()
        g.width = w
        return op_points(name)
    if kind == "draft_ligature":
        # æ = a + e side by side, Ø = O + slash across it: components to Make editable and finish by hand
        beside = {0xE6: "ae", 0xC6: "AE", 0x153: "oe", 0x152: "OE", 0x133: "ij", 0x132: "IJ"}
        across = {0xD8: ("O", 0x2F, 0.5), 0xF8: ("o", 0x2F, 0.5), 0xD0: ("D", 0x2D, 0.5), 0x110: ("D", 0x2D, 0.5),
                  0x111: ("d", 0x2D, 0.75), 0x126: ("H", 0x2D, 0.75), 0x127: ("h", 0x2D, 0.75)}
        by_cp = {x.unicode: x for x in state.FONT.glyphs() if x.unicode >= 0}
        if g.unicode in beside:
            parts = beside[g.unicode]
            first, second = by_cp.get(ord(parts[0])), by_cp.get(ord(parts[1]))
            if not first or not second:
                raise ValueError(f"the font needs both '{parts[0]}' and '{parts[1]}' first")
            g.preserveLayerAsUndo(1)
            g.clear()
            g.addReference(first.glyphname)
            # the letters' own sidebearings would leave a gap: slide the second one until its ink starts a little inside the first one's, so the join can be merged
            b1, b2 = first.boundingBox(), second.boundingBox()
            dx = (b1[2] - b2[0]) - state.FONT.em * 0.03 if b1 != (0, 0, 0, 0) and b2 != (0, 0, 0, 0) else first.width
            g.addReference(second.glyphname, psMat.translate(dx, 0))
            g.width = round(dx + second.width)
            return op_points(name)
        if g.unicode in across:
            letter, mark_cp, height = across[g.unicode]
            base, mark = by_cp.get(ord(letter)), by_cp.get(mark_cp)
            if not base or not mark:
                raise ValueError(f"the font needs '{letter}' and '{chr(mark_cp)}' first")
            bb, mb = base.boundingBox(), mark.boundingBox()
            g.preserveLayerAsUndo(1)
            g.clear()
            g.addReference(base.glyphname)
            g.addReference(mark.glyphname, psMat.translate((bb[0] + bb[2]) / 2 - (mb[0] + mb[2]) / 2,
                                                           bb[1] + (bb[3] - bb[1]) * height - (mb[1] + mb[3]) / 2))
            g.width = base.width
            return op_points(name)
        raise ValueError("only æ Æ œ Œ ĳ Ĳ Ø ø Đ Ð đ Ħ ħ can be drafted from parts")
    if kind == "unlink":  # components become real outlines of this glyph: editable, no longer following acute or dieresis
        g.preserveLayerAsUndo(1)
        _unlink_named(g)
        return op_points(name)
    if kind == "weight":
        # Not FontForge's Change Weight: it rebuilds the outline and adds or drops points, which makes
        # interpolation with the other masters impossible. Ours only moves points (see weight.py).
        import weight
        g.preserveLayerAsUndo(1)
        layer = g.foreground
        for ci in range(len(layer)):
            c = layer[ci]
            pts = [[p.x, p.y, 1 if p.on_curve else 0] for p in c]
            moved = False
            for pi, (dx, dy) in enumerate(weight.offsets(pts, bool(c.closed), float(a["delta"]))):
                if dx or dy:
                    p = c[pi]
                    p.x = round(p.x + dx)
                    p.y = round(p.y + dy)
                    c[pi] = p
                    moved = True
            if moved:  # a stray one-point contour has nothing to move, and FontForge refuses to put it back
                layer[ci] = c
        g.foreground = layer
        return op_points(name)
    _edit(g, ops[kind])
    return op_points(name)


def _sig(c):
    return tuple((round(p.x, 2), round(p.y, 2), bool(p.on_curve)) for p in c)


def _unlink_named(g):
    """Turn the components into outlines, each shape named after the component it came from (acute, dieresis).
    A component with a hole (a ring) gives several shapes: all carry the same name, so the hole stays with its accent.
    FontForge puts the new shapes wherever it likes, so they are found by what is new, not by position."""
    for rname in dict.fromkeys(r[0] for r in g.references):
        have = {}
        for c in g.foreground:
            have[_sig(c)] = have.get(_sig(c), 0) + 1
        g.unlinkRef(rname)
        layer = g.foreground
        for i in range(len(layer)):
            c = layer[i]
            s = _sig(c)
            if have.get(s, 0) > 0:
                have[s] -= 1
                continue
            c.name = rname
            layer[i] = c
        g.foreground = layer
    # parts drawn in different directions (a hyphen against a D) would cancel where they overlap and show as holes
    g.correctDirection()


def op_copy_flat(name, new):
    """A new unencoded glyph with this glyph's components turned into outlines (plus width and anchors): your own accent to edit."""
    if new in state.FONT:
        raise ValueError(f"'{new}' already exists")
    src = state.FONT[name]
    g = state.FONT.createChar(-1, new)
    g.width = src.width
    g.foreground = src.foreground.dup() if hasattr(src.foreground, "dup") else src.foreground
    for r in src.references:
        g.addReference(r[0], r[1])
    _unlink_named(g)
    for a in src.anchorPoints:
        g.addAnchorPoint(*a)
    return {"name": new}


def _stray(c):
    """Like Illustrator's Clean Up: a lone point, or a closed shape with no area (all on one line).
    Open paths of two or more points stay: they are strokes."""
    on = [p for p in c if p.on_curve]
    if len(on) <= 1:
        return True
    xs, ys = [p.x for p in c], [p.y for p in c]
    return bool(c.closed) and (max(xs) == min(xs) or max(ys) == min(ys))


def _without(layer, drop):
    new = fontforge.layer()
    new.is_quadratic = layer.is_quadratic
    for i, c in enumerate(layer):
        if i not in drop:
            new += c
    return new


REDO = {}  # (fid, glyph) -> [(what the outline looked like after the undo, what it was before)]; FontForge itself has no redo


def _layer_sig(layer):
    return tuple((c.closed, tuple((round(p.x, 3), round(p.y, 3), p.on_curve) for p in c), c.name) for c in layer)


def op_undo(name):
    g = state.FONT[name]
    before = g.foreground.dup()
    g.doUndoLayer(1)
    REDO.setdefault((state.FID, name), []).append((_layer_sig(g.foreground), before))
    return op_points(name)


def op_redo(name):
    """Put back what the last undo took away. Only while the outline is still exactly as that undo left it:
    a new edit in between makes the redo history void (as everywhere)."""
    g = state.FONT[name]
    stack = REDO.get((state.FID, name), [])
    if not stack or stack[-1][0] != _layer_sig(g.foreground):
        stack.clear()
        raise ValueError("Nothing to redo")
    _, layer = stack.pop()
    g.preserveLayerAsUndo(1)
    g.foreground = layer
    return op_points(name)


def _char(cp, name=None):
    """The glyph for this code point, made if missing, with its standard name (dotlessi, Aacute): FontForge
    on its own can name a new glyph glyph74 in a font without a name list."""
    old = next((g for g in state.FONT.glyphs() if g.unicode == cp), None) if cp >= 0 else None
    if old is not None:
        return old
    return state.FONT.createChar(cp, name or (fontforge.nameFromUnicode(cp) if cp >= 0 else None) or f"uni{cp:04X}")


def op_create_glyph(unicode=-1, name=None):
    """New glyph in an empty slot, with the standard name."""
    g = _char(unicode, name) if unicode >= 0 else state.FONT.createChar(unicode, name)
    if g.width in (0, state.FONT.em) and not len(g.foreground) and not g.references:
        # a fresh slot is a full em, or 0 in some fonts, and FontForge does not even list a glyph of
        # width 0 with nothing in it: half an em is a saner start and keeps it visible
        g.width = state.FONT.em // 2
    return _glyph_summary(g)


def _fill_parts(g, parts):
    """The letters side by side as outlines of their own, not linked to the originals: a ligature to start from, which can be moved
    closer together and joined into one shape. As wide as the letters are together."""
    x = 0
    for p in parts:
        g.addReference(p, psMat.translate(x, 0))
        x += state.FONT[p].width
    g.unlinkRef()
    g.width = x


def op_make_glyphs(items):
    """New glyphs to draw, for the Features page. Each item is {name, base?, scale?, width?, parts?, fill?}: with parts it starts as
    those letters side by side as loose outlines (a ligature), with a base as a copy of that glyph (scaled, e.g. a.sc from A at 0.8), otherwise
    empty at the given width. Names the font has are left alone, except an empty one when `fill` is set: that gets the letters."""
    font = state.FONT
    have = {g.glyphname for g in font.glyphs()}
    made = []
    for it in items:
        name, base, parts = it["name"], it.get("base"), it.get("parts")
        usable = bool(parts) and all(p in have for p in parts)
        if name in have:
            g = font[name]
            if it.get("fill") and usable and not len(g.foreground) and not g.references:
                _fill_parts(g, parts)
                made.append(name)
            continue
        g = font.createChar(-1, name)
        if usable:
            _fill_parts(g, parts)
        elif base and base in have:
            s = float(it.get("scale", 1))
            g.addReference(base, psMat.scale(s))
            g.unlinkRef()  # a copy to reshape, not a link to the original
            g.width = round(font[base].width * s)
        else:
            g.width = int(it.get("width") or font.em // 2)
        have.add(name)
        made.append(name)
    return {"created": made}


def op_codepoints():
    """Every code point the font covers: each glyph's Unicode value and its alternate ones (a glyph can serve several)."""
    out = set()
    for g in state.FONT.glyphs():
        if g.unicode >= 0:
            out.add(g.unicode)
        for alt in g.altuni or ():
            if alt[0] >= 0:
                out.add(alt[0])
    return sorted(out)


def op_create_many(codepoints):
    """Empty glyphs for these code points (the ones the font lacks), named the way FontForge names them."""
    made, have = [], set(op_codepoints())  # `cp in FONT` is also true for an empty slot, so it can't be used here
    for cp in codepoints:
        if cp in have:
            continue
        g = _char(cp)
        g.width = state.FONT.em // 2
        made.append(g.glyphname)
    return {"created": made}
