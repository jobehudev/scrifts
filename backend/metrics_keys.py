"""Metrics keys: a sidebearing that follows another glyph's.

Pure rules (stdlib only; imported by the worker and the tests).

    =H      same side of H          (lsb of n  =H   -> H's lsb)
    =|n     the opposite side of n  (rsb of o  =|n  -> n's lsb, mirrored)
    =H+10   plus/minus units
A plain number is not a key: it is just typed into the sidebearing.
The key lives in the glyph's comment, on a line `@metrics {"lsb": "=H"}`.
"""
import json
import re

_KEY = re.compile(r"^=(\|)?([^\s|]\S*?)(?:([+-])(\d+(?:\.\d+)?))?$")
_LINE = "@metrics "


def parse_key(text):
    """-> (ref, mirror, offset). ValueError if it isn't a key."""
    m = _KEY.match(text.strip())
    if not m:
        raise ValueError(f"not a metrics key: {text!r} (examples: =H  =|n  =H+10)")
    mirror, ref, sign, num = m.groups()
    return ref, bool(mirror), (-1 if sign == "-" else 1) * float(num or 0)


def value(key, side, ref_bearings):
    """The sidebearing `key` asks for. ref_bearings = (lsb, rsb) of the glyph it names."""
    _, mirror, off = parse_key(key)
    pick = (1 if side == "lsb" else 0) if mirror else (0 if side == "lsb" else 1)
    return int(round(ref_bearings[pick] + off))


def read_keys(comment):
    for line in (comment or "").splitlines():
        if line.startswith(_LINE):
            try:
                d = json.loads(line[len(_LINE):])
                return {k: v for k, v in d.items() if k in ("lsb", "rsb") and v}
            except ValueError:
                return {}
    return {}


def write_keys(comment, keys):
    """The comment with its @metrics line replaced (or removed if no keys)."""
    rest = [l for l in (comment or "").splitlines() if not l.startswith(_LINE)]
    if keys:
        rest.append(_LINE + json.dumps(keys, sort_keys=True))
    return "\n".join(rest)


def creates_cycle(name, side, key, refs_of):
    """Would `name`'s `side` following `key` loop back to itself?
    refs_of(glyph) -> the glyph names its keys point at (after resolution)."""
    ref = parse_key(key)[0]
    seen, todo = set(), [ref]
    while todo:
        g = todo.pop()
        if g == name:
            return True
        if g not in seen:
            seen.add(g)
            todo += refs_of(g)
    return False
