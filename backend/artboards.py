"""One SVG per glyph, to draw on in Illustrator (or anything that opens SVG) and read back.

The artboard is the glyph's advance wide and ascent+descent tall, in font units (1 unit = 1 px), y down.
Two groups: "Metrics" (guide lines, never read back) and "Outline" (the shapes). Illustrator keeps group ids as
layer names, so the layers survive a round trip. FontForge writes and reads the outlines; nothing here is geometry.
"""
import re
import xml.etree.ElementTree as ET

NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)

_BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def file_name(glyph: str) -> str:
    """A glyph name made safe as a Windows file name. Windows ignores case, so "A" and "a" would be one file:
    every capital gets an underscore after it, as in UFO ("A" -> "A_", ".notdef" -> "_notdef")."""
    s = _BAD.sub("_", glyph)
    s = "_" + s[1:] if s.startswith(".") else s
    return "".join(c + "_" if c.isupper() else c for c in s)


def glyph_name(stem: str) -> str:
    """Undo file_name: an underscore right after a capital is dropped."""
    out, i = [], 0
    while i < len(stem):
        out.append(stem[i])
        i += 2 if stem[i].isupper() and stem[i + 1:i + 2] == "_" else 1
    return "".join(out)


def artboard_svg(path_d: str, width: float, ascent: float, descent: float,
                 xheight: float | None = None, capheight: float | None = None, board: float | None = None) -> str:
    """path_d is FontForge's own SVG path (already in y-down artboard coordinates).
    `width` is the glyph's advance (the "right-edge" guide); `board` is the artboard's width (default: the advance)."""
    h = ascent + descent
    full = board or width
    lines = [("baseline", ascent), ("ascender", 0), ("descender", h)]
    if xheight and xheight > 0:
        lines.append(("x-height", ascent - xheight))
    if capheight and capheight > 0:
        lines.append(("cap-height", ascent - capheight))
    guides = "".join(f'<line id="{n}" x1="0" x2="{full:g}" y1="{y:g}" y2="{y:g}"/>' for n, y in lines)
    edges = "".join(f'<line id="{n}" x1="{x:g}" x2="{x:g}" y1="0" y2="{h:g}"/>' for n, x in (("left-edge", 0), ("right-edge", width)))
    shape = f'<path d="{path_d}"/>' if path_d else ""
    return (
        f'<svg xmlns="{NS}" version="1.1" width="{full:g}" height="{h:g}" viewBox="0 0 {full:g} {h:g}">'
        f'<g id="Metrics" fill="none" stroke="#00a0ff" stroke-width="1">{guides}{edges}</g>'
        f'<g id="Outline" fill="#000000">{shape}</g></svg>'
    )


def outline_only(svg: str) -> str:
    """The SVG without its Metrics layer (and anything named like one), ready for FontForge to import."""
    root = ET.fromstring(svg)
    for parent in root.iter():
        for child in list(parent):
            if (child.get("id") or "").lower().startswith("metrics"):
                parent.remove(child)
    return ET.tostring(root, encoding="unicode")


def advance_of(svg: str) -> float | None:
    """The glyph's advance as drawn: the x of the "right-edge" guide (move it in Illustrator to change the width)."""
    for el in ET.fromstring(svg).iter():
        if el.get("id") == "right-edge":
            try:
                return float(el.get("x1"))
            except (TypeError, ValueError):
                return None
    return None


def edges_of(svg: str) -> tuple[float | None, float | None]:
    """The x of the "left-edge" and "right-edge" guides: where the glyph's origin and its advance were drawn."""
    found: dict[str, float] = {}
    for el in ET.fromstring(svg).iter():
        if el.get("id") in ("left-edge", "right-edge"):
            try:
                found[el.get("id")] = float(el.get("x1"))
            except (TypeError, ValueError):
                pass
    return found.get("left-edge"), found.get("right-edge")


def has_shapes(svg: str) -> bool:
    return bool(re.search(r"<(path|rect|circle|ellipse|polygon|polyline)\b", outline_only(svg)))
