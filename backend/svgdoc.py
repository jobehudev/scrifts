"""SVG documents as drawings: read an .svg into a flat list of styled shapes, write one back.
Pure Python (no FontForge) so it can be tested. Geometry is left to FontForge's own SVG import: each shape is
handed over as a one-path SVG with its full transform chain, so groups, nested transforms and arcs come out right.

Kept: path, rect, circle, ellipse, line, polyline, polygon, with fill, stroke, stroke width, opacity (from
attributes, style="" and inherited from groups) and transforms. Left out (and reported): text, images, <use>,
gradients (a flat grey stands in), clipping and masks, filters."""
import re
import xml.etree.ElementTree as ET

NS = "http://www.w3.org/2000/svg"
NAMED = {"black": "#000000", "white": "#ffffff", "red": "#ff0000", "green": "#008000", "lime": "#00ff00", "blue": "#0000ff",
         "yellow": "#ffff00", "gray": "#808080", "grey": "#808080", "orange": "#ffa500", "purple": "#800080", "pink": "#ffc0cb",
         "brown": "#a52a2a", "cyan": "#00ffff", "aqua": "#00ffff", "magenta": "#ff00ff", "fuchsia": "#ff00ff", "navy": "#000080",
         "teal": "#008080", "maroon": "#800000", "olive": "#808000", "silver": "#c0c0c0", "currentcolor": "#000000"}
SKIP = {"defs", "clippath", "mask", "symbol", "marker", "pattern", "lineargradient", "radialgradient", "filter", "style",
        "title", "desc", "metadata", "script", "namedview"}
LOST = {"text": "text", "image": "images", "use": "<use> copies", "foreignobject": "embedded content", "tspan": "text"}
STYLE_KEYS = ("fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "display", "visibility")
NUMBER = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"


def colour(v, lost):
    """'#rrggbb' or None (no paint)."""
    v = (v or "").strip().lower()
    if v in ("", "none", "transparent"):
        return None
    if v.startswith("url("):
        lost.add("gradients and patterns (drawn grey)")
        return "#808080"
    if v in NAMED:
        return NAMED[v]
    m = re.fullmatch(r"#([0-9a-f]{3})", v)
    if m:
        return "#" + "".join(c * 2 for c in m.group(1))
    if re.fullmatch(r"#[0-9a-f]{6}", v):
        return v
    m = re.fullmatch(r"rgba?\(([^)]*)\)", v)
    if m:
        parts = [p.strip() for p in m.group(1).replace("/", ",").split(",")][:3]
        try:
            vals = [round(float(p[:-1]) * 2.55) if p.endswith("%") else round(float(p)) for p in parts]
            return "#" + "".join(f"{max(0, min(255, x)):02x}" for x in vals)
        except ValueError:
            pass
    return "#000000"


def num(v, default=0.0):
    m = re.match(r"\s*(" + NUMBER + ")", v or "")
    return float(m.group(1)) if m else default


def _tag(el):
    return el.tag.split("}")[-1].lower() if isinstance(el.tag, str) else ""


def _style(el):
    s = {k: el.get(k) for k in STYLE_KEYS if el.get(k) is not None}
    for part in (el.get("style") or "").split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            if k.strip() in STYLE_KEYS:
                s[k.strip()] = v.strip()
    return s


def shape_d(tag, el):
    g = lambda k, d=0.0: num(el.get(k), d)
    if tag == "path":
        return el.get("d") or ""
    if tag == "rect":
        x, y, w, h = g("x"), g("y"), g("width"), g("height")
        rx = num(el.get("rx")) if el.get("rx") is not None else (num(el.get("ry")) if el.get("ry") is not None else 0.0)
        ry = num(el.get("ry")) if el.get("ry") is not None else rx
        rx, ry = min(rx, w / 2), min(ry, h / 2)
        if w <= 0 or h <= 0:
            return ""
        if rx <= 0 or ry <= 0:
            return f"M{x:g} {y:g}H{x + w:g}V{y + h:g}H{x:g}Z"
        return (f"M{x + rx:g} {y:g}H{x + w - rx:g}A{rx:g} {ry:g} 0 0 1 {x + w:g} {y + ry:g}V{y + h - ry:g}"
                f"A{rx:g} {ry:g} 0 0 1 {x + w - rx:g} {y + h:g}H{x + rx:g}A{rx:g} {ry:g} 0 0 1 {x:g} {y + h - ry:g}"
                f"V{y + ry:g}A{rx:g} {ry:g} 0 0 1 {x + rx:g} {y:g}Z")
    if tag in ("circle", "ellipse"):
        cx, cy = g("cx"), g("cy")
        rx, ry = (g("r"), g("r")) if tag == "circle" else (g("rx"), g("ry"))
        if rx <= 0 or ry <= 0:
            return ""
        return f"M{cx - rx:g} {cy:g}A{rx:g} {ry:g} 0 1 0 {cx + rx:g} {cy:g}A{rx:g} {ry:g} 0 1 0 {cx - rx:g} {cy:g}Z"
    if tag == "line":
        return f"M{g('x1'):g} {g('y1'):g}L{g('x2'):g} {g('y2'):g}"
    if tag in ("polyline", "polygon"):
        n = [float(v) for v in re.findall(NUMBER, el.get("points") or "")]
        if len(n) < 4:
            return ""
        pts = [f"{n[i]:g} {n[i + 1]:g}" for i in range(0, len(n) - 1, 2)]
        return "M" + "L".join(pts) + ("Z" if tag == "polygon" else "")
    return ""


def parse(text):
    """-> {width, height, shapes: [{d, transform, fill, stroke, sw, op}], lost: [str]} (z-order, first is at the back)."""
    root = ET.fromstring(text)
    vb = [num(v) for v in re.split(r"[ ,]+", (root.get("viewBox") or "").strip())] if root.get("viewBox") else None
    if vb and len(vb) == 4 and vb[2] > 0 and vb[3] > 0:
        minx, miny, w, h = vb
    else:
        minx = miny = 0.0
        w, h = num(root.get("width"), 0), num(root.get("height"), 0)
        if w <= 0 or h <= 0:
            w, h = 512.0, 512.0
    shapes, lost = [], set()
    base = f"translate({-minx:g} {-miny:g})" if (minx or miny) else ""

    def walk(el, inherited, transform):
        tag = _tag(el)
        if tag in SKIP:
            return
        if tag in LOST:
            lost.add(LOST[tag])
            return
        st = dict(inherited)
        own = _style(el)
        for k, v in own.items():
            if k != "opacity":
                st[k] = v
        op = float(inherited.get("_op", 1.0)) * (num(own["opacity"], 1.0) if "opacity" in own else 1.0)
        st["_op"] = op
        tf = (transform + " " + (el.get("transform") or "")).strip()
        if st.get("display") == "none" or st.get("visibility") == "hidden":
            return
        if tag in ("path", "rect", "circle", "ellipse", "line", "polyline", "polygon"):
            d = shape_d(tag, el)
            if d.strip():
                fill = colour(st.get("fill", "#000000"), lost)
                stroke = colour(st.get("stroke"), lost)
                fo = num(st.get("fill-opacity"), 1.0) if fill else 1.0
                so = num(st.get("stroke-opacity"), 1.0) if stroke else 1.0
                shapes.append({"d": d, "transform": tf, "fill": fill, "stroke": stroke, "sw": num(st.get("stroke-width"), 1.0),
                               "op": round(max(0.0, min(1.0, op * (fo if fill else so))), 3)})
            return
        for child in el:
            walk(child, st, tf)

    walk(root, {"fill": "#000000"}, base)
    return {"width": w, "height": h, "shapes": shapes, "lost": sorted(lost)}


def one_shape_svg(w, h, shape):
    """A single-shape SVG for FontForge's importer (1 unit = 1 pixel, same size as the page)."""
    tf = f' transform="{shape["transform"]}"' if shape["transform"] else ""
    return (f'<svg xmlns="{NS}" width="{w:g}" height="{h:g}" viewBox="0 0 {w:g} {h:g}">'
            f'<g{tf}><path d="{shape["d"]}"/></g></svg>')


# ---- the name a contour carries: ~svg <group> <fill> <stroke> <stroke width> <opacity>
def tag(group, s):
    return f'~svg {group} {s["fill"] or "-"} {s["stroke"] or "-"} {s["sw"]:g} {s["op"]:g}'


TAG = re.compile(r"^~svg (\d+) (\S+) (\S+) (\S+) (\S+)$")


def untag(name):
    """-> (group, fill, stroke, stroke width, opacity), or None for a contour drawn here (black fill)."""
    m = TAG.match(name or "")
    if not m:
        return None
    g, f, s, sw, op = m.groups()
    return int(g), None if f == "-" else f, None if s == "-" else s, float(sw), float(op)


def write(width, height, scale, items):
    """items: [(d, fill, stroke, sw, opacity)] in font units (y up, origin at the bottom left); written y-down in page units."""
    a = 1 / scale
    out = [f'<svg xmlns="{NS}" width="{width:g}" height="{height:g}" viewBox="0 0 {width:g} {height:g}">',
           f'<g transform="matrix({a:.8g} 0 0 {-a:.8g} 0 {height:g})">']
    for d, fill, stroke, sw, op in items:
        attrs = f'fill="{fill or "none"}"'
        if stroke:
            attrs += f' stroke="{stroke}" stroke-width="{sw:g}" stroke-linejoin="round"'
        if op < 1:
            attrs += f' opacity="{op:g}"'
        out.append(f'<path d="{d}" {attrs}/>')
    out.append("</g></svg>")
    return "\n".join(out)
