"""Glyphs (.glyphs) files in and out, through glyphsLib (Apache-2.0, Google Fonts).

Import turns a .glyphs file into what Scrifts already works with: one .sfd per
master plus a .designspace, in a project folder next to the file
(`<name>.forge/`). The .glyphs file itself is never changed, and reopening it
opens the project as it is now, so edits made in Scrifts are not overwritten.

What does not survive yet, and is reported instead of dropped silently:
 - bracket layers (alternate shapes over part of an axis)
 - axis mappings (Glyphs' user-space to design-space curve): locations are
   converted to user space and the mapping is kept in the designspace lib
"""
import logging
import os
import shutil

AXIS_MAPS_KEY = "com.forge.axisMaps"
BRACES_KEY = "com.forge.braces"  # the same list server._family reads: brace layers (sparse masters)


def project_folder(glyphs_path: str) -> str:
    base = os.path.splitext(os.path.abspath(glyphs_path))[0]
    return base + ".forge"


def import_glyphs(glyphs_path: str, convert_ufo) -> dict:
    """Make the Scrifts project for a .glyphs file (or find it if it was made before).

    `convert_ufo(ufo_path, sfd_path)` writes a UFO as an .sfd (FontForge does that
    part, in the worker). Returns {folder, designspace | None, masters: [sfd paths],
    default: sfd path, skipped: [names], reused: bool}.
    """
    import glyphsLib
    from fontTools.designspaceLib import DesignSpaceDocument

    folder = project_folder(glyphs_path)
    stem = os.path.splitext(os.path.basename(glyphs_path))[0]
    ds_path = os.path.join(folder, stem + ".designspace")
    if os.path.isdir(folder):
        existing = _read_project(folder, ds_path)
        if existing:
            return {**existing, "reused": True}
        if any(f.lower().endswith(".sfd") for f in os.listdir(folder)):  # fonts someone may have worked on: never delete those
            raise ValueError(f"{folder} holds fonts but no family file: put its .designspace back, or move the folder away to import again")
        shutil.rmtree(folder)  # a half-made project from an interrupted import: start over

    logging.disable(logging.CRITICAL)  # glyphsLib warns about every unresolved kerning group
    try:
        os.makedirs(folder)
        built = glyphsLib.build_masters(glyphs_path, folder)
    finally:
        logging.disable(logging.NOTSET)
    doc = DesignSpaceDocument.fromfile(built.designspace_path)

    skipped = []
    full = [s for s in doc.sources if not s.layerName]
    layer_sources = [s for s in doc.sources if s.layerName]
    sfd_of = {}
    for src in full:
        ufo = os.path.normpath(src.path)
        sfd = os.path.splitext(ufo)[0] + ".sfd"
        if ufo not in sfd_of:
            convert_ufo(ufo, sfd)
            sfd_of[ufo] = sfd

    if len(doc.axes) == 0 or len(set(sfd_of.values())) == 1:
        only = next(iter(sfd_of.values()))
        return {"folder": folder, "designspace": None, "masters": [only], "default": only, "skipped": skipped, "reused": False}

    # Scrifts keeps locations in user space on unmapped axes: convert, and remember the mapping
    to_user = lambda src: {a.name: (a.map_backward(src.location[a.name]) if a.name in src.location else a.default) for a in doc.axes}
    braces = []
    for src in layer_sources:  # Glyphs' intermediate layers: a few glyphs with their own shape between masters
        try:
            braces.append(_brace_from_layer(src, to_user(src), folder, convert_ufo))
        except Exception as e:  # noqa: BLE001 -- one odd layer must not stop the import
            skipped.append(f"{src.layerName} ({type(e).__name__})")
    maps = {a.name: [list(p) for p in a.map] for a in doc.axes if a.map}
    for src in full:
        src.location = to_user(src)
    for a in doc.axes:
        a.map = []
    doc.sources = full
    for src in full:
        sfd = sfd_of[os.path.normpath(src.path)]
        src.path = sfd
        src.filename = os.path.relpath(sfd, folder)
    doc.instances = []
    doc.lib[AXIS_MAPS_KEY] = maps
    if braces:
        doc.lib[BRACES_KEY] = [{"path": os.path.relpath(b["sfd"], folder), "name": b["name"], "location": b["location"], "glyphs": b["glyphs"]} for b in braces]
    doc.write(ds_path)
    for ufo in sfd_of:  # the UFOs were only the way across
        shutil.rmtree(ufo, ignore_errors=True)
    return {**_read_project(folder, ds_path), "skipped": skipped, "braces": len(braces), "reused": False}


def _brace_from_layer(src, location: dict, folder: str, convert_ufo) -> dict:
    """An intermediate layer of a master UFO as a sparse brace master: a font holding that layer's
    glyphs (plus whatever they are built from, so components resolve); only the layer's glyphs count."""
    import copy
    import ufoLib2
    parent = ufoLib2.Font.open(os.path.normpath(src.path))
    layer = parent.layers[src.layerName]
    names = [g.name for g in layer]
    needed, todo = set(names), list(names)
    while todo:  # a glyph built from components needs them present
        n = todo.pop()
        g = layer[n] if n in layer else parent.layers.defaultLayer[n]
        for c in g.components:
            if c.baseGlyph not in needed:
                needed.add(c.baseGlyph)
                todo.append(c.baseGlyph)
    brace = ufoLib2.Font()
    brace.info = copy.deepcopy(parent.info)
    label = "Brace " + " ".join(f"{v:g}" for v in location.values())
    brace.info.styleName = label
    for n in sorted(needed):
        brace.layers.defaultLayer.insertGlyph(layer[n] if n in layer else parent.layers.defaultLayer[n], n, copy=True)
    family = (parent.info.familyName or "Font").replace(" ", "")
    ufo = os.path.join(folder, f"{family}-{label.replace(' ', '')}.ufo")
    brace.save(ufo, overwrite=True)
    sfd = os.path.splitext(ufo)[0] + ".sfd"
    convert_ufo(ufo, sfd)
    shutil.rmtree(ufo, ignore_errors=True)
    return {"sfd": sfd, "name": label, "location": location, "glyphs": names}


def _read_project(folder: str, ds_path: str):
    from fontTools.designspaceLib import DesignSpaceDocument
    if os.path.isfile(ds_path):
        doc = DesignSpaceDocument.fromfile(ds_path)
        masters = [os.path.normpath(s.path) for s in doc.sources]
        default = next((os.path.normpath(s.path) for s in doc.sources
                        if all(s.location.get(a.name, a.default) == a.default for a in doc.axes)), masters[0])
        return {"folder": folder, "designspace": os.path.normpath(ds_path), "masters": masters, "default": default, "skipped": []}
    sfds = sorted(f for f in os.listdir(folder) if f.lower().endswith(".sfd"))
    if len(sfds) == 1:
        p = os.path.join(folder, sfds[0])
        return {"folder": folder, "designspace": None, "masters": [p], "default": p, "skipped": []}
    return None


def export_glyphs(target: str, masters, locations=None, axes=None, convert_sfd=None):
    """Write a .glyphs file from Scrifts masters.

    masters: .sfd paths; for a family also `axes` ([{name, tag, min, default, max}], user space), `locations`
    (one {axis name: user value} per master) and the axis maps kept at import (see AXIS_MAPS_KEY), so the
    Glyphs weight curve comes back. `convert_sfd(sfd_path, ufo_path)` has FontForge write a UFO.
    """
    import glyphsLib
    import tempfile
    from fontTools.designspaceLib import DesignSpaceDocument
    tmp = tempfile.mkdtemp(prefix="scrifts-glyphs-")
    try:
        ufos = []
        for i, sfd in enumerate(masters):
            ufo = os.path.join(tmp, f"{i}-{os.path.splitext(os.path.basename(sfd))[0]}.ufo")
            convert_sfd(sfd, ufo)
            ufos.append(ufo)
        logging.disable(logging.CRITICAL)
        try:
            if axes and len(masters) > 1:
                doc = DesignSpaceDocument()
                for a in axes:
                    doc.addAxisDescriptor(name=a["name"], tag=a["tag"], minimum=a["min"], default=a["default"], maximum=a["max"],
                                          map=[tuple(p) for p in a.get("map", [])])
                for ufo, loc, sfd in zip(ufos, locations, masters):
                    doc.addSourceDescriptor(path=ufo, location={a["name"]: _design(a, loc[a["name"]]) for a in axes},
                                            familyName=None, styleName=os.path.splitext(os.path.basename(sfd))[0])
                font = glyphsLib.to_glyphs(doc)
            else:
                import ufoLib2
                font = glyphsLib.to_glyphs([ufoLib2.Font.open(ufos[0])])
        finally:
            logging.disable(logging.NOTSET)
        font.save(target)
        return {"path": target, "masters": len(masters)}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _design(axis: dict, user: float) -> float:
    """A user-space value on an axis, in the design space its saved map describes (identity without one)."""
    pts = sorted(tuple(p) for p in axis.get("map", []))
    if not pts:
        return user
    if user <= pts[0][0]:
        return pts[0][1]
    for (u0, d0), (u1, d1) in zip(pts, pts[1:]):
        if user <= u1:
            return d0 + (d1 - d0) * (user - u0) / (u1 - u0)
    return pts[-1][1]
