"""Kerning, kerning groups, sidebearings, auto-spacing and metrics keys.

Part of the FontForge worker (worker.py): runs under FontForge's own Python, stdlib and fontforge only."""

import os

import w_state as state
from metrics_keys import creates_cycle, parse_key, read_keys, value as key_value, write_keys
from w_font import _DEPS, _outline


# ------------------------------------------------------------------ kerning
#
# OpenType semantics, as FontForge stores them: every lookup of the 'kern'
# feature applies; inside one lookup the first subtable that matches the
# pair wins. A class subtable matches whenever the left glyph is in one of
# its first classes (even if the right glyph is in no class: value of class
# 0). The effective kern is the sum over lookups.

KERN_LOOKUP = "Forge kerning"


def _kern_lookups():
    return [lk for lk in state.FONT.gpos_lookups if state.FONT.getLookupInfo(lk)[0] == "gpos_pair"
            and any(feat == "kern" for feat, _ in state.FONT.getLookupInfo(lk)[2])]


def _class_index(classes, glyph):
    for i, members in enumerate(classes):
        if i and members and glyph in members:
            return i
    return 0


def _match(lookup, left, right):
    """(value, source) for the first subtable of `lookup` matching the pair, or None."""
    for st in state.FONT.getLookupSubtables(lookup):
        if state.FONT.isKerningClass(st):
            fc, sc, off = state.FONT.getKerningClass(st)
            i = _class_index(fc, left)
            if not i:
                continue
            j = _class_index(sc, right)
            return off[i * len(sc) + j], {
                "kind": "class", "subtable": st, "lookup": lookup,
                "left_class": list(fc[i]), "right_class": list(sc[j]) if j else []}
        for p in state.FONT[left].getPosSub(st):
            if p[1] == "Pair" and p[2] == right:
                return p[5], {"kind": "pair", "subtable": st, "lookup": lookup}
    return None


def _kern(left, right):
    total, sources = 0, []
    if left in state.FONT and right in state.FONT:
        for lk in _kern_lookups():
            m = _match(lk, left, right)
            if m:
                total += m[0]
                sources.append({**m[1], "value": m[0]})
    return {"left": left, "right": right, "value": total, "sources": sources}


def op_kerning(pairs):
    return [_kern(l, r) for l, r in pairs]


def _pair_subtable(lookup, before=None):
    """A plain pair subtable in `lookup` (first in order, so it wins over
    class subtables of the same lookup), created if there is none."""
    for st in state.FONT.getLookupSubtables(lookup):
        if not state.FONT.isKerningClass(st):
            if before is None or state.FONT.getLookupSubtables(lookup).index(st) < state.FONT.getLookupSubtables(lookup).index(before):
                return st
    name = f"{lookup} pairs"
    n = 2
    while name in [st for lk in state.FONT.gpos_lookups for st in state.FONT.getLookupSubtables(lk)]:
        name, n = f"{lookup} pairs {n}", n + 1
    state.FONT.addLookupSubtable(lookup, name)  # inserted first
    return name


def _set_pair(st, left, right, value):
    g = state.FONT[left]
    others = [p for p in g.getPosSub(st) if p[1] == "Pair" and p[2] != right]
    g.removePosSub(st)
    for p in others:
        g.addPosSub(st, p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10])
    if value is not None:
        g.addPosSub(st, right, int(round(value)))


GROUPS_SUBTABLE = "Forge kerning groups"


def op_kern_groups():
    """Every kerning-class table: its first-glyph and second-glyph groups.
    Index 0 is the implicit 'everything else' class and is not listed."""
    out = []
    for lk in _kern_lookups():
        for st in state.FONT.getLookupSubtables(lk):
            if state.FONT.isKerningClass(st):
                fc, sc, _ = state.FONT.getKerningClass(st)
                out.append({"subtable": st, "lookup": lk,
                            "first": [{"index": i, "members": list(m or ())} for i, m in enumerate(fc) if i],
                            "second": [{"index": j, "members": list(m or ())} for j, m in enumerate(sc) if j]})
    return out


def _groups_subtable():
    """The class table new groups go into: an existing one, or a new one
    placed after the pair subtables, so pair kerning stays the exception
    that wins over group values."""
    for lk in _kern_lookups():
        for st in state.FONT.getLookupSubtables(lk):
            if state.FONT.isKerningClass(st):
                return st
    lookups = _kern_lookups()
    if not lookups:
        state.FONT.addLookup(KERN_LOOKUP, "gpos_pair", (), (("kern", (("DFLT", ("dflt",)), ("latn", ("dflt",)))),))
        lookups = [KERN_LOOKUP]
    subs = state.FONT.getLookupSubtables(lookups[0])
    if subs:
        state.FONT.addKerningClass(lookups[0], GROUPS_SUBTABLE, (None,), (None,), (0,), subs[-1])
    else:
        state.FONT.addKerningClass(lookups[0], GROUPS_SUBTABLE, (None,), (None,), (0,))
    return GROUPS_SUBTABLE


def op_edit_group(side, members, index=None, subtable=None):
    """Create (index None), change or delete (no members) a group.

    side    first (glyph on the left of a pair) or second (on the right)
    A glyph can be in one group per side, so members are taken out of the
    side's other groups. Kerning values of untouched groups are kept."""
    if side not in ("first", "second"):
        raise ValueError("side is first or second")
    missing = [m for m in members if m not in state.FONT]
    if missing:
        raise ValueError(f"no such glyph: {', '.join(missing)}")
    st = subtable or _groups_subtable()
    fc, sc, off = state.FONT.getKerningClass(st)
    fc, sc = [list(c or ()) for c in fc], [list(c or ()) for c in sc]
    n1, n2 = len(fc), len(sc)
    grid = [list(off[i * n2:(i + 1) * n2]) for i in range(n1)]
    classes = fc if side == "first" else sc
    for i, c in enumerate(classes):
        if i and i != index:
            classes[i] = [g for g in c if g not in members]
    if index is None:
        classes.append(list(members))
        if side == "first":
            grid.append([0] * n2)
        else:
            for row in grid:
                row.append(0)
    else:
        classes[index] = list(members)
    # drop groups left empty (deleted, or emptied by moving their members)
    for i in range(len(classes) - 1, 0, -1):
        if not classes[i]:
            del classes[i]
            if side == "first":
                del grid[i]
            else:
                for row in grid:
                    del row[i]
    to_tuple = lambda cs: tuple(None if i == 0 else tuple(c) for i, c in enumerate(cs))
    state.FONT.alterKerningClass(st, to_tuple(fc), to_tuple(sc), tuple(v for row in grid for v in row))
    return op_kern_groups()


def op_set_kern(left, right, value, mode="auto"):
    """Make the pair's effective kern `value` (None removes a pair kern).

    auto   change whatever sets it now: a pair entry, or the group (class)
           cell, which moves every pair of those two groups
    pair   only this pair: a pair entry ahead of the group values (an
           exception), set so the total comes out at `value`
    """
    cur = _kern(left, right)
    src = cur["sources"][0] if cur["sources"] else None
    if src is None:
        if value in (None, 0):
            return cur
        lookups = _kern_lookups()
        if not lookups:
            state.FONT.addLookup(KERN_LOOKUP, "gpos_pair", (), (("kern", (("DFLT", ("dflt",)), ("latn", ("dflt",)))),))
            lookups = [KERN_LOOKUP]
        _set_pair(_pair_subtable(lookups[0]), left, right, value)
        return _kern(left, right)
    others = cur["value"] - src["value"]  # contributions of other lookups stay
    if src["kind"] == "pair":
        _set_pair(src["subtable"], left, right, None if value is None else value - others)
    elif mode == "pair":
        st = _pair_subtable(src["lookup"], before=src["subtable"])
        _set_pair(st, left, right, None if value is None else value - others)
    else:
        fc, sc, off = state.FONT.getKerningClass(src["subtable"])
        off = list(off)
        off[_class_index(fc, left) * len(sc) + _class_index(sc, right)] = int(round((value or 0) - others))
        state.FONT.alterKerningClass(src["subtable"], fc, sc, tuple(off))
    return _kern(left, right)


def _pair_entries(st, names):
    return {(n, p[2]): p[5] for n in names for p in state.FONT[n].getPosSub(st) if p[1] == "Pair"}


def _closest(left, right, kern):
    """Smallest horizontal gap between the two shapes set side by side with this kern, measured
    band by band with FontForge's own xBoundsAtY. None if they never share a height."""
    a, b = state.FONT[left], state.FONT[right]
    lo = int(max(a.boundingBox()[1], b.boundingBox()[1]))
    hi = int(min(a.boundingBox()[3], b.boundingBox()[3]))
    step = max(1, state.FONT.em // 100)
    best = None
    for y in range(lo, hi + 1, step):
        ra, rb = a.foreground.xBoundsAtY(y, y + step), b.foreground.xBoundsAtY(y, y + step)
        if ra and rb:
            gap = a.width + kern + rb[0] - ra[1]
            best = gap if best is None else min(best, gap)
    return best


def op_auto_kern(names=None, separation=None, min_kern=None, only_closer=False, min_gap=None):
    """FontForge's own Auto Kern on every pair of these glyphs (default: all with an outline), written as
    pair kerns in the font's kern lookup (made if missing). Returns each pair it changed, with the value
    from before (None = there was none), so one undo can put them back."""
    pool = names if names is not None else [g.glyphname for g in state.FONT.glyphs() if len(g.foreground)]
    pool = list(dict.fromkeys(n for n in pool if n in state.FONT and len(state.FONT[n].foreground)))
    if len(pool) < 1:
        return {"subtable": None, "changed": []}
    lookups = _kern_lookups()
    if not lookups:
        state.FONT.addLookup(KERN_LOOKUP, "gpos_pair", (), (("kern", (("DFLT", ("dflt",)), ("latn", ("dflt",)))),))
        lookups = [KERN_LOOKUP]
    st = _pair_subtable(lookups[0])
    before = _pair_entries(st, pool)
    sep = int(separation) if separation is not None else int(state.FONT.em * 0.1)
    kw = {"onlyCloser": bool(only_closer)}
    if min_kern is not None:
        kw["minKern"] = int(min_kern)
    state.FONT.autoKern(st, sep, tuple(pool), tuple(pool), **kw)
    after = _pair_entries(st, pool)
    # FontForge can pull shapes into each other (A V, F comma): never let two letters come closer than min_gap
    floor = int(state.FONT.em * 0.03) if min_gap is None else int(min_gap)
    for (l, r), v in list(after.items()):
        if v < 0 and before.get((l, r)) != v:  # only what Auto Kern just wrote
            gap = _closest(l, r, v)
            if gap is not None and gap < floor:
                v = min(0, v + (floor - gap))
                _set_pair(st, l, r, v if v else None)
                if v:
                    after[(l, r)] = v
                else:
                    del after[(l, r)]
    changed = [{"left": l, "right": r, "before": before.get((l, r)), "after": after.get((l, r))}
               for (l, r) in sorted(set(before) | set(after)) if before.get((l, r)) != after.get((l, r))]
    return {"subtable": st, "changed": changed}


def op_closest(left, right, kern):
    return _closest(left, right, kern)


def op_set_pairs(subtable, pairs):
    """Put pair kerns of one subtable back to given values (None removes): the undo of op_auto_kern."""
    for p in pairs:
        if p["left"] in state.FONT and p["right"] in state.FONT:
            _set_pair(subtable, p["left"], p["right"], p["value"])
    return {"ok": True}


def op_auto_space(names=None, separation=None, min_bearing=None, max_bearing=None):
    """FontForge's own Auto Width: it guesses advance widths and sidebearings from the shapes, so that the
    chosen glyphs sit evenly spaced next to each other. `names`: default every glyph with an outline. Glyphs
    whose sidebearings follow another glyph (metrics keys) are left to their keys, which are brought up to
    date afterwards. Returns what changed, with the values from before (for undo)."""
    pool = names if names is not None else [g.glyphname for g in state.FONT.glyphs() if len(g.foreground)]
    pool = [n for n in pool if n in state.FONT and len(state.FONT[n].foreground)]
    keyed = [n for n in pool if read_keys(state.FONT[n].comment)]
    todo = [n for n in pool if n not in keyed]
    if not todo:
        return {"changed": [], "skipped": keyed, "followers": []}
    before = {n: (state.FONT[n].left_side_bearing, state.FONT[n].right_side_bearing, state.FONT[n].width) for n in todo}
    state.FONT.selection.none()
    state.FONT.selection.select(*todo)
    sep = int(separation) if separation is not None else int(state.FONT.em * 0.1)
    state.FONT.autoWidth(sep)
    state.FONT.selection.none()
    lo = 0 if min_bearing is None else int(min_bearing)  # FontForge's own limits did not hold in testing: keep letters apart (no overlap by default)
    hi = None if max_bearing is None else int(max_bearing)
    changed = []
    for n in todo:
        g = state.FONT[n]
        for side in ("left_side_bearing", "right_side_bearing"):
            v = int(round(getattr(g, side)))
            c = max(lo, v) if hi is None else min(hi, max(lo, v))
            if c != v:
                setattr(g, side, c)
        now = (g.left_side_bearing, g.right_side_bearing, g.width)
        if now != before[n]:
            changed.append({"name": n, "lsb": now[0], "rsb": now[1], "width": now[2],
                            "before": {"lsb": before[n][0], "rsb": before[n][1], "width": before[n][2]}})
    followers = _propagate([c["name"] for c in changed])
    return {"changed": changed, "skipped": keyed, "outlines": [_outline(state.FONT[c["name"]]) for c in changed],
            "followers": [_outline(state.FONT[n]) for n in followers]}


def op_set_bearings(name, lsb=None, rsb=None, width=None):
    """FontForge moves the outline for lsb and changes the advance for rsb.
    It only accepts integers; font units are integers in every format v0 writes.
    Typing a number into a side drops that side's metrics key; glyphs whose keys
    follow this one are updated, and come back in `changed`."""
    g = state.FONT[name]
    keys = read_keys(g.comment)
    if lsb is not None:
        g.left_side_bearing = int(round(lsb))
        keys.pop("lsb", None)
    if rsb is not None:
        g.right_side_bearing = int(round(rsb))
        keys.pop("rsb", None)
    if width is not None:
        g.width = int(round(width))
    if keys != read_keys(g.comment):
        _store_keys(g, keys)
    out = _outline(g)
    out["changed"] = [_outline(state.FONT[n]) for n in _propagate([name])]
    return out


# ---------------------------------------------------------- metrics keys
#
# A sidebearing can follow another glyph's (=H, =|n, =H+10; rules in
# metrics_keys.py). The key is stored in the glyph's comment.



def _store_keys(g, keys):
    g.comment = write_keys(g.comment, keys)
    _DEPS.pop(id(state.FONT), None)


def _glyph(token):
    """A key names a glyph or a single character."""
    if token in state.FONT:
        return state.FONT[token].glyphname
    if len(token) == 1 and ord(token) in state.FONT:
        return state.FONT[ord(token)].glyphname
    raise ValueError(f"no glyph {token!r} in this font")


def _refs_of(name):
    out = []
    for key in read_keys(state.FONT[name].comment).values():
        try:
            out.append(_glyph(parse_key(key)[0]))
        except ValueError:
            pass
    return out


def _dependents():
    d = _DEPS.get(id(state.FONT))
    if d is None:
        d = {}
        for g in state.FONT.glyphs():
            if "@metrics" in (g.comment or ""):
                for r in _refs_of(g.glyphname):
                    d.setdefault(r, []).append(g.glyphname)
        _DEPS[id(state.FONT)] = d
    return d


def _follow(name):
    """Set this glyph's bearings from its keys; True if anything moved."""
    g, moved = state.FONT[name], False
    for side, key in read_keys(g.comment).items():
        ref = state.FONT[_glyph(parse_key(key)[0])]
        want = key_value(key, side, (ref.left_side_bearing, ref.right_side_bearing))
        attr = "left_side_bearing" if side == "lsb" else "right_side_bearing"
        if getattr(g, attr) != want:
            setattr(g, attr, want)
            moved = True
    return moved


def _propagate(roots):
    """Update every glyph that follows a changed one, and those that follow
    them; returns the glyphs that moved (not the roots)."""
    changed, todo = [], list(roots)
    deps = _dependents()
    for _ in range(100000):
        if not todo:
            break
        for n in deps.get(todo.pop(0), []):
            if _follow(n):
                if n not in changed:
                    changed.append(n)
                todo.append(n)
    return changed


def op_metrics_keys(names=None):
    """{glyph: {lsb: key, rsb: key}} for glyphs that have keys."""
    out = {}
    for g in (state.FONT[n] for n in names) if names else state.FONT.glyphs():
        k = read_keys(g.comment)
        if k:
            out[g.glyphname] = k
    return out


def op_set_metrics_key(name, side, key):
    """Make `side` (lsb/rsb) of `name` follow `key` (e.g. "=H"); an empty key
    frees it again (the current number stays)."""
    if side not in ("lsb", "rsb"):
        raise ValueError("side is lsb or rsb")
    g = state.FONT[name]
    keys = read_keys(g.comment)
    key = (key or "").strip()
    if key:
        ref = _glyph(parse_key(key)[0])
        if ref == name or creates_cycle(name, side, key, _refs_of) or name in _refs_of(ref):
            raise ValueError(f"{name} can't follow {ref}: it would end up following itself")
        keys[side] = key
    else:
        keys.pop(side, None)
    _store_keys(g, keys)
    if key:
        _follow(name)
    out = _outline(g)
    out["keys"] = keys
    out["changed"] = [_outline(state.FONT[n]) for n in _propagate([name])]
    return out


def op_apply_metrics_keys():
    """Re-apply every key in the font (after pasting, scripts, undo); returns how many glyphs moved."""
    _DEPS.pop(id(state.FONT), None)
    moved = [g.glyphname for g in state.FONT.glyphs() if "@metrics" in (g.comment or "") and _follow(g.glyphname)]
    moved += [n for n in _propagate(moved) if n not in moved]
    return {"moved": len(moved)}


def _save_sfd(path):
    """Write the .sfd beside the real one, then swap it in: the file on disk is whole at every moment, also when
    this process is killed half-way (Cancel, closing the app, a FontForge crash)."""
    tmp = path + ".saving"
    state.FONT.save(tmp)
    os.replace(tmp, path)
