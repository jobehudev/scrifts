"""Getting drawings in and out: tracing pictures, template sheets, artboards, outline import."""

import os

from fastapi import HTTPException, Response
from pydantic import BaseModel

from core import FontReq, GlyphReq, _call, app


class ImportReq(GlyphReq):
    path: str
    flags: list[str] = []


IMPORT_FLAGS = {"correctdir", "removeoverlap", "handle_eraser", "toobigwarn"}


@app.post("/api/import")
def import_outlines(req: ImportReq):
    bad = set(req.flags) - IMPORT_FLAGS
    if bad:
        raise HTTPException(400, f"unknown import flags {sorted(bad)}; allowed {sorted(IMPORT_FLAGS)}")
    if not os.path.isfile(req.path):
        raise HTTPException(404, f"No such file: {req.path}")
    return _call("import_outlines", fid=req.fid, name=req.name, path=req.path, flags=req.flags)


# ---------------------------------------------------------------- tracing pictures and template sheets

IMAGE_TYPES = (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff", ".webp")


MAX_SIDE = 1600  # a single picture is shrunk to this for tracing (the preview and the trace see the same pixels)


MIN_SIDE = 800   # and a tiny one scaled up to this


def _picture(path: str, shrink: bool = True):
    from PIL import Image, ImageOps
    if not path.lower().endswith(IMAGE_TYPES) or not os.path.isfile(path):
        raise HTTPException(404, f"Not a picture file: {path}")
    try:
        img = ImageOps.exif_transpose(Image.open(path))  # phone photos carry their rotation in the metadata
        img.load()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, f"Could not read the picture: {e}") from e
    if shrink and not MIN_SIDE <= max(img.size) <= MAX_SIDE:
        # big pictures are shrunk, tiny ones scaled up: the curves are fitted to pixels, so more pixels give smoother curves
        s = (MAX_SIDE if max(img.size) > MAX_SIDE else MIN_SIDE) / max(img.size)
        img = img.resize((round(img.width * s), round(img.height * s)), Image.Resampling.LANCZOS if s < 1 else Image.Resampling.BICUBIC)
    return img


class TraceParams(BaseModel):
    path: str
    threshold: int | None = None  # grey level below which is ink; default: found automatically
    invert: bool = False          # light ink on a dark ground
    speck: int = 4                # ignore blobs up to this many pixels
    smooth: float = 1.0           # 0 corners .. 1.33 curves


def _trace(img, p: TraceParams):
    import tracing
    mask, t = tracing.ink_mask(img, p.threshold, p.invert)
    return mask, t, tracing.trace_mask(mask, p.speck, p.smooth)


@app.get("/api/trace/image")
def trace_image(path: str):
    """The picture as the trace sees it (shrunk if it is large), for the preview to draw under the outline."""
    import io
    buf = io.BytesIO()
    _picture(path).convert("RGB").save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png")


@app.post("/api/trace/preview")
def trace_preview(req: TraceParams):
    import tracing
    img = _picture(req.path)
    mask, t, cs = _trace(img, req)
    box = tracing.mask_box(mask)
    return {"width": img.width, "height": img.height, "threshold": t, "d": tracing.svg_path(cs), "box": box, "contours": len(cs)}


class TraceApplyReq(FontReq, TraceParams):
    name: str                         # the glyph that gets the outline
    baseline_y: float                 # picture rows: where the baseline is,
    top_y: float                      # and where `top_units` is
    top_units: float = 700
    lsb: float = 40
    tidy: bool = True                 # FontForge simplifies the outline to fewer points


@app.post("/api/trace/apply")
def trace_apply(req: TraceApplyReq):
    """Trace the picture into a glyph: the picture's baseline row becomes y 0 and its top row `top_units`."""
    import tracing
    mask, _, cs = _trace(_picture(req.path), req)
    box = tracing.mask_box(mask)
    if not cs or box is None:
        raise HTTPException(400, "Nothing to trace: no ink at this threshold")
    moved, width = tracing.fit(cs, req.baseline_y, req.top_y, req.top_units, req.lsb, ink=(box[0], box[2]))
    if not moved:
        raise HTTPException(400, "The baseline and the top line are on the same row")
    return _call("set_traced", fid=req.fid, name=req.name, contours=moved, width=width, tidy=req.tidy)


class SheetMakeReq(BaseModel):
    chars: str
    folder: str
    title: str = "Scrifts template"


@app.post("/api/sheet/make")
def sheet_make(req: SheetMakeReq):
    """Printable template pages (PNG and one PDF) for these characters, 48 to a page."""
    import sheet
    pages = sheet.split(req.chars)
    if not pages:
        raise HTTPException(400, "no characters")
    os.makedirs(req.folder, exist_ok=True)
    imgs = [sheet.render_page(c, i + 1, len(pages), req.title) for i, c in enumerate(pages)]
    files = []
    for i, im in enumerate(imgs, 1):
        f = os.path.join(req.folder, f"sheet-{i}.png")
        im.save(f, dpi=(200, 200))
        files.append(f)
    pdf = os.path.join(req.folder, "sheets.pdf")
    imgs[0].save(pdf, "PDF", resolution=200, save_all=True, append_images=imgs[1:])
    return {"folder": req.folder, "files": files, "pdf": pdf, "pages": pages}


class SheetReadReq(FontReq):
    path: str                  # a scan or photo of one sheet
    chars: str                 # all the characters the sheets were made for
    page: int = 1
    apply: bool = False        # false: only say what was found
    only: str | None = None    # with apply: just these letters
    threshold: int = 140
    speck: int = 6
    smooth: float = 1.0
    lsb: float = 40
    tidy: bool = True


@app.post("/api/sheet/read")
def sheet_read(req: SheetReadReq):
    """Cut a scan of a template sheet into letters and trace each written cell into its glyph."""
    import sheet
    import tracing
    pages = sheet.split(req.chars)
    if not 1 <= req.page <= len(pages):
        raise HTTPException(400, f"page {req.page}: these characters make {len(pages)} page{'s' if len(pages) != 1 else ''}")
    try:
        straight = sheet.rectify(_picture(req.path, shrink=False))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    em = _call("info", fid=req.fid).get("em", 1000)
    per_px = em / sheet.EM_PX
    found = []
    for ch, cell, _ in sheet.cells(straight, pages[req.page - 1], threshold=req.threshold):
        mask, _ = tracing.ink_mask(cell, req.threshold)
        cs = tracing.trace_mask(mask, req.speck, req.smooth)
        box = tracing.mask_box(mask)
        if not cs or box is None:
            continue
        moved, width = tracing.fit(cs, sheet.CELL_BASELINE, sheet.CELL_BASELINE - 100, 100 * per_px, req.lsb, ink=(box[0], box[2]))
        entry = {"char": ch, "d": tracing.svg_path(cs), "w": cell.width, "h": cell.height, "baseline": sheet.CELL_BASELINE}
        if req.apply and (req.only is None or ch in req.only):
            name = _call("ensure_char", fid=req.fid, cp=ord(ch))["name"]
            _call("set_traced", fid=req.fid, name=name, contours=moved, width=width, tidy=req.tidy)
            entry["glyph"] = name
        found.append(entry)
    return {"applied": req.apply, "cells": found, "pages": len(pages)}


class ArtboardsExportReq(FontReq):
    folder: str
    names: list[str] | None = None  # default: every glyph with an outline
    chars: str = ""                 # also these characters, empty if the font lacks them
    template: bool = False          # guides only, no outlines
    square: bool = True             # artboard 1 em wide (the advance is a guide); false: as wide as the advance


@app.post("/api/artboards/export")
def artboards_export(req: ArtboardsExportReq):
    """One SVG per glyph with metric guides, for Illustrator and friends."""
    return _call("export_artboards", fid=req.fid, folder=req.folder, names=req.names, chars=req.chars, template=req.template, square=req.square)


class ArtboardsImportReq(FontReq):
    folder: str
    apply: bool = False  # false: only say what would change
    create: bool = True
    files: list[str] | None = None  # with apply: only these files (default: all)


@app.post("/api/artboards/import")
def artboards_import(req: ArtboardsImportReq):
    """Read the Outline layer of the SVGs in a folder back into their glyphs (preview first, then apply)."""
    if not os.path.isdir(req.folder):
        raise HTTPException(404, f"No such folder: {req.folder}")
    return _call("import_artboards", fid=req.fid, folder=req.folder, apply=req.apply, create=req.create, files=req.files)
