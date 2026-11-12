"""Timings on a big font (5000 glyphs). Run: .venv/Scripts/python bench/big.py [glyph count]

The font is made once, in bench/out/ (not in git): DejaVu Serif's outlined glyphs, copied over and over into
private-use code points until there are enough. Real outlines, so the numbers mean something. Not a test: it
prints milliseconds, to compare one change with the one before it. Needs tests/fetch_fixtures.sh.
"""
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

SFD = ROOT / "tests" / "fixtures" / "sfd" / "DejaVuSerif.sfd"

MAKE = """
src = [g.glyphname for g in font.glyphs() if len(g.foreground) and g.unicode > 32]
have, i = len(list(font.glyphs())), 0
while have < {n}:
    s = font[src[i % len(src)]]
    g = font.createChar(0xF0000 + i, "big%05d" % i)
    g.foreground = s.foreground
    g.width = s.width
    have += 1
    i += 1
font.save({path!r})
"""


def timed(fn):
    t = time.perf_counter()
    r = fn()
    assert r.status_code == 200, r.text[:300]
    return round((time.perf_counter() - t) * 1000), r


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    big = ROOT / "bench" / "out" / f"Big{n}.sfd"
    rows = []
    with TestClient(server.app) as c:
        post = lambda url, **body: c.post(url, json=body)
        if not big.exists():
            big.parent.mkdir(parents=True, exist_ok=True)
            fid = post("/api/open", path=str(SFD)).json()["fid"]
            r = post("/api/script", fid=fid, code=MAKE.format(n=n, path=str(big))).json()
            assert not r["error"], r["error"]
            post("/api/close", fid=fid)
            c.post("/api/cancel")  # a fresh worker, so the open below is a cold one

        ms, r = timed(lambda: post("/api/open", path=str(big)))
        info = r.json()
        fid = info["fid"]
        names = [g["name"] for g in info["glyphs"]]
        rows.append((f"open, cold ({len(names)} glyphs, {big.stat().st_size / 2**20:.1f} MB)", ms))
        rows.append(("response size of open, MB", round(len(r.content) / 2**20, 2)))
        rows.append(("glyph list again (/api/info)", timed(lambda: c.get("/api/info", params={"fid": fid}))[0]))
        rows.append(("outlines, one screen of the grid (60)", timed(lambda: post("/api/outlines", fid=fid, names=names[:60]))[0]))
        rows.append(("outlines, every glyph", timed(lambda: post("/api/outlines", fid=fid, names=names))[0]))
        rows.append(("one glyph's points", timed(lambda: c.get("/api/glyph/a", params={"fid": fid}))[0]))
        rows.append(("move one point (an edit)", timed(lambda: post("/api/edit", fid=fid, name="a", kind="move", args={"moves": [[0, 0, 5, 0]]}))[0]))
        rows.append(("autosave after that edit", timed(lambda: post("/api/autosave", fid=fid))[0]))
        rows.append(("autosave, nothing changed", timed(lambda: post("/api/autosave", fid=fid))[0]))
        rows.append(("shape a line, first (compiles the font)", timed(lambda: post("/api/shape", fid=fid, text="Hamburgefontsiv", features={}))[0]))
        rows.append(("shape a line, again (font unchanged)", timed(lambda: post("/api/shape", fid=fid, text="Hamburgefontsiw", features={}))[0]))
        rows.append(("interface font (/api/webfont)", timed(lambda: c.get("/api/webfont", params={"fid": fid}))[0]))
        rows.append(("validate", timed(lambda: c.get("/api/validate", params={"fid": fid}))[0]))
        rows.append(("glyph database blocks", timed(lambda: c.get("/api/glyphdb/blocks", params={"fid": fid}))[0]))
        rows.append(("metrics keys", timed(lambda: c.get("/api/metrics-keys", params={"fid": fid}))[0]))
        rows.append(("snapshot", timed(lambda: post("/api/snapshots", path=str(big), label="bench"))[0]))
        rows.append(("generate .otf", timed(lambda: post("/api/generate", fid=fid, folder=str(big.parent), name="Big", formats=["otf"]))[0]))
    server.worker.close()
    w = max(len(r[0]) for r in rows)
    for name, v in rows:
        print(f"{name:<{w}}  {v:>8}")


if __name__ == "__main__":
    main()
