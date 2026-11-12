"""TTF / OTF / UFO round-trips through Forge.

These are compiled (or foreign) formats: FontForge rebuilds them from its own
model, so a byte diff is meaningless (lookup order, post format, hdmx/LTSH
are all regenerated). The oracle is behaviour instead:

  ttf/otf  same cmap, same advance widths, same decomposed outlines, same
           TrueType instructions (glyph + fpgm/prep/cvt), and HarfBuzz shapes
           every encoded character to the same glyphs and positions with
           each GSUB/GPOS feature the source defines turned on.
  ufo      same glyph set, unicodes, advances, components, anchors,
           kerning, groups, features.fea, and the same geometry (signed
           area, bounds, on-curve points). Not the same point list: the
           core's UFO reader re-derives point types from geometry and drops
           control points that coincide with their on-curve point
           (_SPLCategorizePoints, ufo.cpp ~3007). After that first pass the
           point list must be a strict fixpoint.

Fonts are not vendored. Override with FORGE_TTF / FORGE_OTF, or the test skips.
"""
import json
import os
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

import pytest
import uharfbuzz as hb
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.pointPen import AbstractPointPen, PointToSegmentPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont
from fontTools.ufoLib import UFOReader

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from server import FFPYTHON, Worker  # noqa: E402


def ff_dump(path):
    r = subprocess.run([FFPYTHON, str(ROOT / "tests" / "ffdump.py"), "dump", str(path)],
                       capture_output=True, encoding="utf-8", timeout=600)
    assert r.returncode == 0, r.stderr[-2000:]
    return r.stdout

USER_FONTS = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Windows/Fonts"
TTF = Path(os.environ.get("FORGE_TTF", "C:/Windows/Fonts/georgia.ttf"))
OTF = Path(os.environ.get("FORGE_OTF", USER_FONTS / "NimbusSanL-Bol.otf"))
SFD_DIR = Path(os.environ.get("FORGE_SFD_DIR", ROOT / "tests" / "fixtures" / "sfd"))


@pytest.fixture(scope="module")
def worker():
    w = Worker()
    yield w
    w.close()


def roundtrip(worker, src, dst):
    worker.call("open", path=str(src))
    worker.call("outlines", names=[g["name"] for g in worker.call("info")["glyphs"]])
    worker.call("save", path=str(dst))
    return dst


# ------------------------------------------------------------------ ttf/otf

class Sfnt:
    def __init__(self, path):
        self.tt = TTFont(path)
        self.gs = self.tt.getGlyphSet()
        self.cmap = self.tt.getBestCmap()
        self.order = self.tt.getGlyphOrder()
        self.hb = hb.Font(hb.Face(hb.Blob.from_file_path(str(path))))
        self.outline = lru_cache(None)(self._outline)

    def _outline(self, name):
        pen = DecomposingRecordingPen(self.gs)
        self.gs[name].draw(pen)
        return repr(pen.value)

    def features(self):
        tags = set()
        for t in ("GSUB", "GPOS"):
            if t in self.tt and self.tt[t].table.FeatureList:
                tags |= {fr.FeatureTag for fr in self.tt[t].table.FeatureList.FeatureRecord}
        return sorted(tags)

    def shape(self, text, features):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf, features)
        return [(self.outline(self.order[i.codepoint]), p.x_advance, p.y_advance,
                 p.x_offset, p.y_offset)
                for i, p in zip(buf.glyph_infos, buf.glyph_positions)]


def compare_sfnt(src, dst):
    a, b = Sfnt(src), Sfnt(dst)
    assert a.cmap.keys() == b.cmap.keys()
    for u, n in a.cmap.items():
        m = b.cmap[u]
        assert a.gs[n].width == b.gs[m].width, f"advance U+{u:04X}"
        assert a.outline(n) == b.outline(m), f"outline U+{u:04X} {n}"
    if "glyf" in a.tt:
        for t in ("fpgm", "prep", "cvt "):
            assert (t in a.tt) == (t in b.tt), t
            if t in a.tt:
                assert a.tt[t].compile(a.tt) == b.tt[t].compile(b.tt), t
        for u, n in a.cmap.items():
            pa, pb = a.tt["glyf"][n], b.tt["glyf"][b.cmap[u]]
            ba = pa.program.getBytecode() if hasattr(pa, "program") else b""
            bb = pb.program.getBytecode() if hasattr(pb, "program") else b""
            assert ba == bb, f"instructions {n}"
    assert a.features() == b.features()
    chars = "".join(map(chr, sorted(a.cmap)))
    chunks = [chars[i:i + 64] for i in range(0, len(chars), 64)]
    for feat in [None] + a.features():
        f = {feat: True} if feat else {}
        for c in chunks:
            assert a.shape(c, f) == b.shape(c, f), f"shaping differs, feature={feat} text={c!r}"


@pytest.mark.skipif(not TTF.exists(), reason=f"no TTF at {TTF}")
def test_ttf(worker, tmp_path):
    compare_sfnt(TTF, roundtrip(worker, TTF, tmp_path / "out.ttf"))


@pytest.mark.skipif(not OTF.exists(), reason=f"no OTF at {OTF}")
def test_otf(worker, tmp_path):
    compare_sfnt(OTF, roundtrip(worker, OTF, tmp_path / "out.otf"))


# ------------------------------------------------------------------ ufo

class Points(AbstractPointPen):
    def __init__(self):
        self.v = []

    def beginPath(self, identifier=None, **kw):
        self.v.append("(")

    def endPath(self):
        self.v.append(")")

    def addPoint(self, pt, segmentType=None, smooth=False, name=None, identifier=None, **kw):
        self.v.append((pt, segmentType, smooth, name))

    def addComponent(self, base, transform, identifier=None, **kw):
        self.v.append(("component", base, tuple(transform)))


class G:
    pass


def ufo_model(path, points=True):
    r = UFOReader(str(path))
    gs = r.getGlyphSet()
    out = {}
    for name in gs.keys():
        g, pen = G(), Points()
        gs.readGlyph(name, g, pen)
        contours = pen.v
        if not points:
            area, bounds = AreaPen(gs), BoundsPen(gs)
            for sub in (area, bounds):
                gs.readGlyph(name, G(), PointToSegmentPen(sub))
            on = sorted({p[0] for p in pen.v if isinstance(p, tuple) and len(p) == 4 and p[1]})
            comps = [p for p in pen.v if isinstance(p, tuple) and p[0] == "component"]
            contours = (round(area.value, 3), bounds.bounds, on, comps)
        out[name] = (getattr(g, "width", 0), sorted(getattr(g, "unicodes", [])),
                     contours, sorted(map(repr, getattr(g, "anchors", []) or [])))
    return {"glyphs": out, "kerning": r.readKerning(), "groups": r.readGroups(),
            "features": r.readFeatures()}


def assert_same_ufo(a, b, features_text=True):
    assert a["glyphs"].keys() == b["glyphs"].keys()
    bad = [n for n in a["glyphs"] if a["glyphs"][n] != b["glyphs"][n]]
    assert bad == [], f"{len(bad)} glyphs differ, first {bad[:5]}"
    assert a["kerning"] == b["kerning"]
    assert a["groups"] == b["groups"]
    if features_text:
        assert a["features"] == b["features"]


@pytest.fixture(scope="module")
def ufo_source(worker, tmp_path_factory):
    """A UFO written by FontForge itself from a real .sfd (DejaVu Serif)."""
    src = SFD_DIR / "DejaVuSerif.sfd"
    if not src.exists():
        pytest.skip("run tests/fetch_fixtures.sh")
    return roundtrip(worker, src, tmp_path_factory.mktemp("ufo") / "DejaVuSerif.ufo")


def test_ufo_geometry(worker, ufo_source, tmp_path):
    out = roundtrip(worker, ufo_source, tmp_path / "out.ufo")
    # features.fea is regenerated from the core's lookups, so its text is not
    # comparable on the first pass; compare the lookups the core loads instead.
    assert_same_ufo(ufo_model(ufo_source, points=False), ufo_model(out, points=False),
                    features_text=False)
    a, b = json.loads(ff_dump(ufo_source)), json.loads(ff_dump(out))
    for k in ("gsub_lookups", "gpos_lookups", "lookups", "subtables", "kernclasses"):
        assert a["font"][k] == b["font"][k], k
    assert {n: g["possub"] for n, g in a["glyphs"].items()} ==            {n: g["possub"] for n, g in b["glyphs"].items()}


def test_ufo_fixpoint(worker, ufo_source, tmp_path):
    once = roundtrip(worker, ufo_source, tmp_path / "once.ufo")
    twice = roundtrip(worker, once, tmp_path / "twice.ufo")
    assert_same_ufo(ufo_model(once), ufo_model(twice))
