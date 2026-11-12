import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import numpy as np
import pytest
from PIL import Image, ImageDraw
import sheet as sh
import tracing as tr


def test_split_in_pages_without_repeats_or_spaces():
    pages = sh.split("ab ba" + "".join(chr(c) for c in range(65, 65 + 26)) * 3)
    assert pages[0].startswith("abAB") and sum(len(p) for p in pages) == len(set("ab" + "".join(chr(c) for c in range(65, 91))))
    assert all(len(p) <= sh.PER_PAGE for p in pages)
    assert len(sh.split("x" * 3 + "".join(chr(0x4e00 + i) for i in range(60)))) == 2


def written_page(rotate=0.0):
    """A sheet for 'AHIO' with a bar written in H's cell and a ring in O's, as a (possibly crooked) scan."""
    page = sh.render_page("AHIO", 1, 1, "t")
    d = ImageDraw.Draw(page)
    x0, y0, _, _ = sh.cell_box(1)
    d.rectangle((x0 + 60, y0 + sh.BASELINE - 105, x0 + 90, y0 + sh.BASELINE), fill="black")           # a stem from baseline to cap height
    x0, y0, _, _ = sh.cell_box(3)
    d.ellipse((x0 + 40, y0 + sh.BASELINE - 105, x0 + 150, y0 + sh.BASELINE), fill="black")
    d.ellipse((x0 + 70, y0 + sh.BASELINE - 80, x0 + 120, y0 + sh.BASELINE - 25), fill="white")
    return page.rotate(rotate, resample=Image.Resampling.BICUBIC, fillcolor="white") if rotate else page


@pytest.mark.parametrize("rotate", [0.0, 2.0])
def test_scan_is_straightened_and_only_written_cells_are_found(rotate):
    found = sh.cells(sh.rectify(written_page(rotate)), "AHIO")
    assert [c for c, _, _ in found] == ["H", "O"]             # blank cells (and the pale guides and labels) are not ink


def test_cell_traces_on_the_sheets_own_scale():
    (_, cell, _), (_, ring, _) = sh.cells(sh.rectify(written_page(1.0)), "AHIO")
    for img, hole in ((cell, False), (ring, True)):
        mask, _ = tr.ink_mask(img, threshold=140)
        cs = tr.trace_mask(mask)
        assert len(cs) == (2 if hole else 1)
        # 105 px from baseline to cap height is 700 units (150 px to the em); the written shapes are that tall
        moved, width = tr.fit(cs, sh.CELL_BASELINE, sh.CELL_BASELINE - 105, 700, ink=(tr.mask_box(mask)[0], tr.mask_box(mask)[2]))
        b = tr.box(moved)
        assert abs(b[1]) < 40 and abs(b[3] - 700) < 40 and width > 80


def test_a_photo_without_the_corner_squares_is_refused():
    with pytest.raises(ValueError, match="four black squares"):
        sh.rectify(Image.new("RGB", (1200, 1700), "white"))
