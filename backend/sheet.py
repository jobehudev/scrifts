"""A printable template sheet to write letters on, and reading a scan or photo of it back.

An A4 page at 200 dpi: four black squares in the corners (so a crooked scan or phone photo can be straightened),
and a grid of cells, each with pale blue guide lines (descender, baseline, x-height, cap height) and the letter it is
for in the corner. The guides are light enough that a threshold drops them; the ink is whatever is dark.
The same layout code makes the page and cuts it up, so they cannot drift apart.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from tracing import grey

W, H = 1654, 2339                       # A4 at 200 dpi
MARK, MARK_AT = 60, 80                  # corner squares: side, and the distance of their centres from the page edges
COLS, ROWS = 6, 8
CELL_W, CELL_H = 220, 240
LEFT, TOP = (W - COLS * CELL_W) // 2, 200
PER_PAGE = COLS * ROWS
EM_PX = 150                             # one em, in sheet pixels
BASELINE = 163                          # from the top of a cell
GUIDES = [("descender", BASELINE + 0.2 * EM_PX), ("baseline", BASELINE), ("x-height", BASELINE - 0.5 * EM_PX), ("cap-height", BASELINE - 0.7 * EM_PX)]
PALE = (170, 205, 255)
MARKS = [(MARK_AT, MARK_AT), (MARK_AT, H - MARK_AT), (W - MARK_AT, H - MARK_AT), (W - MARK_AT, MARK_AT)]  # UL, LL, LR, UR


def split(chars: str) -> list[str]:
    """The characters, once each, in pages of PER_PAGE."""
    seen = list(dict.fromkeys(c for c in chars if not c.isspace()))
    return ["".join(seen[i:i + PER_PAGE]) for i in range(0, len(seen), PER_PAGE)]


def cell_box(i: int) -> tuple[int, int, int, int]:
    """Where cell number i (row by row) is on the page."""
    r, c = divmod(i, COLS)
    x, y = LEFT + c * CELL_W, TOP + r * CELL_H
    return x, y, x + CELL_W, y + CELL_H


def _font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # an old Pillow without sized default fonts
        return ImageFont.load_default()


def render_page(chars: str, page: int, pages: int, title: str = "") -> Image.Image:
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    for x, y in MARKS:
        d.rectangle((x - MARK // 2, y - MARK // 2, x + MARK // 2 - 1, y + MARK // 2 - 1), fill="black")
    d.text((LEFT, 120), f"{title}  -  page {page} of {pages}  -  write inside the boxes, in dark ink, on the baseline", fill=(120, 120, 120), font=_font(22))
    for i, ch in enumerate(chars):
        x0, y0, x1, y1 = cell_box(i)
        d.rectangle((x0, y0, x1 - 1, y1 - 1), outline=(205, 205, 205))
        for guide, gy in GUIDES:  # the baseline is the one to write on: a little stronger (still well above the ink threshold)
            d.line((x0 + 4, y0 + gy, x1 - 5, y0 + gy), fill=(140, 190, 255) if guide == "baseline" else PALE, width=3 if guide == "baseline" else 2)
        d.text((x0 + 8, y0 + 6), ch, fill=(185, 185, 185), font=_font(22))
    return img


def _coeffs(src, dst):
    """The 8 numbers Pillow wants to turn `dst` points into `src` points (a perspective transform)."""
    a, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        a += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
        b += [u, v]
    return np.linalg.solve(np.array(a, float), np.array(b, float)).tolist()


def _find_mark(dark: np.ndarray, x0: int, y0: int, x1: int, y1: int, k: int) -> tuple[float, float]:
    """The centre of the solid dark k x k square in a corner region (the best match, which must be nearly solid)."""
    sub = dark[y0:y1, x0:x1].astype(np.int32)
    ii = np.pad(sub.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    win = ii[k:, k:] - ii[:-k, k:] - ii[k:, :-k] + ii[:-k, :-k]
    best = win.max()
    if best < 0.85 * k * k:
        raise ValueError("Could not find the four black squares in the page corners. Is the whole page in the picture?")
    ys, xs = np.nonzero(win >= best * 0.98)  # a window smaller than the square fits in several places: take their middle
    return x0 + xs.mean() + k / 2, y0 + ys.mean() + k / 2


def rectify(scan: Image.Image) -> Image.Image:
    """The scan straightened to the sheet: the page between the four corner squares, at the sheet's own size.
    The result's (0, 0) is the sheet's (MARK_AT, MARK_AT); see `page_offset`."""
    g = grey(scan)
    h0, w0 = g.shape
    s = 800 / w0
    small = np.array(Image.fromarray(g).resize((800, max(1, round(h0 * s)))))
    dark = small < 110
    hs, ws = small.shape
    k = max(4, int(MARK * (ws / W) * 0.8))
    rx, ry = int(ws * 0.22), int(hs * 0.18)
    regions = [(0, 0, rx, ry), (0, hs - ry, rx, hs), (ws - rx, hs - ry, ws, hs), (ws - rx, 0, ws, ry)]
    src = [(x / s, y / s) for x, y in (_find_mark(dark, *r, k) for r in regions)]
    out_w, out_h = W - 2 * MARK_AT, H - 2 * MARK_AT
    dst = [(0, 0), (0, out_h), (out_w, out_h), (out_w, 0)]
    return scan.convert("RGB").transform((out_w, out_h), Image.Transform.PERSPECTIVE, _coeffs(src, dst), Image.Resampling.BICUBIC, fillcolor=(255, 255, 255))


def cells(page_img: Image.Image, chars: str, min_ink: float = 0.004, threshold: int = 140):
    """(char, cell image, index) for each cell with ink in it, from a straightened page."""
    out = []
    for i, ch in enumerate(chars):
        x0, y0, x1, y1 = cell_box(i)
        cell = page_img.crop((x0 - MARK_AT + 5, y0 - MARK_AT + 5, x1 - MARK_AT - 5, y1 - MARK_AT - 5))
        if (grey(cell) < threshold).mean() >= min_ink:
            out.append((ch, cell, i))
    return out


# where the baseline sits in a cropped cell (see `cells`: 5 pixels were taken off the top)
CELL_BASELINE = BASELINE - 5
