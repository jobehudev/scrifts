"""Pictures for the NSIS installer, made from the home screen picture and the wordmark (frontend/public/wordmark.svg):
the tall one beside the welcome and finish pages (164x314) and the small one in the header of the other pages
(150x57). BMP, as NSIS wants.

    .venv/Scripts/python packaging/installer_art.py"""
import re
from pathlib import Path

from fontTools.pens.basePen import BasePen
from fontTools.svgLib.path import parse_path
from PIL import Image, ImageChops, ImageDraw, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "packaging" / "art"
WORDMARK = ROOT / "frontend" / "public" / "wordmark.svg"


class _Flatten(BasePen):
    """Collects every closed subpath as a polyline (curves cut into short steps)."""

    def __init__(self):
        super().__init__(None)
        self.polys, self._cur = [], []

    def _moveTo(self, p):
        self._cur = [p]

    def _lineTo(self, p):
        self._cur.append(p)

    def _curveToOne(self, a, b, c):
        x0, y0 = self._getCurrentPoint()
        for i in range(1, 17):
            t = i / 16
            u = 1 - t
            self._cur.append((u**3 * x0 + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t**3 * c[0],
                              u**3 * y0 + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t**3 * c[1]))

    def _closePath(self):
        if len(self._cur) > 2:
            self.polys.append(self._cur)
        self._cur = []

    _endPath = _closePath


def wordmark(width, color=(255, 255, 255)):
    """The wordmark SVG as an RGBA picture `width` px wide (drawn 4x and scaled down, for smooth edges)."""
    svg = WORDMARK.read_text(encoding="utf-8")
    vw, vh = map(float, re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg).groups())
    k = 4 * width / vw
    size = (round(vw * k), round(vh * k))
    mask = Image.new("L", size, 0)
    for d in re.findall(r'<path d="([^"]+)"', svg):
        pen = _Flatten()
        parse_path(d, pen)
        for poly in pen.polys:  # even-odd: a counter (the hole in R) is drawn twice and cancels out
            one = Image.new("L", size, 0)
            ImageDraw.Draw(one).polygon([(x * k, y * k) for x, y in poly], fill=255)
            mask = ImageChops.logical_xor(mask.convert("1"), one.convert("1")).convert("L")
    for pts in re.findall(r'<polygon points="([^"]+)"', svg):
        n = [float(v) for v in pts.split()]
        one = Image.new("L", size, 0)
        ImageDraw.Draw(one).polygon([(n[i] * k, n[i + 1] * k) for i in range(0, len(n), 2)], fill=255)
        mask = ImageChops.logical_xor(mask.convert("1"), one.convert("1")).convert("L")
    out = Image.new("RGBA", size, color + (0,))
    out.putalpha(mask)
    return out.resize((width, round(width * vh / vw)), Image.LANCZOS)


def cover(img, w, h):
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x = (img.width - w) // 2
    return img.crop((x, 0, x + w, h))  # keep the top, like the home screen


def shade(img, top, bottom):
    """Darken towards the bottom, so the name in front reads whatever the picture is."""
    grad = Image.new("L", (1, img.height))
    for y in range(img.height):
        grad.putpixel((0, y), round(255 * (top + (bottom - top) * y / (img.height - 1))))
    black = Image.new("RGB", img.size, (0, 0, 0))
    return Image.composite(black, img, grad.resize(img.size))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    pic = Image.open(ROOT / "frontend" / "public" / "splash.jpg").convert("RGB")

    side = shade(cover(pic, 164, 314), 0.45, 0.9)
    mark = wordmark(136)
    side.paste(mark, (14, 262), mark)
    side.save(OUT / "sidebar.bmp")

    head = Image.new("RGB", (150, 57), (22, 22, 29))
    strip = ImageEnhance.Brightness(cover(pic, 57, 57)).enhance(0.75)
    head.paste(strip, (93, 0))
    head = shade(head, 0.0, 0.0)
    mark = wordmark(88)
    head.paste(mark, (10, (57 - mark.height) // 2), mark)
    head.save(OUT / "header.bmp")
    print("written", OUT)


if __name__ == "__main__":
    main()
