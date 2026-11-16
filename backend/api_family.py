"""Families: masters on axes (.designspace), blending between them, brace layers, variable and static builds."""

import os

from fastapi import HTTPException
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from pydantic import BaseModel

from core import FontReq, _call, app, variables


class InstanceReq(FontReq):
    location: dict[str, float]
    path: str


class VariableReq(FontReq):
    path: str


class FamilyNewReq(FontReq):
    path: str  # the .designspace to write
    weight: float = 400


class FamilyAddReq(FontReq):
    family: str  # the .designspace
    style: str
    weight: float | None = None  # the Weight axis
    location: dict[str, float] | None = None  # other axes by name; the rest sit at their default


class AxisReq(BaseModel):
    family: str  # the .designspace
    name: str
    tag: str
    min: float
    default: float
    max: float


def _family(path):
    """A designspace as the UI uses it: the weight axis and its masters."""
    from fontTools.designspaceLib import DesignSpaceDocument
    doc = DesignSpaceDocument.fromfile(path)
    return {
        "path": os.path.normpath(path),
        "axes": [{"tag": a.tag, "name": a.name, "min": a.minimum, "default": a.default, "max": a.maximum} for a in doc.axes],
        "masters": sorted((_master_dict(s, doc.axes) for s in doc.sources),
                          key=lambda m: (m["weight"], *(m["location"][a.name] for a in doc.axes))),
        "braces": _braces(doc),
    }


BRACES_KEY = "com.forge.braces"


def _braces(doc):
    """Brace layers: sparse masters that give some glyphs an extra shape at a
    location between the masters. Each is an .sfd with only `glyphs` counting;
    they live in the designspace lib, not among the sources, so every place
    that means "a full master" stays as it was."""
    base = os.path.dirname(os.path.abspath(doc.path)) if doc.path else ""
    out = []
    for b in doc.lib.get(BRACES_KEY, []):
        loc = {a.name: b["location"].get(a.name, a.default) for a in doc.axes}
        out.append({"path": os.path.normpath(os.path.join(base, b["path"])), "name": b["name"],
                    "weight": loc.get("Weight", 400), "location": loc, "glyphs": list(b["glyphs"])})
    return out


def _save_braces(doc, path, braces):
    base = os.path.dirname(os.path.abspath(path))
    doc.lib[BRACES_KEY] = [{"path": os.path.relpath(b["path"], base), "name": b["name"], "location": b["location"],
                            "glyphs": b["glyphs"]} for b in braces]
    doc.write(path)


def _master_dict(src, axes):
    """A master as the UI uses it: its location on every axis (an axis the
    source doesn't mention sits at that axis' default), `weight` being the Weight axis."""
    loc = {a.name: src.location.get(a.name, a.default) for a in axes}
    return {"path": os.path.normpath(src.path), "name": src.styleName, "weight": loc.get("Weight", 400), "location": loc}


def _at(fam, weight=None, location=None):
    """A full location in this family: axis defaults, then `location`, then `weight` as the Weight axis."""
    loc = {a["name"]: a["default"] for a in fam["axes"]}
    for k, v in (location or {}).items():
        if k not in loc:
            raise HTTPException(400, f"this family has no axis called {k}")
        loc[k] = v
    if weight is not None:
        loc["Weight"] = weight
    for a in fam["axes"]:
        if not a["min"] <= loc[a["name"]] <= a["max"]:
            raise HTTPException(400, f"{a['name']} must be between {a['min']:g} and {a['max']:g}")
    return loc


def _distance(fam, a, b):
    """How far apart two locations are, each axis scaled by its range."""
    return sum(abs(a[x["name"]] - b[x["name"]]) / ((x["max"] - x["min"]) or 1) for x in fam["axes"])


def _at_defaults(fam, loc):
    return all(loc[a["name"]] == a["default"] for a in fam["axes"])


@app.get("/api/family/of")
def family_of(font: str):
    """The family a font is a master of: a .designspace in the font's folder
    that lists it. None when there isn't one."""
    import glob
    key = os.path.normcase(os.path.abspath(font))
    for ds in sorted(glob.glob(os.path.join(glob.escape(os.path.dirname(os.path.abspath(font))), "*.designspace"))):
        try:
            fam = _family(ds)
        except Exception:  # noqa: BLE001 -- not readable as a designspace: skip it
            continue
        if any(os.path.normcase(os.path.abspath(m["path"])) == key for m in fam["masters"] + fam["braces"]):
            return fam
    return None


@app.get("/api/family")
def family(path: str):
    if not os.path.isfile(path):
        raise HTTPException(404, f"no family file: {path}")
    return _family(path)


@app.post("/api/family/new")
def family_new(req: FamilyNewReq):
    """Start a family (a .designspace next to the font) with this font as
    its first, default master on a weight axis. If the font already belongs
    to a family, that family is returned; if the file name is taken by
    another family, the next free name is used (Family-2.designspace)."""
    from fontTools.designspaceLib import DesignSpaceDocument
    info = _call("info", fid=req.fid)
    if not info["path"].lower().endswith(".sfd"):
        raise HTTPException(400, "masters are .sfd files: save this font as .sfd first")
    if not req.path.lower().endswith(".designspace"):
        raise HTTPException(400, "a family file ends in .designspace")
    existing = family_of(info["path"])
    if existing:
        return existing
    stem, n = req.path[:-len(".designspace")], 2
    while os.path.exists(req.path):
        req.path, n = f"{stem}-{n}.designspace", n + 1
    doc = DesignSpaceDocument()
    w = req.weight
    doc.addAxisDescriptor(name="Weight", tag="wght", minimum=w, default=w, maximum=w)
    _call("link_style", fid=req.fid, style=_style(info), weight=w)  # in memory; saved with the font
    doc.addSourceDescriptor(path=info["path"], filename=os.path.relpath(info["path"], os.path.dirname(req.path)),
                            familyName=info["familyname"], styleName=_style(info), location={"Weight": w})
    doc.write(req.path)
    return _family(req.path)


def _style(info):
    name = info["fontname"]
    return name.split("-", 1)[1] if "-" in name else "Regular"


def _compare_masters(names, structs):
    """Glyph-by-glyph differences that stop the masters interpolating, in
    words. The first master is the one the others are compared with."""
    base_name, base = names[0], structs[0]
    out = {}
    for g in sorted(set().union(*structs)):
        probs = []
        lacking = [n for n, s in zip(names, structs) if g not in s]
        if lacking:
            probs.append(f"missing in {', '.join(lacking)}")
        have = [(n, s[g]) for n, s in zip(names, structs) if g in s]
        ref_name, ref = have[0]
        for n, s in have[1:]:
            a, b = ref["contours"], s["contours"]
            if len(a) != len(b):
                probs.append(f"{len(a)} contours in {ref_name}, {len(b)} in {n}")
            else:
                for i, ((pa, ca, da), (pb, cb, db)) in enumerate(zip(a, b), 1):
                    if len(pa) != len(pb):
                        probs.append(f"contour {i}: {len(pa)} points in {ref_name}, {len(pb)} in {n}")
                    elif pa != pb:
                        probs.append(f"contour {i}: curve and corner points differ between {ref_name} and {n}")
                    elif ca != cb:
                        probs.append(f"contour {i}: open in one master, closed in the other ({n})")
                    elif da is not None and db is not None and da != db:
                        probs.append(f"contour {i}: runs the other way in {n}")
            if ref["refs"] != s["refs"]:
                probs.append(f"components differ: {' + '.join(ref['refs']) or 'none'} in {ref_name}, "
                             f"{' + '.join(s['refs']) or 'none'} in {n}")
            if ref["anchors"] != s["anchors"]:
                probs.append(f"anchors differ between {ref_name} and {n}")
        if probs:
            out[g] = probs
    return out


@app.get("/api/family/check")
def family_check(path: str):
    """Are the masters point-compatible? Reads each master as it is in
    memory (an open master is the same FontForge object, unsaved edits
    included), so the answer matches what the user sees."""
    fam = _family(path)
    names, structs = [], []
    for m in fam["masters"]:
        fid = _call("open", path=m["path"])["fid"]
        try:
            structs.append(_call("structure", fid=fid))
        finally:
            _call("close", fid=fid)
        names.append(m["name"])
    # compare against the default master
    default = next((i for i, m in enumerate(fam["masters"]) if _at_defaults(fam, m["location"])), 0)
    order = [default] + [i for i in range(len(names)) if i != default]
    bad = _compare_masters([names[i] for i in order], [structs[i] for i in order])
    # a brace layer's glyphs must have the default master's structure too
    for br in fam["braces"]:
        fid = _call("open", path=br["path"])["fid"]
        try:
            st = _call("structure", fid=fid)
        finally:
            _call("close", fid=fid)
        mine = {g: st[g] for g in br["glyphs"] if g in st}
        gone = [g for g in br["glyphs"] if g not in st]
        for g, probs in _compare_masters([names[default], br["name"]], [{k: v for k, v in structs[default].items() if k in mine}, mine]).items():
            bad.setdefault(g, []).extend(probs)
        for g in gone:
            bad.setdefault(g, []).append(f"missing in brace layer {br['name']}")
    return {"masters": names, "checked": len(set().union(*structs)) if structs else 0,
            "glyphs": [{"name": g, "problems": p} for g, p in bad.items()]}


class BlendReq(BaseModel):
    path: str  # the .designspace
    weight: float | None = None  # the Weight axis; other axes come from `location`, else their defaults
    location: dict[str, float] | None = None  # axis name -> value
    names: list[str] | None = None  # None: every glyph


class BlendMasterReq(BaseModel):
    path: str
    weight: float | None = None
    location: dict[str, float] | None = None
    style: str


def _master_data(fam, names=None):
    """Each master's point data, read from the font as it is in memory."""
    out = []
    for m in fam["masters"]:
        fid = _call("open", path=m["path"])["fid"]
        try:
            out.append(_call("point_data", fid=fid, names=names))
        finally:
            _call("close", fid=fid)
    return out


def _shape_of(d):
    """What must be identical across masters for a glyph to blend."""
    return (tuple(("".join(str(p[2]) for p in c), cl) for c, cl in zip(d["contours"], d["closed"])),
            tuple(r[0] for r in d["refs"]), tuple(tuple(a[:2]) + tuple(a[4:]) for a in d["anchors"]))


def _numbers(d):
    return ([d["width"]] + [v for c in d["contours"] for p in c for v in p[:2]]
            + [v for r in d["refs"] for v in r[1]] + [v for a in d["anchors"] for v in a[2:4]])


def _from_numbers(d, nums):
    it = iter(nums)
    width = next(it)
    contours = [[[next(it), next(it), p[2]] for p in c] for c in d["contours"]]
    refs = [[r[0], [next(it) for _ in r[1]]] for r in d["refs"]]
    anchors = [a[:2] + [next(it), next(it)] + a[4:] for a in d["anchors"]]
    return {"width": width, "contours": contours, "closed": d["closed"], "refs": refs, "anchors": anchors}


def _brace_data(fam, names=None):
    """(brace, point data) for each brace layer, only for the glyphs it covers."""
    out = []
    for br in fam["braces"]:
        want = [g for g in br["glyphs"] if names is None or g in names]
        if not want:
            continue
        fid = _call("open", path=br["path"])["fid"]
        try:
            out.append((br, _call("point_data", fid=fid, names=want)))
        finally:
            _call("close", fid=fid)
    return out


def _blend(fam, data, at, braces=()):
    """Every glyph at `at`, blended by fontTools' variation model (the same
    maths a variable font uses). None for glyphs whose masters don't match.
    A glyph with brace layers is blended over the masters and its braces.
    Locations and weights are fontTools'; only the weighted sum of each
    coordinate is done here."""
    from fontTools.varLib.models import VariationModel, normalizeLocation
    axes = {a["tag"]: (a["min"], a["default"], a["max"]) for a in fam["axes"]}
    tags = lambda loc: {a["tag"]: loc[a["name"]] for a in fam["axes"]}
    locs = [normalizeLocation(tags(m["location"]), axes) for m in fam["masters"]]
    locs += [normalizeLocation(tags(br["location"]), axes) for br, _ in braces]
    sources = list(data) + [d for _, d in braces]
    target = normalizeLocation(tags(at), axes)
    models = {}

    def scalars_for(idx):  # one model per set of sources a glyph has
        if idx not in models:
            try:
                models[idx] = VariationModel([locs[i] for i in idx], axisOrder=list(axes)).getMasterScalars(target)
            except Exception as e:  # e.g. no master sits at every axis' default
                raise HTTPException(400, f"these masters can't be blended: {e}")
        return models[idx]

    out = {}
    for name in set(data[0]).intersection(*data[1:]):
        idx = tuple(i for i, d in enumerate(sources) if name in d)
        ds = [sources[i][name] for i in idx]
        if any(_shape_of(x) != _shape_of(ds[0]) for x in ds[1:]):
            out[name] = None
            continue
        scalars = scalars_for(idx)
        vecs = [_numbers(x) for x in ds]
        out[name] = _from_numbers(ds[0], [sum(sc * v[i] for sc, v in zip(scalars, vecs)) for i in range(len(vecs[0]))])
    return out


@app.post("/api/family/blend")
def family_blend(req: BlendReq):
    """Glyphs as they would be at `weight` (for the weight slider preview)."""
    fam = _family(req.path)
    if len(fam["masters"]) < 2:
        raise HTTPException(400, "a family needs two masters to blend")
    # a glyph made of components (a nine turned from a six) has no contours of its own: blend what it is made of as well, then draw it out
    at = _at(fam, req.weight, req.location)
    if req.names is None:  # every glyph: the components are in there already
        out = _blend(fam, _master_data(fam), at, _brace_data(fam))
        return {n: _flatten(out, n) for n in out}
    names = set(req.names)
    for _ in range(4):
        data = _master_data(fam, sorted(names))
        more = {r[0] for d in data for g in d.values() for r in g["refs"]} - names
        if not more:
            break
        names |= more
    out = _blend(fam, data, at, _brace_data(fam, sorted(names)))
    return {n: _flatten(out, n) for n in req.names if n in out}


def _flatten(out, name, depth=0):
    """A blended glyph with its components drawn into its own contours (the matrix is FontForge's: x' = a x + c y + e, y' = b x + d y + f)."""
    g = out.get(name)
    if g is None:
        return None
    contours, closed = [list(map(list, c)) for c in g["contours"]], list(g["closed"])
    if depth < 8:
        for ref, m in g["refs"]:
            base = _flatten(out, ref, depth + 1)
            if base is None:
                continue
            a, b, c, d, e, f = m
            for pc, cl in zip(base["contours"], base["closed"]):
                contours.append([[a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f, *p[2:]] for p in pc])
                closed.append(cl)
    return {**g, "contours": contours, "closed": closed, "refs": []}


class PointEditReq(BaseModel):
    family: str
    master: str
    glyph: str
    contour: int
    index: int
    action: str  # delete | insert
    x: float = 0
    y: float = 0
    on: int = 1
    count: int = 1
    points: list[list[float]] | None = None


@app.post("/api/family/point-edit")
def family_point_edit(req: PointEditReq):
    """Delete or insert one point of a glyph in any master of the family (the fix for masters that do not match)."""
    fam = _family(req.family)
    m = next((m for m in fam["masters"] if os.path.normcase(os.path.abspath(m["path"])) == os.path.normcase(os.path.abspath(req.master))), None)
    if not m:
        raise HTTPException(400, f"not a master of this family: {req.master}")
    fid = _call("open", path=m["path"])["fid"]
    try:
        return _call("contour_point", fid=fid, name=req.glyph, contour=req.contour, index=req.index, action=req.action, x=req.x, y=req.y, on=req.on, count=req.count, points=req.points)
    finally:
        _call("close", fid=fid)


@app.get("/api/family/all-points")
def family_all_points(path: str, a: str, b: str):
    """Every glyph of two masters, as they are in memory, for the font-wide comparison."""
    fam = _family(path)
    known = {os.path.normcase(os.path.abspath(m["path"])): m for m in fam["masters"]}
    out = []
    for p in (a, b):
        m = known.get(os.path.normcase(os.path.abspath(p)))
        if not m:
            raise HTTPException(400, f"not a master of this family: {p}")
        fid = _call("open", path=m["path"])["fid"]
        try:
            data = _call("point_data", fid=fid)
        finally:
            _call("close", fid=fid)
        out.append({"name": m["name"], "path": m["path"], "glyphs": {n: {"width": g["width"], "contours": g["contours"], "closed": g["closed"], "refs": [r[0] for r in g["refs"]]} for n, g in data.items()}})
    return {"masters": out}


@app.get("/api/family/glyph-points")
def family_glyph_points(path: str, name: str):
    """One glyph's points in every master, as they are in memory: for comparing masters point by point."""
    fam = _family(path)
    out = []
    for m, d in zip(fam["masters"], _master_data(fam, [name])):
        g = d.get(name)
        out.append({"name": m["name"], "weight": m["weight"], "path": m["path"],
                    "glyph": None if g is None else {"width": g["width"], "contours": g["contours"], "closed": g["closed"],
                                                       "refs": [r[0] for r in g["refs"]]}})
    return {"masters": out}


class BlendKernReq(BaseModel):
    path: str
    weight: float | None = None
    location: dict[str, float] | None = None
    pairs: list[tuple[str, str]]


@app.post("/api/family/blend-kerning")
def family_blend_kerning(req: BlendKernReq):
    """Kerning of these pairs at `weight`: each master's own value, blended with the same weights as the outlines
    (the preview used the open master's kerning at every weight, so spacing jumped when the slider arrived at
    another master). {"left right": value}."""
    from fontTools.varLib.models import VariationModel, normalizeLocation
    fam = _family(req.path)
    if len(fam["masters"]) < 2:
        raise HTTPException(400, "a family needs two masters to blend")
    axes = {a["tag"]: (a["min"], a["default"], a["max"]) for a in fam["axes"]}
    tags = lambda loc: {a["tag"]: loc[a["name"]] for a in fam["axes"]}
    locs = [normalizeLocation(tags(m["location"]), axes) for m in fam["masters"]]
    try:
        scalars = VariationModel(locs, axisOrder=list(axes)).getMasterScalars(normalizeLocation(tags(_at(fam, req.weight, req.location)), axes))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"these masters can't be blended: {e}")
    totals = [0.0] * len(req.pairs)
    for sc, m in zip(scalars, fam["masters"]):
        fid = _call("open", path=m["path"])["fid"]
        try:
            vals = _call("kerning", fid=fid, pairs=[list(p) for p in req.pairs])
        finally:
            _call("close", fid=fid)
        for i, k in enumerate(vals):
            totals[i] += sc * k["value"]
    return {f"{l} {r}": round(t, 2) for (l, r), t in zip(req.pairs, totals)}


@app.post("/api/family/blend-master")
def family_blend_master(req: BlendMasterReq):
    """A new master at `weight`, made of the blend of the others, to adjust by
    hand. It starts as a copy of the nearest master (names, kerning,
    features, and any glyph that can't be blended), then every glyph that
    can be blended is replaced by its blend."""
    from fontTools.designspaceLib import DesignSpaceDocument
    fam = _family(req.path)
    style = " ".join(req.style.split())
    if not style or not all(c.isalnum() or c == " " for c in style):
        raise HTTPException(400, "style name: letters, digits and spaces")
    at = _at(fam, req.weight, req.location)
    if any(m["location"] == at for m in fam["masters"]):
        raise HTTPException(400, f"there is already a master at {_describe(at)}")
    blended = _blend(fam, _master_data(fam), at, _brace_data(fam))
    near = min(fam["masters"], key=lambda m: _distance(fam, m["location"], at))
    src = _call("open", path=near["path"])
    try:
        path = os.path.join(os.path.dirname(near["path"]), f"{src['familyname']}-{style}.sfd".replace(" ", ""))
        _call("duplicate_master", fid=src["fid"], path=path, style=style, weight=at["Weight"])
    finally:
        _call("close", fid=src["fid"])
    new = _call("open", path=path)["fid"]
    try:
        _call("set_point_data", fid=new, glyphs={n: g for n, g in blended.items() if g})
        _call("save", fid=new)
    finally:
        _call("close", fid=new)
    doc = DesignSpaceDocument.fromfile(req.path)
    doc.addSourceDescriptor(path=path, filename=os.path.relpath(path, os.path.dirname(req.path)),
                            familyName=src["familyname"], styleName=style, location=at)
    doc.write(req.path)
    return {"family": _family(req.path), "copied": sorted(n for n, g in blended.items() if g is None)}


class FamilyBuildReq(BaseModel):
    path: str  # the .designspace
    folder: str
    name: str
    variable: bool = True
    variable_woff2: bool = True
    statics: list[float] = []  # weights to write as ordinary (static) fonts
    formats: list[str] = ["otf", "ttf", "woff2"]  # for the static fonts
    hinting: str = "keep"


_WEIGHT_NAMES = [(100, "Thin"), (200, "ExtraLight"), (300, "Light"), (400, "Regular"), (500, "Medium"),
                 (600, "SemiBold"), (700, "Bold"), (800, "ExtraBold"), (900, "Black")]


def _describe(loc):
    return ", ".join(f"{k} {v:g}" for k, v in loc.items())


def _weight_name(fam, w):
    m = next((m for m in fam["masters"] if m["location"] == _at(fam, w)), None)
    return m["name"] if m else min(_WEIGHT_NAMES, key=lambda x: abs(x[0] - w))[1]


def _draw_points(data, name, pen, depth=0):
    """Draw a glyph exactly as its points are stored: an on-curve point after
    an on-curve point is a line, two off-curve points then an on-curve point
    a cubic curve. Components are drawn in place (decomposed)."""
    from fontTools.pens.transformPen import TransformPen
    d = data[name]
    for pts, closed in zip(d["contours"], d["closed"]):
        if not pts:
            continue
        k = next((i for i, p in enumerate(pts) if p[2]), 0)  # start on an on-curve point
        pts = pts[k:] + pts[:k]
        pen.moveTo(tuple(pts[0][:2]))
        rest = pts[1:] + ([pts[0]] if closed else [])
        offs = []
        for x, y, on in rest:
            if not on:
                offs.append((x, y))
            elif offs:
                pen.curveTo(*offs, (x, y))
                offs = []
            else:
                pen.lineTo((x, y))
        pen.closePath() if closed else pen.endPath()
    if depth < 8:
        for ref, xf in d["refs"]:
            if ref in data:
                _draw_points(data, ref, TransformPen(pen, xf), depth + 1)


def _outlines_from_points(font, data):
    """Replace a FontForge-compiled master's CFF outlines with ones written
    straight from the stored points (fontTools' charstring pen). FontForge's
    CFF output is optimised per font (a nearly straight curve may become a
    line, contours may share subroutines), so the same glyph can come out
    differently in two masters, and fontTools can't merge it. Written from
    the points, every master has exactly the structure the user drew.
    Everything else (names, features, kerning, metrics) stays FontForge's.
    CFF hints can't vary, so none are written."""
    from fontTools.pens.t2CharStringPen import T2CharStringPen
    cff = font["CFF "].cff
    top = cff[cff.fontNames[0]]
    cff.desubroutinize()
    cs = top.CharStrings
    private = top.Private
    for name in font.getGlyphOrder():
        if name not in data or name not in cs:
            continue
        pen = T2CharStringPen(data[name]["width"], None)
        _draw_points(data, name, pen)
        c = pen.getCharString(private=private, globalSubrs=cff.GlobalSubrs, optimize=False)
        cs[name] = c
    cff.remove_hints()


def _keep_glyphs(font, names):
    """Reduce a compiled master to .notdef and these glyphs: a sparse master."""
    from fontTools import subset
    opts = subset.Options()
    opts.notdef_outline = True
    opts.layout_features = []
    opts.hinting = False
    opts.glyph_names = True
    opts.name_IDs = ["*"]
    opts.drop_tables += ["GDEF", "GSUB", "GPOS", "kern"]  # a sparse master carries outlines and widths only
    sub = subset.Subsetter(opts)
    sub.populate(glyphs=[".notdef", *names])
    sub.subset(font)


def _build_variable(fam, tmp):
    """FontForge compiles every master; fontTools' varLib merges them. Cubic
    masters go through CFF, so the curves are never converted (FontForge's
    conversion to quadratic can come out differently per master), and the
    result is a CFF2 variable font. CFF hints can't vary, so they are left
    out. Any glyph varLib can't merge fails the build instead of being
    silently left static."""
    import logging
    from fontTools import varLib
    from fontTools.designspaceLib import DesignSpaceDocument
    import fontTools.subset.cff  # noqa: F401 -- adds CFFFontSet.remove_hints
    doc = DesignSpaceDocument.fromfile(fam["path"])
    for i, src in enumerate(doc.sources):
        info = _call("open", path=src.path)
        ext = ".ttf" if info["quadratic"] else ".otf"
        out = os.path.join(tmp, f"master{i}{ext}")
        try:
            _call("normalise_components", fid=info["fid"])  # same component order in every master
            _call("generate", fid=info["fid"], path=out, hinting="none")
            points = None if info["quadratic"] else _call("point_data", fid=info["fid"])
        finally:
            _call("close", fid=info["fid"])
        f = TTFont(out)
        if "CFF " in f:
            _outlines_from_points(f, points)
        src.font = f
    for j, br in enumerate(fam["braces"]):  # sparse masters: only the glyphs the brace layer gives a shape
        info = _call("open", path=br["path"])
        ext = ".ttf" if info["quadratic"] else ".otf"
        out = os.path.join(tmp, f"brace{j}{ext}")
        try:
            _call("generate", fid=info["fid"], path=out, hinting="none")
            points = None if info["quadratic"] else _call("point_data", fid=info["fid"], names=br["glyphs"])
        finally:
            _call("close", fid=info["fid"])
        f = TTFont(out)
        if "CFF " in f:
            _outlines_from_points(f, points)
        _keep_glyphs(f, br["glyphs"])
        doc.addSourceDescriptor(path=out, name=f"brace{j}", familyName=br["name"], styleName=br["name"], location=br["location"])
        doc.sources[-1].font = f
    doc.instances = []
    for m in fam["masters"]:
        doc.addInstanceDescriptor(familyName=doc.sources[0].familyName, styleName=m["name"], location=m["location"])

    class Catch(logging.Handler):
        def __init__(self):
            super().__init__(logging.WARNING)
            self.msgs = []

        def emit(self, r):
            self.msgs.append(r.getMessage())

    catch, log = Catch(), logging.getLogger("fontTools.varLib")
    log.addHandler(catch)
    try:
        vf, _, _ = varLib.build(doc)
    finally:
        log.removeHandler(catch)
    skipped = [m for m in catch.msgs if "incompatible" in m]
    if skipped:
        raise HTTPException(400, "fontTools couldn't merge: " + "; ".join(skipped[:10]))
    return vf


def _build_static(fam, w, folder, name, formats, hinting, tmp):
    """One ordinary font at weight `w`: a master as it is, or else the blend
    written into a copy of the nearest master; FontForge writes the files."""
    import shutil
    style = _weight_name(fam, w)
    at = _at(fam, w)
    master = next((m for m in fam["masters"] if m["location"] == at), None)
    if master:
        fid = _call("open", path=master["path"])["fid"]
    else:
        near = min(fam["masters"], key=lambda m: _distance(fam, m["location"], at))
        copy = os.path.join(tmp, f"static-{w:g}.sfd")
        shutil.copyfile(near["path"], copy)
        fid = _call("open", path=copy)["fid"]
        blended = _blend(fam, _master_data(fam), at, _brace_data(fam))
        _call("set_point_data", fid=fid, glyphs={n: g for n, g in blended.items() if g})
        info = _call("info", fid=fid)
        _call("set_font_info", fid=fid, fields={
            "fontname": f"{info['familyname']}-{style}".replace(" ", ""), "fullname": f"{info['familyname']} {style}",
            "weight": style, "os2_weight": int(round(w))})
    _call("link_style", fid=fid, style=style, weight=w)  # 400 Regular, 700 Bold, the rest their own family
    out = []
    try:
        for fmt in formats:
            res = _call("generate", fid=fid, path=os.path.join(folder, f"{name}-{style}.{fmt}".replace(" ", "")), hinting=hinting)
            res.update(_verify_ttf(res["path"], expect_fvar=False))
            out.append(res)
    finally:
        _call("close", fid=fid)
    return out


@app.post("/api/family/build")
def family_build(req: FamilyBuildReq):
    """The family as a variable font and/or static weights, each file read
    back by fontTools. Refused while any glyph's masters don't match."""
    import tempfile
    fam = _family(req.path)
    if len(fam["masters"]) < 2:
        raise HTTPException(400, "a family needs two masters to make a variable font")
    if not os.path.isdir(req.folder):
        raise HTTPException(400, f"not a folder: {req.folder}")
    name = req.name.strip()
    if not name or any(c in name for c in '\\/:*?"<>|'):
        raise HTTPException(400, "file name is empty or has characters a file name can't have")
    if any(f not in ("otf", "ttf", "woff", "woff2") for f in req.formats):
        raise HTTPException(400, "formats: otf, ttf, woff, woff2")
    ax = next((a for a in fam["axes"] if a["name"] == "Weight"), fam["axes"][0])
    if any(not ax["min"] <= w <= ax["max"] for w in req.statics):
        raise HTTPException(400, f"static weights must be between {ax['min']:g} and {ax['max']:g}")
    bad = family_check(req.path)["glyphs"]
    if bad:
        raise HTTPException(400, f"{len(bad)} glyphs don't match across masters, e.g. "
                                 + ", ".join(g["name"] for g in bad[:8]) + " (see the compatibility check)")
    out = []
    with tempfile.TemporaryDirectory(prefix="scrifts-vf-") as tmp:
        if req.variable:
            vf = _build_variable(fam, tmp)
            ext = ".otf" if "CFF2" in vf else ".ttf"
            path = os.path.join(req.folder, f"{name}-VF{ext}")
            vf.save(path)
            out.append({"path": path, "size": os.path.getsize(path), **_verify_ttf(path, expect_fvar=True)})
            if req.variable_woff2:
                vf.flavor = "woff2"
                wpath = os.path.join(req.folder, f"{name}-VF.woff2")
                vf.save(wpath)
                out.append({"path": wpath, "size": os.path.getsize(wpath), **_verify_ttf(wpath, expect_fvar=True)})
        for w in sorted(set(req.statics)):
            out += _build_static(fam, w, req.folder, name, req.formats, req.hinting, tmp)
    return out


class CopyGlyphReq(BaseModel):
    source: str        # master .sfd to copy from
    targets: list[str]  # masters to copy into
    names: list[str]


class RemoveMasterReq(BaseModel):
    path: str    # the .designspace
    master: str  # the master's .sfd


@app.post("/api/family/copy-glyph")
def family_copy_glyph(req: CopyGlyphReq):
    """Copy glyphs (outlines, components, anchors, advance width) from one
    master into others, as they are in memory. The quickest way to make a
    glyph's masters match again: copy, then reshape by moving points."""
    fid = _call("open", path=req.source)["fid"]
    try:
        data = _call("point_data", fid=fid, names=req.names)
    finally:
        _call("close", fid=fid)
    missing = sorted(set(req.names) - set(data))
    if missing:
        raise HTTPException(400, f"not in the source master: {', '.join(missing)}")
    for t in req.targets:
        info = _call("open", path=t)
        try:
            _call("set_point_data", fid=info["fid"], glyphs=data)
        finally:
            _call("close", fid=info["fid"])
    return {"copied": sorted(data), "into": len(req.targets)}


@app.post("/api/family/remove")
def family_remove(req: RemoveMasterReq):
    """Take a master out of the family. Its .sfd stays on disk; only the
    family file changes. The axis range follows the masters that are left,
    and if the default master goes, the nearest one becomes the default."""
    from fontTools.designspaceLib import DesignSpaceDocument
    doc = DesignSpaceDocument.fromfile(req.path)
    key = os.path.normcase(os.path.abspath(req.master))
    gone = [s for s in doc.sources if os.path.normcase(os.path.abspath(s.path)) == key]
    if not gone:
        raise HTTPException(404, f"not a master of this family: {req.master}")
    if len(doc.sources) == 1:
        raise HTTPException(400, "a family needs at least one master")
    doc.sources.remove(gone[0])
    for axis in doc.axes:  # every axis follows the masters that are left
        vs = [s.location.get(axis.name, axis.default) for s in doc.sources]
        if axis.default not in vs:
            axis.default = min(vs, key=lambda v: abs(v - axis.default))
        axis.minimum, axis.maximum = min(vs), max(vs)
    doc.write(req.path)
    return _family(req.path)


class EditMasterReq(FontReq):
    family: str  # the .designspace
    master: str  # the master's .sfd; `fid` is that master, open
    style: str | None = None
    weight: float | None = None  # on the Weight axis


@app.post("/api/family/edit-master")
def family_edit_master(req: EditMasterReq):
    """Rename a master's style and/or move it to another weight. The font itself follows (its names and
    weight class, by FontForge's own style linking) and so does the family file: the axis range follows the
    masters and braces, and the default stays on this master if it was its. The .sfd keeps its file name."""
    from fontTools.designspaceLib import DesignSpaceDocument
    doc = DesignSpaceDocument.fromfile(req.family)
    key = os.path.normcase(os.path.abspath(req.master))
    src = next((s for s in doc.sources if os.path.normcase(os.path.abspath(s.path)) == key), None)
    if src is None:
        raise HTTPException(404, f"not a master of this family: {req.master}")
    info = _call("info", fid=req.fid)
    if os.path.normcase(os.path.abspath(info["path"])) != key:
        raise HTTPException(400, "open that master first")
    style = " ".join((req.style if req.style is not None else src.styleName).split())
    if not style or not all(c.isalnum() or c == " " for c in style):
        raise HTTPException(400, "style name: letters, digits and spaces")
    axes = {a.name: a for a in doc.axes}
    old = {n: src.location.get(n, a.default) for n, a in axes.items()}
    new = {**old, **({"Weight": req.weight} if req.weight is not None else {})}
    if any(s is not src and {n: s.location.get(n, a.default) for n, a in axes.items()} == new for s in doc.sources):
        raise HTTPException(400, f"there is already a master at {_describe(new)}")
    _call("set_master_style", fid=req.fid, style=style, weight=new["Weight"])
    was_default = old.get("Weight") == axes["Weight"].default
    src.styleName, src.location = style, new
    ws = [s.location.get("Weight", axes["Weight"].default) for s in doc.sources] + [b["weight"] for b in _braces(doc)]
    w = axes["Weight"]
    w.minimum, w.maximum = min(ws), max(ws)
    if was_default:
        w.default = new["Weight"]
    w.default = min(max(w.default, w.minimum), w.maximum)
    doc.write(req.family)
    return _family(req.family)


@app.post("/api/family/add")
def family_add(req: FamilyAddReq):
    """Duplicate the open master as a new master at `weight`, saved next to it."""
    from fontTools.designspaceLib import DesignSpaceDocument
    style = " ".join(req.style.split())
    if not style or not all(c.isalnum() or c == " " for c in style):
        raise HTTPException(400, "style name: letters, digits and spaces")
    doc = DesignSpaceDocument.fromfile(req.family)
    fam = _family(req.family)
    # a new master may lie beyond the current range of any axis: the range grows to take it
    loc = {a["name"]: a["default"] for a in fam["axes"]}
    for k, v in {**(req.location or {}), **({"Weight": req.weight} if req.weight is not None else {})}.items():
        if k not in loc:
            raise HTTPException(400, f"this family has no axis called {k}")
        loc[k] = v
    if any(m["location"] == loc for m in fam["masters"]):
        raise HTTPException(400, f"there is already a master at {_describe(loc)}")
    info = _call("info", fid=req.fid)
    folder = os.path.dirname(info["path"])
    path = os.path.join(folder, f"{info['familyname']}-{style}.sfd".replace(" ", ""))
    _call("duplicate_master", fid=req.fid, path=path, style=style, weight=loc["Weight"])
    doc.addSourceDescriptor(path=path, filename=os.path.relpath(path, os.path.dirname(req.family)),
                            familyName=info["familyname"], styleName=style, location=loc)
    for axis in doc.axes:
        axis.minimum, axis.maximum = min(axis.minimum, loc[axis.name]), max(axis.maximum, loc[axis.name])
    doc.write(req.family)
    return _family(req.family)


class BraceReq(BaseModel):
    path: str  # the .designspace
    glyph: str
    weight: float | None = None
    location: dict[str, float] | None = None


class BraceRemoveReq(BaseModel):
    path: str
    brace: str  # the brace's .sfd
    glyph: str | None = None  # None: the whole brace layer


@app.post("/api/family/brace")
def family_brace(req: BraceReq):
    """Give `glyph` its own shape at this location: it is added to the brace
    layer there (made, as a copy of the nearest master, if there is none yet),
    starting from what the masters blend to, to reshape by moving points."""
    from fontTools.designspaceLib import DesignSpaceDocument
    fam = _family(req.path)
    if len(fam["masters"]) < 2:
        raise HTTPException(400, "a family needs two masters before a glyph can have brace layers")
    at = _at(fam, req.weight, req.location)
    if any(m["location"] == at for m in fam["masters"]):
        raise HTTPException(400, f"there is a master at {_describe(at)}: edit the glyph there instead")
    br = next((b for b in fam["braces"] if b["location"] == at), None)
    if br and req.glyph in br["glyphs"]:
        raise HTTPException(400, f"{req.glyph} already has a brace layer at {_describe(at)}")
    start = _blend(fam, _master_data(fam, [req.glyph]), at, _brace_data(fam, [req.glyph])).get(req.glyph)
    if start is None:
        raise HTTPException(400, f"{req.glyph} can't be blended (its masters don't match, or it is missing): fix that first")
    doc = DesignSpaceDocument.fromfile(req.path)
    if not br:
        near = min(fam["masters"], key=lambda m: _distance(fam, m["location"], at))
        src = _call("open", path=near["path"])
        label = "Brace " + " ".join(f"{v:g}" for v in at.values())
        try:
            path = os.path.join(os.path.dirname(near["path"]), f"{src['familyname']}-{label}.sfd".replace(" ", ""))
            if os.path.exists(path):
                raise HTTPException(400, f"a file already exists there: {path}")
            _call("duplicate_master", fid=src["fid"], path=path, style=label, weight=at["Weight"])
        finally:
            _call("close", fid=src["fid"])
        br = {"path": os.path.normpath(path), "name": label, "weight": at["Weight"], "location": at, "glyphs": []}
        fam["braces"].append(br)
    fid = _call("open", path=br["path"])["fid"]
    try:
        _call("set_point_data", fid=fid, glyphs={req.glyph: start})
        _call("save", fid=fid)
    finally:
        _call("close", fid=fid)
    if req.glyph not in br["glyphs"]:
        br["glyphs"].append(req.glyph)
    _save_braces(doc, req.path, fam["braces"])
    return _family(req.path)


@app.post("/api/family/brace/remove")
def family_brace_remove(req: BraceRemoveReq):
    """Drop a glyph from a brace layer, or the whole layer (its .sfd stays on disk)."""
    from fontTools.designspaceLib import DesignSpaceDocument
    fam = _family(req.path)
    key = os.path.normcase(os.path.abspath(req.brace))
    br = next((b for b in fam["braces"] if os.path.normcase(os.path.abspath(b["path"])) == key), None)
    if not br:
        raise HTTPException(404, f"not a brace layer of this family: {req.brace}")
    if req.glyph:
        if req.glyph not in br["glyphs"]:
            raise HTTPException(404, f"{req.glyph} isn't in that brace layer")
        br["glyphs"].remove(req.glyph)
    if not req.glyph or not br["glyphs"]:
        fam["braces"].remove(br)
    _save_braces(DesignSpaceDocument.fromfile(req.path), req.path, fam["braces"])
    return _family(req.path)


@app.post("/api/family/axis")
def family_axis(req: AxisReq):
    """Add an axis (Width, Optical size, a custom one). Every existing master
    sits at the axis' default; add masters at its ends to give it meaning."""
    from fontTools.designspaceLib import DesignSpaceDocument
    doc = DesignSpaceDocument.fromfile(req.family)
    name = " ".join(req.name.split())
    if not name or not all(c.isalnum() or c == " " for c in name):
        raise HTTPException(400, "axis name: letters, digits and spaces")
    if not (len(req.tag) == 4 and req.tag.isascii() and req.tag.isalnum()):
        raise HTTPException(400, "axis tag: four letters or digits (wdth, opsz, or an uppercase custom tag like XTRA)")
    if any(a.name == name or a.tag == req.tag for a in doc.axes):
        raise HTTPException(400, "this family already has an axis with that name or tag")
    if not req.min <= req.default <= req.max or req.min == req.max:
        raise HTTPException(400, "axis range: minimum <= default <= maximum, and the range can't be empty")
    doc.addAxisDescriptor(name=name, tag=req.tag, minimum=req.min, default=req.default, maximum=req.max)
    for src in doc.sources:
        src.location[name] = req.default
    doc.write(req.family)
    return _family(req.family)


def _verify_ttf(path, expect_fvar):
    """Re-read an exported font with fontTools; fail loudly if it is not sane."""
    with TTFont(path) as f:  # closed again: Windows will not let an open file be replaced or deleted
        has = "fvar" in f
        if has != expect_fvar:
            raise HTTPException(500, f"export check failed: fvar present={has}, expected {expect_fvar}")
        # Force every table to decompile; a broken table raises here.
        for tag in f.keys():
            f[tag]
        return {"path": path, "glyphs": len(f.getGlyphOrder()), "tables": sorted(f.keys())}


@app.post("/api/export/instance")
def export_instance(req: InstanceReq):
    v = variables.get(req.fid)
    if not v:
        raise HTTPException(400, "this font is not variable (or is no longer open)")
    full = {a["tag"]: req.location.get(a["tag"], a["default"]) for a in v.axes}
    inst = instancer.instantiateVariableFont(TTFont(v.path), full, updateFontNames=False)
    inst.save(req.path)
    res = _verify_ttf(req.path, expect_fvar=False)
    res["outline_check"] = _compare_instance(req.path, v, full)
    return res


def _compare_instance(path, var, location, tolerance=1.0):
    """Every encoded glyph of the exported static font must have the outline
    the preview showed at `location`, to within rounding. Advance mismatches
    are reported, not fatal: they happen when a font's HVAR and gvar phantom
    points disagree (HarfBuzz and the preview follow HVAR, the instancer
    follows gvar) -- a defect in the source font, not in the export."""
    from fontTools.pens.recordingPen import DecomposingRecordingPen

    static = TTFont(path)
    a, b = static.getGlyphSet(), var.font.getGlyphSet(location=location)
    names = sorted(set(static.getBestCmap().values()))
    bad, advance = [], []
    for n in names:
        pa, pb = DecomposingRecordingPen(a), DecomposingRecordingPen(b)
        a[n].draw(pa)
        b[n].draw(pb)
        same = len(pa.value) == len(pb.value) and all(
            oa == ob and all(abs(x - y) <= tolerance for p, q in zip(va, vb) for x, y in zip(p, q))
            for (oa, va), (ob, vb) in zip(pa.value, pb.value))
        if not same:
            bad.append(n)
        elif abs(a[n].width - b[n].width) > tolerance:
            advance.append({"glyph": n, "exported": a[n].width, "preview": b[n].width})
    if bad:
        raise HTTPException(500, f"export check failed: {len(bad)} outlines differ from preview, e.g. {bad[:5]}")
    return {"glyphs_checked": len(names), "tolerance_units": tolerance, "advance_mismatches": advance}


@app.post("/api/export/variable")
def export_variable(req: VariableReq):
    v = variables.get(req.fid)
    if not v:
        raise HTTPException(400, "this font is not variable (or is no longer open)")
    TTFont(v.path).save(req.path)
    return _verify_ttf(req.path, expect_fvar=True)


def _variation_peaks(v, axes, base):
    """Where the font's gvar regions peak, as full user-space locations: each is a master the designer drew (a peak between the
    default and an axis end is an in-between master). Regions are in normalised units, after avar, so undo both."""
    font = v.font
    if "gvar" not in font:
        return []
    from fontTools.varLib.models import piecewiseLinearMap
    segs = font["avar"].segments if "avar" in font else {}
    out = []
    by_tag = {a["tag"]: a for a in axes}
    seen = set()
    for variations in font["gvar"].variations.values():
        for var in variations:
            key = tuple(sorted((t, tuple(r)) for t, r in var.axes.items()))
            if key in seen:
                continue
            seen.add(key)
            loc = dict(base)
            for tag, (_lo, peak, _hi) in var.axes.items():
                a = by_tag.get(tag)
                if not a or peak == 0:
                    continue
                if tag in segs and segs[tag]:
                    peak = piecewiseLinearMap(peak, {to: frm for frm, to in segs[tag].items()})
                val = round(a["default"] + peak * ((a["max"] - a["default"]) if peak > 0 else (a["default"] - a["min"])), 2)
                loc[tag] = float(round(val)) if abs(val - round(val)) < 0.05 else val  # normalised units are stored in 14 bits: 399.98 means 400
            out.append(loc)
    return out


def _ordered_axes(v):
    return sorted(v.axes, key=lambda a: a["tag"] != "wght")  # the weight axis first: the family code expects that


def _split_plan(v):
    """The masters a variable font splits into, as [(location, style name)]: the default, every place its gvar regions peak
    (the in-between masters it was drawn with) and each axis end. Names come from the font's named instances when one sits there."""
    axes = _ordered_axes(v)
    base = {a["tag"]: a["default"] for a in axes}
    locations = [dict(base)]
    for loc in _variation_peaks(v, axes, base):
        if loc not in locations:
            locations.append(loc)
    for a in axes:
        for end in (a["min"], a["max"]):
            loc = {**base, a["tag"]: end}
            if end != a["default"] and loc not in locations:
                locations.append(loc)
    named = {tuple(sorted(i["location"].items())): i["name"] for i in v.instances}

    def style_of(loc):
        hit = named.get(tuple(sorted((t, loc[t]) for t in loc)))
        if hit:
            return hit
        moved = [a for a in axes if loc[a["tag"]] != a["default"]]
        return "".join(f"{a['name']}{loc[a['tag']]:g}" for a in moved).replace(" ", "") or "Regular"

    out, styles = [], set()
    for i, loc in enumerate(locations):
        style = style_of(loc)
        if style in styles:
            style = f"{style}{i}"
        styles.add(style)
        out.append((loc, style))
    return out


@app.get("/api/variable/keyframes")
def variable_keyframes(fid: int):
    """Where the open variable font was drawn: the masters "Edit as masters" would make, each with its location."""
    v = variables.get(fid)
    if not v:
        raise HTTPException(400, "this font is not variable (or is no longer open)")
    return [{"name": style, "location": loc} for loc, style in _split_plan(v)]


class SplitReq(FontReq):
    path: str  # where the user chose to save: its name becomes the project folder, the family file and the masters' names


@app.post("/api/family/split")
def family_split(req: SplitReq):
    """Turn the open variable font into a family you can edit: a project folder with one .sfd per master (the default, each axis
    at its two ends, and every in-between master the font was drawn with) and a .designspace. Scrifts then blends the masters live, as for any family.
    The axis mapping (avar) is not carried over."""
    import shutil
    import tempfile
    from fontTools.designspaceLib import DesignSpaceDocument

    v = variables.get(req.fid)
    if not v:
        raise HTTPException(400, "this font is not variable (or is no longer open)")
    stem = os.path.basename(req.path.strip().strip('"'))
    for ext in (".designspace", ".sfd"):
        if stem.lower().endswith(ext):
            stem = stem[:-len(ext)]
    stem = "".join(c for c in stem.strip() if c not in '<>:"/\\|?*').strip(" .")
    parent = os.path.dirname(os.path.abspath(req.path.strip().strip('"')))
    if not stem:
        raise HTTPException(400, "give the project a name")
    if not os.path.isdir(parent):
        raise HTTPException(404, f"no such folder: {parent}")
    folder = os.path.join(parent, stem)
    if os.path.isdir(folder) and os.listdir(folder):
        raise HTTPException(400, f"{folder} already has files in it: pick another name")

    axes = _ordered_axes(v)
    plan = _split_plan(v)

    os.makedirs(folder, exist_ok=True)
    doc = DesignSpaceDocument()
    for a in axes:
        doc.addAxisDescriptor(name="Weight" if a["tag"] == "wght" else a["name"], tag=a["tag"],
                              minimum=a["min"], default=a["default"], maximum=a["max"])
    name_of = {a["tag"]: "Weight" if a["tag"] == "wght" else a["name"] for a in axes}
    family_name = v.font["name"].getDebugName(16) or v.font["name"].getDebugName(1) or stem
    made = []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            for i, (loc, style) in enumerate(plan):
                inst = instancer.instantiateVariableFont(TTFont(v.path), loc, updateFontNames=False)
                ttf = os.path.join(tmp, f"{i}.ttf")
                inst.save(ttf)
                sfd = os.path.join(folder, f"{stem}-{style}.sfd".replace(" ", ""))
                fid = _call("open", path=ttf)["fid"]
                try:
                    _call("set_font_info", fid=fid, fields={"familyname": family_name})
                    _call("link_style", fid=fid, style=style, weight=loc.get("wght", 400))
                    _call("save", fid=fid, path=sfd)
                finally:
                    _call("close", fid=fid)
                doc.addSourceDescriptor(path=sfd, filename=os.path.basename(sfd), familyName=family_name, styleName=style,
                                        location={name_of[t]: x for t, x in loc.items()})
                made.append(sfd)
        ds = os.path.join(folder, stem + ".designspace")
        doc.write(ds)
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)  # a half-made project: never leave it behind (the folder was empty or new)
        raise
    return {"designspace": ds, "default": made[0], "masters": made, "folder": folder}
