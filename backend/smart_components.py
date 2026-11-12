"""Smart components: a glyph built from parts whose shape you slide between two extremes.

A part is a pair of point-compatible glyphs: `_part.stem` (the minimum) and
`_part.stem.max` (the maximum). A glyph lists its placements, each with a
position t (0 = minimum, 1 = maximum) and an offset, on a comment line

    @smart [{"part": "_part.stem", "t": 0.3, "dx": 0, "dy": 0}]

The outlines are generated from that (see server._smart_regen). Pure rules
here (stdlib only); the interpolation itself is fontTools' variation model.
"""
import json

_LINE = "@smart "


def max_name(part):
    return part + ".max"


def read_smart(comment):
    for line in (comment or "").splitlines():
        if line.startswith(_LINE):
            try:
                return [clean(p) for p in json.loads(line[len(_LINE):])]
            except (ValueError, KeyError, TypeError):
                return []
    return []


def write_smart(comment, parts):
    """The comment with its @smart line replaced (or removed when there are no parts)."""
    rest = [l for l in (comment or "").splitlines() if not l.startswith(_LINE)]
    if parts:
        rest.append(_LINE + json.dumps([clean(p) for p in parts]))
    return "\n".join(rest)


def clean(p):
    """A placement with only its known fields; t is kept within 0..1."""
    t = float(p.get("t", 0))
    if not 0 <= t <= 1:
        raise ValueError(f"t must be between 0 and 1, not {t:g}")
    return {"part": str(p["part"]), "t": t, "dx": float(p.get("dx", 0)), "dy": float(p.get("dy", 0))}


def compose(items):
    """Join the outlines of several already-interpolated parts, each moved by
    its offset. items: [(glyph data, dx, dy)]. The advance is the first part's."""
    contours, closed = [], []
    for d, dx, dy in items:
        for c, cl in zip(d["contours"], d["closed"]):
            contours.append([[x + dx, y + dy, on] for x, y, on in c])
            closed.append(cl)
    first, dx, _ = items[0]
    return {"width": first["width"] + items[0][1], "contours": contours, "closed": closed}
