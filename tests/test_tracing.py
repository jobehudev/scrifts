import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import numpy as np
from PIL import Image, ImageDraw
import tracing as tr


def ring(speck=False, light_ink=False):
    ink, paper = (255, 0) if light_ink else (0, 255)
    im = Image.new("L", (240, 300), paper)
    d = ImageDraw.Draw(im)
    d.ellipse((40, 60, 200, 220), fill=ink)       # outer
    d.ellipse((90, 110, 150, 170), fill=paper)    # hole
    if speck:
        d.rectangle((10, 10, 12, 12), fill=ink)   # a 3x3 speck of dust
    return im


def test_otsu_splits_ink_from_paper():
    m, t = tr.ink_mask(ring())
    assert 0 < t < 255 and m.sum() > 1000 and not m[0, 0]


def test_ring_traces_to_an_outer_contour_and_a_hole():
    cs = tr.trace_mask(tr.ink_mask(ring())[0])
    assert len(cs) == 2
    assert all(p[2] in (0, 1) and len(p) == 3 for c in cs for p in c)
    m = tr.ink_mask(ring())[0]
    assert tr.mask_box(m) == (40, 60, 201, 221)
    assert abs(tr.box(cs)[0] - 40) < 3 and abs(tr.box(cs)[2] - 201) < 3


def test_specks_are_ignored_and_light_ink_can_be_inverted():
    assert len(tr.trace_mask(tr.ink_mask(ring(speck=True))[0], speck=0)) == 3
    assert len(tr.trace_mask(tr.ink_mask(ring(speck=True))[0], speck=10)) == 2
    assert len(tr.trace_mask(tr.ink_mask(ring(light_ink=True), invert=True)[0])) == 2


def test_fit_scales_to_font_units_on_the_guides():
    mask = tr.ink_mask(ring())[0]
    cs = tr.trace_mask(mask)
    mb = tr.mask_box(mask)
    # baseline at the ink's bottom, 700 units at its top: 160 px -> 700 units, so 4.375 units a pixel
    moved, width = tr.fit(cs, baseline_y=mb[3], top_y=mb[1], top_units=700, lsb=40, ink=(mb[0], mb[2]))
    b = tr.box(moved)
    assert abs(b[1]) < 15 and abs(b[3] - 700) < 15 and abs(b[0] - 40) < 15   # y up, on the baseline, near lsb 40
    assert width == round((mb[2] - mb[0]) * 700 / (mb[3] - mb[1]) + 80)
    assert tr.fit([], 10, 0, 700) == ([], 0)


def test_svg_path_closes_every_contour():
    d = tr.svg_path(tr.trace_mask(tr.ink_mask(ring())[0]))
    assert d.count("M") == 2 and d.count("Z") == 2 and "C" in d
