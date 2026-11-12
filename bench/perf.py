"""Timings for the calls the app makes all the time. Run: .venv/Scripts/python bench/perf.py

Not a test: it prints numbers (median of a few runs, milliseconds) so a change can be compared with
the one before it. Needs the fixtures from tests/fetch_fixtures.sh.
"""
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

SFD = ROOT / "tests" / "fixtures" / "sfd" / "DejaVuSerif.sfd"
GLYPHS = ROOT / "tests" / "fixtures" / "glyphs" / "GlyphsUnitTestSans.glyphs"


def ms(fn, n=5):
    out = []
    for _ in range(n):
        t = time.perf_counter()
        fn()
        out.append((time.perf_counter() - t) * 1000)
    return round(statistics.median(out), 1)


def main():
    rows = []
    with TestClient(server.app) as c:
        t = time.perf_counter()
        info = c.post("/api/open", json={"path": str(SFD)}).json()
        rows.append(("open DejaVu Serif (940 glyphs), cold", round((time.perf_counter() - t) * 1000, 1)))
        fid = info["fid"]
        names = [g["name"] for g in info["glyphs"]][:200]
        rows.append(("open the same font again (already open)", ms(lambda: c.post("/api/open", json={"path": str(SFD)}))))
        rows.append(("outlines, 200 glyphs in one call", ms(lambda: c.post("/api/outlines", json={"fid": fid, "names": names}))))
        rows.append(("one glyph's points", ms(lambda: c.get("/api/glyph/a", params={"fid": fid}), 15)))
        pairs = [[a, b] for a in "Hamburg" for b in "Hamburg"][:40]
        rows.append(("kerning, 40 pairs", ms(lambda: c.post("/api/kerning", json={"fid": fid, "pairs": pairs}))))
        rows.append(("shape a line (HarfBuzz)", ms(lambda: c.post("/api/shape", json={"fid": fid, "text": "Hamburgefontsiv", "features": {}}), 10)))
        rows.append(("font info", ms(lambda: c.get("/api/font-info", params={"fid": fid}), 10)))
        rows.append(("glyph database blocks", ms(lambda: c.get("/api/glyphdb/blocks", params={"fid": fid}))))
        rows.append(("autosave check (nothing changed)", ms(lambda: c.post("/api/autosave", json={"fid": fid}), 10)))
        rows.append(("preview (first)", ms(lambda: c.get("/api/preview", params={"path": str(SFD), "text": "Abg"}), 1)))
        rows.append(("preview (cached)", ms(lambda: c.get("/api/preview", params={"path": str(SFD), "text": "Abg"}), 10)))

        # a family: masters closed (as a script or a first blend sees them) and open (as in the app)
        d = Path(tempfile.mkdtemp(prefix="perf-"))
        shutil.copy(GLYPHS, d / "G.glyphs")
        t = time.perf_counter()
        p = c.post("/api/import/glyphs", json={"path": str(d / "G.glyphs")}).json()
        rows.append(("import a 3-master .glyphs file", round((time.perf_counter() - t) * 1000, 1)))
        ds = p["designspace"]
        blend = lambda: c.post("/api/family/blend", json={"path": ds, "weight": 250, "names": ["I", "h"]})
        rows.append(("family blend, 2 glyphs (masters closed)", ms(blend)))
        fids = [c.post("/api/open", json={"path": m}).json()["fid"] for m in p["masters"]]
        rows.append(("family blend, 2 glyphs (masters open)", ms(blend)))
        rows.append(("family check (masters open)", ms(lambda: c.get("/api/family/check", params={"path": ds}))))
        _ = fids
    server.worker.close()
    w = max(len(r[0]) for r in rows)
    for name, v in rows:
        print(f"{name:<{w}}  {v:>9} ms")


if __name__ == "__main__":
    main()
