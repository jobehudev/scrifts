"""Turn a picture of a letter into outline points for FontForge to clean up.

Pillow reads the picture and decides what is ink (a threshold; Otsu's method finds a good one). potracer, a
port of Potrace, fits the curves. Nothing here invents curve geometry: the result goes to FontForge, which
removes overlaps, adds extrema and rounds it like any other outline.
"""
import numpy as np
import potrace
from PIL import Image


def otsu(gray: np.ndarray) -> int:
    """The grey level that best separates ink from paper (Otsu's method) for an 8-bit image."""
    hist = np.bincount(gray.ravel(), minlength=256).astype(float)
    total = hist.sum()
    levels = np.arange(256)
    w0 = np.cumsum(hist)
    m0 = np.cumsum(hist * levels)
    w1 = total - w0
    with np.errstate(divide="ignore", invalid="ignore"):
        between = (m0[-1] * w0 - m0 * total) ** 2 / (w0 * w1)
    between[~np.isfinite(between)] = 0
    return int(np.argmax(between)) + 1  # ink is below this


def grey(img: Image.Image) -> np.ndarray:
    """8-bit grey; transparent areas count as paper."""
    rgba = img.convert("RGBA")
    flat = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    flat.alpha_composite(rgba)
    return np.array(flat.convert("L"))


def ink_mask(img: Image.Image, threshold: int | None = None, invert: bool = False) -> tuple[np.ndarray, int]:
    """(mask where True is ink, the threshold used). `invert` for light ink on a dark ground."""
    g = grey(img)
    t = int(threshold) if threshold else otsu(g)
    mask = g < t
    return (~mask if invert else mask), t


Contour = list[list[float]]  # [x, y, on-curve] points of a closed cubic contour


def trace_mask(mask: np.ndarray, speck: int = 4, smooth: float = 1.0, tolerance: float = 0.2) -> list[Contour]:
    """Closed cubic contours in picture pixels (y down). `speck`: ignore blobs up to this many pixels;
    `smooth` 0 (all corners) to 1.33 (all curves); `tolerance`: how far curves may stray when simplified."""
    path = potrace.Bitmap(~mask).trace(turdsize=int(speck), alphamax=float(smooth), opticurve=True, opttolerance=float(tolerance))
    out = []
    for curve in path:
        pts = [[curve.start_point.x, curve.start_point.y, 1]]
        for seg in curve.segments:
            if seg.is_corner:
                pts += [[seg.c.x, seg.c.y, 1], [seg.end_point.x, seg.end_point.y, 1]]
            else:
                pts += [[seg.c1.x, seg.c1.y, 0], [seg.c2.x, seg.c2.y, 0], [seg.end_point.x, seg.end_point.y, 1]]
        pts.pop()  # the last point is the first again
        out.append(pts)
    return out


def box(contours: list[Contour]) -> tuple[float, float, float, float] | None:
    """(left, top, right, bottom) of the on-curve points, or None if there is no ink."""
    on = [p for c in contours for p in c if p[2]]
    if not on:
        return None
    xs, ys = [p[0] for p in on], [p[1] for p in on]
    return min(xs), min(ys), max(xs), max(ys)


def mask_box(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    """(left, top, right, bottom) of the ink pixels, edges included on the left/top and past the last pixel on the right/bottom."""
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def fit(contours: list[Contour], baseline_y: float, top_y: float, top_units: float, lsb: float = 40,
        ink: tuple[float, float] | None = None) -> tuple[list[Contour], int]:
    """Picture pixels to font units: the picture's `baseline_y` row becomes y 0 and its `top_y` row `top_units`
    (so the scale is the same for every letter drawn on the same guides). The ink (`ink`: its left and right
    pixel columns; default: the contours' own extent) starts `lsb` from the left edge.
    Returns the contours and the advance width (`lsb` on both sides of the ink)."""
    b = box(contours)
    if b is None or baseline_y == top_y:
        return [], 0
    s = top_units / (baseline_y - top_y)
    left, right = ink if ink else (b[0], b[2])
    moved = [[[round((p[0] - left) * s + lsb, 2), round((baseline_y - p[1]) * s, 2), p[2]] for p in c] for c in contours]
    return moved, int(round((right - left) * s + 2 * lsb))


def svg_path(contours: list[Contour]) -> str:
    """The contours as SVG path data (for a preview in the picture's own pixels)."""
    d = []
    for c in contours:
        n = len(c)
        d.append(f"M{c[0][0]:.1f} {c[0][1]:.1f}")
        i = 1
        while i < n:
            if c[i][2]:
                d.append(f"L{c[i][0]:.1f} {c[i][1]:.1f}")
                i += 1
            else:
                a, b = c[i], c[i + 1]
                e = c[(i + 2) % n]
                d.append(f"C{a[0]:.1f} {a[1]:.1f} {b[0]:.1f} {b[1]:.1f} {e[0]:.1f} {e[1]:.1f}")
                i += 3
        d.append("Z")  # a closing curve's two handles are the last points; its end is the first point again
    return " ".join(d)
