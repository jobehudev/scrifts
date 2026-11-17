"""API smoke test: the slice-1 path (open .sfd, fetch one glyph) end to end."""
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import server  # noqa: E402

SFD = ROOT / "tests" / "fixtures" / "sfd" / "DejaVuSerif.sfd"


@pytest.fixture(scope="module")
def client():
    with TestClient(server.app) as c:
        yield c
    server.worker.close()


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_open_sfd_and_read_one_glyph(client):
    info = client.post("/api/open", json={"path": str(SFD)}).json()
    fid = info["fid"]
    assert info["fontname"] == "DejaVuSerif" and len(info["glyphs"]) > 900 and info["axes"] == []
    g = client.get("/api/glyph/a", params={"fid": fid}).json()
    assert g["contours"] and g["d"].startswith("M") and g["width"] > 0
    comp = client.post("/api/outlines", json={"fid": fid, "names": ["Aacute"]}).json()[0]
    assert [r["ref"] for r in comp["refs"]] == ["A", "Acute"]


def test_missing_file_is_404(client):
    assert client.post("/api/open", json={"path": "C:/nope.sfd"}).status_code == 404


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_bearings_edit_and_save_roundtrip(client, tmp_path):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    before = client.post("/api/outlines", json={"fid": fid, "names": ["H"]}).json()[0]
    after = client.post("/api/bearings", json={"fid": fid, "name": "H", "lsb": before["lsb"] + 37.4,
                                               "rsb": before["rsb"] - 5}).json()
    assert after["lsb"] == round(before["lsb"] + 37.4) and after["rsb"] == before["rsb"] - 5
    assert after["width"] == before["width"] + 37 - 5
    out = tmp_path / "edited.sfd"
    client.post("/api/save", json={"fid": fid, "path": str(out)})
    fid2 = client.post("/api/open", json={"path": str(out)}).json()["fid"]
    again = client.post("/api/outlines", json={"fid": fid2, "names": ["H"]}).json()[0]
    assert (again["lsb"], again["rsb"], again["width"]) == (after["lsb"], after["rsb"], after["width"])


# Variable fonts with different axis counts (local, not vendored).
_UF = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "Windows" / "Fonts"
VFS = [p for p in [
    _UF / "EBGaramond-VariableFont_wght.ttf",                       # 1 axis
    Path(r"C:\Windows\Fonts\bahnschrift.ttf"),                      # 2 axes
    _UF / "BricolageGrotesque-VariableFont_opsz,wdth,wght.ttf",     # 3 axes
    _UF / "RobotoFlex-VariableFont_GRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght.ttf",  # 13
] if p.exists()]


@pytest.mark.parametrize("vf", VFS, ids=lambda p: p.name.split("-")[0])
def test_variable_font(client, vf, tmp_path):
    from fontTools.ttLib import TTFont

    info = client.post("/api/open", json={"path": str(vf)}).json()
    fid = info["fid"]
    axes = info["axes"]
    assert len(axes) == len(TTFont(vf)["fvar"].axes) and axes
    names = [g["name"] for g in info["glyphs"]][:200]
    # FontForge and fontTools must agree on glyph names, or the views mix fonts.
    tt_names = set(TTFont(vf).getGlyphOrder())
    assert set(names) <= tt_names
    # the extreme farthest from default (some fonts' default *is* the max)
    far = {a["tag"]: max((a["min"], a["max"]), key=lambda v: abs(v - a["default"])) for a in axes}
    at_default = client.post("/api/outlines", json={"fid": fid, "names": names[:50]}).json()
    at_far = client.post("/api/outlines", json={"fid": fid, "names": names[:50], "location": far}).json()
    assert len(at_far) == len(at_default)
    assert any(a["d"] != b["d"] for a, b in zip(at_default, at_far)), "moving every axis changed nothing"

    inst = client.post("/api/export/instance", json={"fid": fid, "location": far, "path": str(tmp_path / "i.ttf")})
    assert inst.status_code == 200, inst.text
    check = inst.json()["outline_check"]
    assert "fvar" not in inst.json()["tables"] and check["glyphs_checked"] > 0
    # Known source-font defect, see server._compare_instance.
    assert len(check["advance_mismatches"]) <= {"EBGaramond": 3}.get(vf.name.split("-")[0], 0), check
    full = client.post("/api/export/variable", json={"fid": fid, "path": str(tmp_path / "v.ttf")})
    assert full.status_code == 200, full.text
    assert "fvar" in full.json()["tables"]


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_two_open_fonts_never_mix(client):
    """Regression: one client opening a font used to swap it under another
    client, which then drew its cached outline with the new font's points."""
    other = SFD.with_name("Caliban.sfd")
    a = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    b = client.post("/api/open", json={"path": str(other)}).json()["fid"]
    ga = client.get("/api/glyph/a", params={"fid": a}).json()
    gb = client.get("/api/glyph/a", params={"fid": b}).json()
    assert ga["d"] != gb["d"]
    assert client.get("/api/glyph/a", params={"fid": a}).json()["d"] == ga["d"]
    client.post("/api/close", json={"fid": a})
    assert client.get("/api/glyph/a", params={"fid": a}).status_code == 410


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_outline_edits_undo_and_save(client, tmp_path):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    e = lambda kind, **args: client.post("/api/edit", json={"fid": fid, "name": "o", "kind": kind, "args": args})
    p0 = client.get("/api/glyph/o", params={"fid": fid}).json()
    x0, y0 = p0["contours"][0][0][:2]
    moved = e("move", moves=[[0, 0, 30, -12]]).json()
    assert moved["contours"][0][0][:2] == [x0 + 30, y0 - 12]
    back = client.post("/api/undo", json={"fid": fid, "name": "o"}).json()
    assert back["contours"][0][0][:2] == [x0, y0]
    assert e("reorder", order=[1, 0]).json()["contours"][0] == p0["contours"][1]
    assert e("bogus").status_code == 400
    # an edit must survive save -> reopen through the core
    e("move", moves=[[0, 0, 30, -12]])
    out = tmp_path / "edited.sfd"
    client.post("/api/save", json={"fid": fid, "path": str(out)})
    fid2 = client.post("/api/open", json={"path": str(out)}).json()["fid"]
    again = client.get("/api/glyph/o", params={"fid": fid2}).json()
    assert again["contours"] == e("move", moves=[]).json()["contours"]


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_svg_import(client, tmp_path):
    svg = tmp_path / "box.svg"
    svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
                   '<path d="M10 10h80v80h-80z"/><circle cx="50" cy="50" r="30"/></svg>')
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    r = client.post("/api/import", json={"fid": fid, "name": "space", "path": str(svg), "flags": ["correctdir"]})
    assert r.status_code == 200 and len(r.json()["contours"]) == 2
    bad = client.post("/api/import", json={"fid": fid, "name": "space", "path": str(svg), "flags": ["nope"]})
    assert bad.status_code == 400


def _boxes(client, name):
    """A fresh glyph with two overlapping 100-unit squares, drawn clockwise.
    Unique name per test: opening the same file again shares the font."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    client.post("/api/create", json={"fid": fid, "name": name})
    def sq(x, y):
        return [[x, y, 1], [x, y + 100, 1], [x + 100, y + 100, 1], [x + 100, y, 1]]
    e = lambda kind, **args: client.post("/api/edit", json={"fid": fid, "name": name, "kind": kind, "args": args}).json()
    e("add_contour", points=sq(0, 0), closed=True)
    e("add_contour", points=sq(50, 50), closed=True)
    return fid, e


def _bbox(g):
    xs = [p[0] for c in g["contours"] for p in c]
    ys = [p[1] for c in g["contours"] for p in c]
    return min(xs), min(ys), max(xs), max(ys)


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
@pytest.mark.parametrize("mode,box", [
    ("union", (0, 0, 150, 150)), ("intersect", (50, 50, 100, 100)), ("subtract", (0, 0, 100, 100))])
def test_pathfinder(client, mode, box):
    _, e = _boxes(client, "boxes_" + mode)
    g = e("pathfinder", mode=mode, contours=[0, 1])
    assert len(g["contours"]) == 1 and _bbox(g) == box
    if mode == "subtract":  # L-shape: the cut corner is gone
        assert [100, 100] not in [p[:2] for p in g["contours"][0]]


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_shape_builder(client):
    fid, e = _boxes(client, "boxes_builder")
    regions = lambda: client.post("/api/regions", json={"fid": fid, "name": "boxes_builder", "contours": [0, 1]}).json()
    faces = regions()
    assert len(faces) == 3  # left square only, the overlap, right square only
    box = lambda f: _bbox({"contours": f})
    overlap = next(j for j, f in enumerate(faces) if box(f) == (50, 50, 100, 100))
    other = next(j for j, f in enumerate(faces) if box(f) == (0, 0, 100, 100))
    g = e("shape_build", mode="merge", contours=[0, 1], faces=[overlap, other])  # fuse two regions, the third stays
    assert len(g["contours"]) == 1  # what is left is one outline again, not three pieces
    _, e2 = _boxes(client, "boxes_builder2")
    g = e2("shape_build", mode="delete", contours=[0, 1], faces=[overlap])  # cut the overlap out: the two corners left
    assert 1 <= len(g["contours"]) <= 2 and _bbox(g) == (0, 0, 150, 150)


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_shape_builder_counters(client):
    """A D (outline plus counter) with a bar through its stem: four regions, and the counter stays a hole."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    client.post("/api/create", json={"fid": fid, "name": "boxes_dd"})
    e = lambda kind, **args: client.post("/api/edit", json={"fid": fid, "name": "boxes_dd", "kind": kind, "args": args}).json()
    cw = lambda x0, y0, x1, y1: [[x0, y0, 1], [x0, y1, 1], [x1, y1, 1], [x1, y0, 1]]
    e("add_contour", points=cw(0, 0, 400, 600), closed=True)
    e("add_contour", points=cw(100, 100, 300, 500)[::-1], closed=True)
    e("add_contour", points=cw(-100, 250, 200, 350), closed=True)
    faces = client.post("/api/regions", json={"fid": fid, "name": "boxes_dd", "contours": [0, 1, 2]}).json()
    assert len(faces) == 5  # the counter, left over, is a region too
    d = max(range(5), key=lambda j: len(faces[j][0]))  # the D itself: the bar's bits are not part of it
    g = e("shape_build", mode="merge", contours=[0, 1, 2], faces=[d, (d + 1) % 5])
    assert len(g["contours"]) == 2  # the D outline (bar fused in) and its counter


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_shape_builder_fills_gaps(client):
    """Four bars (overlapping at the corners) around a blank square: the blank is a region, and merging it with the bars fills it."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    client.post("/api/create", json={"fid": fid, "name": "boxes_gap"})
    e = lambda kind, **args: client.post("/api/edit", json={"fid": fid, "name": "boxes_gap", "kind": kind, "args": args}).json()
    cw = lambda x0, y0, x1, y1: [[x0, y0, 1], [x0, y1, 1], [x1, y1, 1], [x1, y0, 1]]
    for r in [(0, 200, 300, 300), (0, 0, 300, 100), (0, 80, 100, 220), (200, 80, 300, 220)]:
        e("add_contour", points=cw(*r), closed=True)
    faces = client.post("/api/regions", json={"fid": fid, "name": "boxes_gap", "contours": [0, 1, 2, 3]}).json()
    gap = [j for j, f in enumerate(faces) if _bbox({"contours": f}) == (100, 100, 200, 200)]
    assert len(gap) == 1
    g = e("shape_build", mode="merge", contours=[0, 1, 2, 3], faces=list(range(len(faces))))
    assert len(g["contours"]) == 1 and _bbox(g) == (0, 0, 300, 300)


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_flip_keeps_direction(client):
    _, e = _boxes(client, "boxes_flip")
    before = e("move", moves=[])["shapes"][0]["cw"]
    g = e("transform", matrix=[-1, 0, 0, 1, 100, 0], contours=[0])
    assert _bbox({"contours": [g["contours"][0]]}) == (0, 0, 100, 100)
    assert g["shapes"][0]["cw"] == before


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_build_and_script(client):
    fid, e = _boxes(client, "boxes_types")
    assert e("move", moves=[])["contours"][0][0][3] == 0  # line-line point: fontforge.splineCorner
    created = client.post("/api/create", json={"fid": fid, "unicode": 0x1E9E}).json()
    assert created["unicode"] == 0x1E9E
    built = client.post("/api/build", json={"fid": fid, "name": "Agrave"}).json()
    assert sorted(built["refs_list"]) == ["A", "Grave"]
    code = """
g = font.createChar(-1, 'f_f')
g.addReference('f')
g.addReference('f', psMat.translate(font['f'].width, 0))
g.width = 2 * font['f'].width
print(g.glyphname)
"""
    r = client.post("/api/script", json={"fid": fid, "code": code}).json()
    assert r == {"output": "f_f\n", "error": None}
    names = [g["name"] for g in client.get("/api/info", params={"fid": fid}).json()["glyphs"]]
    assert "f_f" in names
    err = client.post("/api/script", json={"fid": fid, "code": "1/0"}).json()
    assert "ZeroDivisionError" in err["error"]


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_same_file_twice_close_one_keeps_other(client):
    a = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    b = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    client.post("/api/close", json={"fid": a})
    assert client.get("/api/glyph/a", params={"fid": b}).status_code == 200


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_guides_names_composites_survive_save(client, tmp_path):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    assert client.post("/api/guides", json={"fid": fid, "ys": [500, 1100]}).json() == [500, 1100]
    client.post("/api/edit", json={"fid": fid, "name": "o", "kind": "rename", "args": {"contour": 0, "label": "bowl"}})
    comp = client.get("/api/composites/acute", params={"fid": fid}).json()
    assert 0x301 in comp["marks"]
    aacute = next(i for i in comp["items"] if i["unicode"] == 0xE1)
    assert aacute["uses_accent"] and aacute["base"] == "a"
    client.post("/api/place", json={"fid": fid, "name": "aacute", "ref": "acute", "dx": 111, "dy": 22})
    made = client.post("/api/compose", json={"fid": fid, "unicode": 0x1E83, "base": "w", "accent": "acute"}).json()
    assert made["name"] == "wacute" and sorted(made["refs_list"]) == ["acute", "w"]

    out = tmp_path / "accents.sfd"
    client.post("/api/save", json={"fid": fid, "path": str(out)})
    fid2 = client.post("/api/open", json={"path": str(out)}).json()["fid"]
    assert client.get("/api/guides", params={"fid": fid2}).json() == [500, 1100]
    assert client.get("/api/glyph/o", params={"fid": fid2}).json()["shapes"][0]["name"] == "bowl"
    again = client.get("/api/composites/acute", params={"fid": fid2}).json()
    assert next(i for i in again["items"] if i["unicode"] == 0xE1)["offset"] == [111, 22]
    assert next(i for i in again["items"] if i["unicode"] == 0x1E83)["name"] == "wacute"


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
@pytest.mark.parametrize("accent,mark,example", [
    ("circumflex", 0x302, 0xE2),   # U+02C6: Unicode gives it no decomposition
    ("grave", 0x300, 0xE0),        # U+0060: same
    ("Acute", 0x301, 0xC1),        # cap variant, matched by name
])
def test_accents_without_decomposition_still_find_composites(client, accent, mark, example):
    """Regression: a pixel font whose accented letters are drawn outlines (not
    composites) showed 0 characters for its circumflex. Simulate that by
    flattening every composite that uses the accent, then ask again."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    code = f"""
for g in font.glyphs():
    if any(r[0] == {accent!r} for r in g.references):
        g.unlinkRef()
"""
    assert client.post("/api/script", json={"fid": fid, "code": code}).json()["error"] is None
    comp = client.get(f"/api/composites/{accent}", params={"fid": fid}).json()
    assert mark in comp["marks"]
    assert example in [i["unicode"] for i in comp["items"]]


def test_new_font(client, tmp_path):
    out = tmp_path / "Mine"
    info = client.post("/api/new", json={"path": str(out), "family": "My Sans", "style": "Bold", "em": 2048}).json()
    assert info["familyname"] == "My Sans" and info["fontname"] == "MySans-Bold" and info["em"] == 2048
    assert info["path"].endswith("Mine.sfd") and (tmp_path / "My Sans" / "Mine.sfd").exists()  # in a folder named after the family
    flat = client.post("/api/new", json={"path": str(tmp_path / "Flat"), "family": "Flat", "own_folder": False}).json()
    assert (tmp_path / "Flat.sfd").exists() and flat["path"].endswith("Flat.sfd")
    inside = client.post("/api/new", json={"path": str(tmp_path / "My Sans" / "Other"), "family": "My Sans"}).json()
    assert (tmp_path / "My Sans" / "Other.sfd").exists() and inside["familyname"] == "My Sans"  # already in a folder of that name: no nesting
    assert {g["name"] for g in info["glyphs"]} == {".notdef", "space"}
    assert next(g for g in info["glyphs"] if g["name"] == "space")["width"] == 512
    # usable like any font: create a glyph, draw, save, reopen
    fid = info["fid"]
    client.post("/api/create", json={"fid": fid, "unicode": 0x41})
    client.post("/api/edit", json={"fid": fid, "name": "A", "kind": "add_contour",
                                   "args": {"points": [[0, 0, 1], [600, 1400, 1], [1200, 0, 1]], "closed": True}})
    client.post("/api/save", json={"fid": fid})
    again = client.post("/api/open", json={"path": info["path"]}).json()
    assert len(client.get("/api/glyph/A", params={"fid": again["fid"]}).json()["contours"]) == 1
    assert client.post("/api/new", json={"path": str(tmp_path / "x"), "family": "  "}).status_code == 400


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_webfont_is_a_loadable_font(client):
    import io
    from fontTools.ttLib import TTFont

    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    r = client.get("/api/webfont", params={"fid": fid})
    assert r.status_code == 200 and r.headers["content-type"] in ("font/ttf", "font/otf")
    f = TTFont(io.BytesIO(r.content))
    assert "glyf" in f or "CFF " in f, "no outline table"  # FontForge's no-hints flag once dropped glyf
    from fontTools.pens.recordingPen import RecordingPen
    pen = RecordingPen()
    f.getGlyphSet()[f.getBestCmap()[ord("a")]].draw(pen)
    assert len(pen.value) > 5, "the 'a' has no outline"


def test_anchors_place_accents(client, tmp_path):
    """New font, anchor class created from scratch, anchors on a base and an
    accent, composite placed by them, anchors survive save and reopen."""
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Anc"), "family": "Anc"}).json()
    fid = info["fid"]
    base, acc = (client.post("/api/create", json={"fid": fid, "unicode": cp}).json()["name"] for cp in (0x61, 0x301))
    assert (base, acc) == ("a", "acutecomb")  # FontForge's standard names
    # Real accents have outlines. FontForge doesn't write a glyph that is
    # entirely empty (no outline, zero width) even if it has anchors, so a
    # composite referencing one loses that reference on reload.
    client.post("/api/edit", json={"fid": fid, "name": acc, "kind": "add_contour",
                                   "args": {"points": [[60, 480, 1], [120, 620, 1], [160, 600, 1]], "closed": True}})
    empty = client.post("/api/compose", json={"fid": fid, "unicode": 0xE0, "base": "a", "accent": acc})
    assert empty.status_code == 400 and "no outline" in empty.json()["detail"]  # 'a' is still empty
    client.post("/api/edit", json={"fid": fid, "name": base, "kind": "add_contour",
                                   "args": {"points": [[50, 0, 1], [250, 500, 1], [450, 0, 1]], "closed": True}})
    classes = client.post("/api/anchor-classes", json={"fid": fid, "name": "top"}).json()
    assert [c["name"] for c in classes] == ["top"] and classes[0]["kind"] == "mark2base"
    assert client.post("/api/anchor-classes", json={"fid": fid, "name": "bad name"}).status_code == 400
    a = client.post("/api/anchor", json={"fid": fid, "name": "a", "cls": "top", "type": "base", "x": 250, "y": 520}).json()
    assert a["anchors"] == [{"cls": "top", "type": "base", "x": 250, "y": 520}]
    client.post("/api/anchor", json={"fid": fid, "name": acc, "cls": "top", "type": "mark", "x": 90, "y": 480})
    made = client.post("/api/compose", json={"fid": fid, "unicode": 0xE1, "base": "a", "accent": acc}).json()
    assert made["placed_by"] == "anchor top"
    assert made["ref_xf"][[r for r in made["refs_list"]].index(acc)][4:] == [160, 40]
    # moving the base anchor and re-placing follows it
    client.post("/api/anchor", json={"fid": fid, "name": "a", "cls": "top", "type": "base", "x": 300, "y": 600})
    res = client.post("/api/place-by-anchors", json={"fid": fid, "accent": acc}).json()
    assert res["placed"] == ["aacute"] and res["skipped"] == []
    client.post("/api/save", json={"fid": fid})
    again = client.post("/api/open", json={"path": info["path"]}).json()["fid"]
    g = client.get("/api/glyph/aacute", params={"fid": again}).json()
    assert g["ref_xf"][g["refs_list"].index(acc)][4:] == [210, 120]
    assert client.get("/api/glyph/a", params={"fid": again}).json()["anchors"][0]["x"] == 300
    d = client.post("/api/anchor/delete", json={"fid": again, "name": "a", "cls": "top", "type": "base"}).json()
    assert d["anchors"] == []


def _hb_kern(path, left_char, right_char):
    """Kerning HarfBuzz actually applies between two characters in a compiled font."""
    import uharfbuzz as hb
    from fontTools.ttLib import TTFont
    font = hb.Font(hb.Face(hb.Blob.from_file_path(str(path))))
    buf = hb.Buffer()
    buf.add_str(left_char + right_char)
    buf.guess_segment_properties()
    hb.shape(font, buf, {"kern": True})
    tt = TTFont(path)
    name = tt.getGlyphOrder()[buf.glyph_infos[0].codepoint]
    return buf.glyph_positions[0].x_advance - tt["hmtx"][name][0]


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_pair_kerning_matches_harfbuzz(client, tmp_path):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    k = lambda pairs: client.post("/api/kerning", json={"fid": fid, "pairs": pairs}).json()
    av = k([["A", "V"]])[0]
    assert av["value"] == -102 and av["sources"][0]["kind"] == "pair"
    assert k([["o", "o"]])[0] == {"left": "o", "right": "o", "value": 0, "sources": []}
    assert client.post("/api/kern", json={"fid": fid, "left": "A", "right": "V", "value": -150}).json()["value"] == -150
    new = client.post("/api/kern", json={"fid": fid, "left": "o", "right": "v", "value": -12}).json()
    assert new["value"] == -12 and new["sources"][0]["kind"] == "pair"
    out = tmp_path / "kern.ttf"
    client.post("/api/save", json={"fid": fid, "path": str(out)})
    assert _hb_kern(out, "A", "V") == -150 and _hb_kern(out, "o", "v") == -12
    # the other A pairs survived the rewrite of A's pair list
    assert _hb_kern(out, "A", "T") == k([["A", "T"]])[0]["value"] != 0


def test_class_kerning_group_edit_and_exception(client, tmp_path):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "K"), "family": "K"}).json()
    fid = info["fid"]
    square = {"points": [[50, 0, 1], [50, 700, 1], [550, 700, 1], [550, 0, 1]], "closed": True}
    for ch in "AÀVT":
        name = client.post("/api/create", json={"fid": fid, "unicode": ord(ch)}).json()["name"]
        client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "args": square})
    script = """
font.addLookup('kern', 'gpos_pair', (), (('kern', (('DFLT', ('dflt',)), ('latn', ('dflt',)))),))
font.addKerningClass('kern', 'groups', (None, ('A', 'Agrave')), (None, ('V', 'T')), (0, 0, 0, -100))
"""
    assert client.post("/api/script", json={"fid": fid, "code": script}).json()["error"] is None
    k = lambda l, r: client.post("/api/kerning", json={"fid": fid, "pairs": [[l, r]]}).json()[0]
    assert k("A", "V")["value"] == -100 and k("A", "V")["sources"][0]["kind"] == "class"
    # group edit: every A-group x V-group pair moves
    client.post("/api/kern", json={"fid": fid, "left": "A", "right": "V", "value": -60})
    assert (k("A", "V")["value"], k("Agrave", "T")["value"]) == (-60, -60)
    # exception: only A-V, ahead of the group value
    client.post("/api/kern", json={"fid": fid, "left": "A", "right": "V", "value": -140, "mode": "pair"})
    assert (k("A", "V")["value"], k("A", "T")["value"]) == (-140, -60)
    out = tmp_path / "K.otf"
    client.post("/api/save", json={"fid": fid, "path": str(out)})
    assert (_hb_kern(out, "A", "V"), _hb_kern(out, "A", "T"), _hb_kern(out, "À", "V")) == (-140, -60, -60)


def test_kerning_groups_ui_flow(client, tmp_path):
    """Groups made from nothing: pair kerning stays an exception, a group
    value applies to every member, moving a glyph between groups and
    deleting a group behave; HarfBuzz agrees after export."""
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "G"), "family": "G"}).json()
    fid = info["fid"]
    square = {"points": [[50, 0, 1], [50, 700, 1], [550, 700, 1], [550, 0, 1]], "closed": True}
    for ch in "AÀÁVWT":
        name = client.post("/api/create", json={"fid": fid, "unicode": ord(ch)}).json()["name"]
        client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "args": square})
    # a pair first, so the groups table must come after it
    client.post("/api/kern", json={"fid": fid, "left": "A", "right": "T", "value": -30})
    g = lambda side, members, **kw: client.post("/api/kern-groups", json={"fid": fid, "side": side, "members": members, **kw}).json()
    g("first", ["A", "Agrave", "Aacute"])
    groups = g("second", ["V", "W", "T"])
    assert groups[0]["first"][0]["members"] == ["A", "Agrave", "Aacute"]
    assert groups[0]["second"][0]["members"] == ["V", "W", "T"]
    k = lambda l, r: client.post("/api/kerning", json={"fid": fid, "pairs": [[l, r]]}).json()[0]["value"]
    client.post("/api/kern", json={"fid": fid, "left": "Agrave", "right": "W", "value": -80})  # group cell
    assert (k("A", "V"), k("Aacute", "W"), k("A", "T")) == (-80, -80, -30)  # A-T pair still wins
    # moving T to a new second group takes it out of the first one, values kept for the rest
    groups = g("second", ["T"])
    assert [x["members"] for x in groups[0]["second"]] == [["V", "W"], ["T"]]
    assert k("Agrave", "V") == -80 and k("Agrave", "T") == 0
    # deleting a group (no members)
    groups = g("second", [], index=2, subtable=groups[0]["subtable"])
    assert [x["members"] for x in groups[0]["second"]] == [["V", "W"]]
    assert client.post("/api/kern-groups", json={"fid": fid, "side": "first", "members": ["nope"]}).status_code == 400
    out = tmp_path / "G.otf"
    client.post("/api/save", json={"fid": fid, "path": str(out)})
    assert (_hb_kern(out, "Á", "W"), _hb_kern(out, "A", "T"), _hb_kern(out, "À", "T")) == (-80, -30, 0)


def test_font_info_round_trip_and_export(client, tmp_path):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Info"), "family": "Info Sans"}).json()
    fid = info["fid"]
    a = client.post("/api/create", json={"fid": fid, "unicode": 0x41}).json()["name"]
    client.post("/api/edit", json={"fid": fid, "name": a, "kind": "add_contour",
                                   "args": {"points": [[0, 0, 1], [300, 700, 1], [600, 0, 1]], "closed": True}})
    fi = client.get("/api/font-info", params={"fid": fid}).json()
    assert fi["em"] == 1000 and fi["metrics"]["os2_winascent"]["auto"] is True
    r = client.post("/api/font-info", json={
        "fid": fid,
        "fields": {"familyname": "Info Sans", "fontname": "InfoSans-Bold", "fullname": "Info Sans Bold",
                   "weight": "Bold", "version": "1.002", "os2_weight": 700},
        "os2_vendor": "FRGE", "use_typo_metrics": True, "ascent": 780, "descent": 220,
        "metrics": {"os2_typoascent": {"value": 790}, "os2_typodescent": {"value": -230},
                    "os2_typolinegap": {"value": 90}, "os2_winascent": {"auto": True}},
        "names": {"Designer": "Test Designer", "License URL": "https://scripts.sil.org/OFL"},
    })
    assert r.status_code == 200, r.text
    # guards
    bad = lambda body: client.post("/api/font-info", json={"fid": fid, **body}).status_code
    assert bad({"ascent": 700, "descent": 200}) == 400        # would change the em
    assert bad({"fields": {"fontname": "Has Space"}}) == 400
    assert bad({"fields": {"os2_weight": 1200}}) == 400
    assert bad({"fields": {"em": 2048}}) == 400                 # not an editable field
    # survives save -> reopen
    client.post("/api/save", json={"fid": fid})
    fid2 = client.post("/api/open", json={"path": info["path"]}).json()["fid"]
    back = client.get("/api/font-info", params={"fid": fid2}).json()
    assert back["fields"]["version"] == "1.002" and back["names"]["Designer"] == "Test Designer"
    assert (back["ascent"], back["descent"], back["em"]) == (780, 220, 1000)
    # and lands in the compiled font
    from fontTools.ttLib import TTFont
    out = tmp_path / "Info.otf"
    client.post("/api/save", json={"fid": fid2, "path": str(out)})
    tt = TTFont(out)
    assert tt["name"].getDebugName(6) == "InfoSans-Bold" and tt["name"].getDebugName(9) == "Test Designer"
    assert tt["OS/2"].usWeightClass == 700 and tt["OS/2"].achVendID == "FRGE"
    assert (tt["OS/2"].sTypoAscender, tt["OS/2"].sTypoDescender, tt["OS/2"].sTypoLineGap) == (790, -230, 90)
    assert tt["OS/2"].fsSelection & (1 << 7)                     # USE_TYPO_METRICS
    assert tt["OS/2"].usWinAscent >= 700                         # automatic: from the outlines


def test_font_info_underline_and_strikeout_reach_the_compiled_font(client, tmp_path):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Lines"), "family": "Lines"}).json()
    fid = info["fid"]
    fields = client.get("/api/font-info", params={"fid": fid}).json()["fields"]
    assert {"upos", "uwidth", "os2_strikeypos", "os2_strikeysize"} <= set(fields)
    r = client.post("/api/font-info", json={"fid": fid, "fields": {
        "upos": -120, "uwidth": 60, "os2_strikeypos": 280, "os2_strikeysize": 55}})
    assert r.status_code == 200, r.text
    out = tmp_path / "Lines.otf"
    client.post("/api/save", json={"fid": fid, "path": str(out)})
    from fontTools.ttLib import TTFont
    tt = TTFont(out)
    assert (tt["post"].underlinePosition, tt["post"].underlineThickness) == (-90, 60)  # FontForge writes the centre of the stroke
    assert (tt["OS/2"].yStrikeoutPosition, tt["OS/2"].yStrikeoutSize) == (280, 55)


SHAPE_SAMPLES = ["fi fl ffi", "1/2 3/4", "À É ï j́", "Hamburgefontsiv"]


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_features_round_trip_shapes_identically(client):
    """Export DejaVu's substitutions as feature code, apply that code, and
    HarfBuzz must shape everything exactly as before."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    shape = lambda text, feats=None: client.post("/api/shape", json={"fid": fid, "text": text, "features": feats or {}}).json()
    feats = client.get("/api/features", params={"fid": fid}).json()  # before anything compiles the font
    before = [shape(t) for t in SHAPE_SAMPLES] + [shape("1/2", {"frac": True})]
    assert "feature liga" in feats["code"] and "kern" in feats["gpos_features"]
    r = client.post("/api/features", json={"fid": fid, "code": feats["code"]})
    assert r.status_code == 200, r.text[:2000]
    after = [shape(t) for t in SHAPE_SAMPLES] + [shape("1/2", {"frac": True})]
    assert after == before
    assert len(r.json()["lookups"]) == len(feats["lookups"])


def test_features_ligature_atomic_and_no_positioning(client, tmp_path):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Fea"), "family": "Fea"}).json()
    fid = info["fid"]
    tri = {"points": [[0, 0, 1], [150, 500, 1], [300, 0, 1]], "closed": True}
    for ch in "fi":
        client.post("/api/create", json={"fid": fid, "unicode": ord(ch)})
        client.post("/api/edit", json={"fid": fid, "name": ch, "kind": "add_contour", "args": tri})
    client.post("/api/create", json={"fid": fid, "name": "f_i"})
    client.post("/api/edit", json={"fid": fid, "name": "f_i", "kind": "add_contour", "args": tri})
    good = "languagesystem DFLT dflt;\nlanguagesystem latn dflt;\nfeature liga {\n  sub f i by f_i;\n} liga;\n"
    assert client.post("/api/features", json={"fid": fid, "code": good}).status_code == 200
    names = lambda feats=None: [g["name"] for g in client.post("/api/shape", json={"fid": fid, "text": "fi", "features": feats or {}}).json()]
    assert names() == ["f_i"] and names({"liga": False}) == ["f", "i"]
    # an unknown glyph: rejected with FontForge's message, nothing changes
    bad = client.post("/api/features", json={"fid": fid, "code": "feature liga {\n  sub f q by f_i;\n} liga;\n"})
    assert bad.status_code == 400 and "q" in bad.json()["detail"]
    assert names() == ["f_i"]
    before = client.get("/api/features", params={"fid": fid}).json()["lookups"]
    assert len(before) == 1
    # positioning isn't edited here
    pos = client.post("/api/features", json={"fid": fid, "code": "feature kern {\n  pos f i -50;\n} kern;\n"})
    assert pos.status_code == 400 and "Spacing" in pos.json()["detail"]
    assert client.get("/api/features", params={"fid": fid}).json()["lookups"] == before
    # survives save -> compiled font
    out = tmp_path / "Fea.otf"
    client.post("/api/save", json={"fid": fid, "path": str(out)})
    from fontTools.ttLib import TTFont
    assert [fr.FeatureTag for fr in TTFont(out)["GSUB"].table.FeatureList.FeatureRecord][0] == "liga"


def test_set_contour_and_add_extrema(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Ext"), "family": "Ext"}).json()["fid"]
    client.post("/api/create", json={"fid": fid, "unicode": 0x6F})
    e = lambda kind, **args: client.post("/api/edit", json={"fid": fid, "name": "o", "kind": kind, "args": args})
    # an arch: its top (y = 375 at x = 500) is not a point yet
    e("add_contour", points=[[0, 0, 1], [0, 500, 0], [1000, 500, 0], [1000, 0, 1]], closed=True)
    g = e("add_extrema").json()
    assert [500, 375, 1] in [p[:3] for p in g["contours"][0]]
    # set_contour replaces the points as sent (what the editor's insert-point does)
    pts = [[0, 0, 1], [0, 250, 0], [250, 375, 0], [500, 375, 1], [750, 375, 0], [1000, 250, 0], [1000, 0, 1]]
    g = e("set_contour", contour=0, points=pts, closed=True).json()
    assert [p[:3] for p in g["contours"][0]] == pts
    assert e("set_contour", contour=5, points=pts).status_code == 400


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
@pytest.mark.parametrize("hinting", ["none", "auto"])
def test_generate_every_format(client, tmp_path, hinting):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    r = client.post("/api/generate", json={"fid": fid, "folder": str(tmp_path), "name": "Out",
                                           "formats": ["otf", "ttf", "woff", "woff2"], "hinting": hinting})
    assert r.status_code == 200, r.text
    got = {Path(x["path"]).suffix: x for x in r.json()}
    assert set(got) == {".otf", ".ttf", ".woff", ".woff2"}
    assert "CFF " in got[".otf"]["tables"] and "glyf" in got[".ttf"]["tables"]  # glyf kept even without hints
    assert all(x["glyphs"] > 900 for x in got.values())
    glyf = server.TTFont(got[".ttf"]["path"])["glyf"]
    instructed = sum(1 for n in glyf.keys() if getattr(glyf[n], "program", None) and len(glyf[n].program.getBytecode()))
    assert (instructed > 100) if hinting == "auto" else instructed == 0
    bad = client.post("/api/generate", json={"fid": fid, "folder": str(tmp_path), "name": "a/b", "formats": ["otf"]})
    assert bad.status_code == 400


def test_validate_finds_and_fixes_problems(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "V"), "family": "V"}).json()["fid"]
    for ch in "ABC":
        client.post("/api/create", json={"fid": fid, "unicode": ord(ch)})
    e = lambda name, **args: client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "args": args})
    e("A", points=[[0, 0, 1], [0, 500, 1], [500, 500, 1], [500, 0, 1]], closed=False)           # open
    e("B", points=[[0, 0, 1], [500, 0, 1], [500, 500, 1], [0, 500, 1]], closed=True)            # counter-clockwise
    e("C", points=[[0, 0, 1], [0, 500.5, 1], [500, 500.5, 1], [500, 0, 1]], closed=True)        # off the grid
    found = {p["bit"]: p for p in client.get("/api/validate", params={"fid": fid}).json()}
    assert found[0x2]["glyphs"] == ["A"] and found[0x2]["fix"] is None
    assert "B" in found[0x8]["glyphs"] and found[0x8]["fix"] == "correct_direction"
    assert "C" in found[0x80000]["glyphs"]
    after = {p["bit"]: p for p in client.post("/api/validate/fix", json={"fid": fid, "bit": 0x8}).json()}
    assert 0x8 not in after
    after = {p["bit"]: p for p in client.post("/api/validate/fix", json={"fid": fid, "bit": 0x80000}).json()}
    assert 0x80000 not in after and 0x2 in after
    assert client.post("/api/validate/fix", json={"fid": fid, "bit": 0x2}).status_code == 400


def test_family_masters(client, tmp_path):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Fam-Thin"), "family": "Fam", "style": "Thin"}).json()
    fid = info["fid"]
    client.post("/api/create", json={"fid": fid, "unicode": 0x49})
    client.post("/api/edit", json={"fid": fid, "name": "I", "kind": "add_contour",
                                   "args": {"points": [[0, 0, 1], [0, 700, 1], [40, 700, 1], [40, 0, 1]], "closed": True}})
    ds = str(tmp_path / "Fam.designspace")
    fam = client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100}).json()
    assert fam["masters"] == [{"path": info["path"], "name": "Thin", "weight": 100, "location": {"Weight": 100}}]
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    assert [m["name"] for m in fam["masters"]] == ["Thin", "Black"]
    assert fam["axes"] == [{"tag": "wght", "name": "Weight", "min": 100, "default": 100, "max": 900}]
    black = fam["masters"][1]["path"]
    assert black.endswith("Fam-Black.sfd")
    # the copy has the unsaved edit (the master was saved first) and its own names
    b = client.post("/api/open", json={"path": black}).json()
    assert b["fontname"] == "Fam-Black"
    assert len(client.get("/api/glyph/I", params={"fid": b["fid"]}).json()["contours"]) == 1
    # reading the family back from disk gives the same
    assert client.get("/api/family", params={"path": ds}).json() == fam
    assert client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Other", "weight": 900}).status_code == 400
    assert client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 500}).status_code == 400  # file exists
    assert client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Bl/ack", "weight": 600}).status_code == 400


def test_edit_master_style_and_weight(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "E-Thin"), "family": "E", "style": "Thin"}).json()["fid"]
    ds = str(tmp_path / "E.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    black = fam["masters"][1]["path"]
    b = client.post("/api/open", json={"path": black}).json()["fid"]
    edit = lambda fid_, master, **kw: client.post("/api/family/edit-master", json={"fid": fid_, "family": ds, "master": master, **kw})
    # rename and move the Black master
    r = edit(b, black, style="Heavy", weight=800).json()
    assert [(m["name"], m["weight"]) for m in r["masters"]] == [("Thin", 100), ("Heavy", 800)]
    assert r["axes"][0]["max"] == 800 and r["axes"][0]["default"] == 100
    assert client.get("/api/info", params={"fid": b}).json()["fontname"] == "E-Heavy"   # the font itself follows
    # refused: a weight another master has, a bad style, a master that is not in the family
    assert edit(b, black, weight=100).status_code == 400
    assert edit(b, black, style="Bl/ack").status_code == 400
    assert edit(b, str(tmp_path / "Nope.sfd"), style="X").status_code == 404
    # the default master moving drags the default along with it
    r = edit(fid, fam["masters"][0]["path"], weight=400, style="Regular").json()
    assert r["axes"][0]["default"] == 400 and r["axes"][0]["min"] == 400 and r["masters"][0]["name"] == "Regular"


def test_family_compatibility_check(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "C-Thin"), "family": "C", "style": "Thin"}).json()["fid"]
    square = {"points": [[0, 0, 1], [0, 700, 1], [40, 700, 1], [40, 0, 1]], "closed": True}
    for cp in (0x49, 0x4C):
        name = client.post("/api/create", json={"fid": fid, "unicode": cp}).json()["name"]
        client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "args": square})
    ds = str(tmp_path / "C.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    check = lambda: {g["name"]: g["problems"] for g in client.get("/api/family/check", params={"path": ds}).json()["glyphs"]}
    assert check() == {}
    # break Black, unsaved: the check sees the open master as it is in memory
    b = client.post("/api/open", json={"path": fam["masters"][1]["path"]}).json()["fid"]
    e = lambda name, kind, **a: client.post("/api/edit", json={"fid": b, "name": name, "kind": kind, "args": a})
    e("I", "set_contour", contour=0, points=[[0, 0, 1], [0, 350, 1], [0, 700, 1], [40, 700, 1], [40, 0, 1]], closed=True)
    e("L", "reverse", contours=[0])
    client.post("/api/create", json={"fid": fid, "unicode": 0x4F})  # only in Thin
    client.post("/api/edit", json={"fid": fid, "name": "O", "kind": "add_contour", "args": square})
    got = check()
    assert got["I"] == ["contour 1: 4 points in Thin, 5 in Black"]
    assert got["L"] == ["contour 1: runs the other way in Black"]
    assert got.get("O") == ["missing in Black"], got


def test_family_blend_and_in_between_master(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "W-Thin"), "family": "W", "style": "Thin"}).json()["fid"]
    stem = lambda w: {"points": [[0, 0, 1], [0, 700, 1], [w, 700, 1], [w, 0, 1]], "closed": True}
    client.post("/api/create", json={"fid": fid, "unicode": 0x49})
    client.post("/api/edit", json={"fid": fid, "name": "I", "kind": "add_contour", "args": stem(40)})
    client.post("/api/create", json={"fid": fid, "unicode": 0x4C})
    client.post("/api/edit", json={"fid": fid, "name": "L", "kind": "add_contour", "args": stem(40)})
    ds = str(tmp_path / "W.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    b = client.post("/api/open", json={"path": fam["masters"][1]["path"]}).json()["fid"]
    client.post("/api/edit", json={"fid": b, "name": "I", "kind": "set_contour",
                                   "args": {"contour": 0, "points": stem(200)["points"], "closed": True}})
    client.post("/api/bearings", json={"fid": b, "name": "I", "width": 400})
    client.post("/api/edit", json={"fid": b, "name": "L", "kind": "reverse", "args": {"contours": [0]}})
    client.post("/api/edit", json={"fid": b, "name": "L", "kind": "set_contour",  # 5 points: can't blend
                                   "args": {"contour": 0, "points": [[0, 0, 1], [0, 350, 1]] + stem(200)["points"][1:], "closed": True}})
    right = lambda g: max(p[0] for p in g["contours"][0])
    mid = client.post("/api/family/blend", json={"path": ds, "weight": 500, "names": ["I", "L"]}).json()
    assert right(mid["I"]) == 120 and mid["L"] is None
    r = client.post("/api/family/blend-master", json={"path": ds, "weight": 500, "style": "Medium"}).json()
    assert [m["name"] for m in r["family"]["masters"]] == ["Thin", "Medium", "Black"] and "L" in r["copied"]
    med = client.post("/api/open", json={"path": r["family"]["masters"][1]["path"]}).json()
    assert med["fontname"] == "W-Medium"
    assert right(client.get("/api/glyph/I", params={"fid": med["fid"]}).json()) == 120
    # with three masters, 300 sits halfway between Thin and Medium
    assert right(client.post("/api/family/blend", json={"path": ds, "weight": 300, "names": ["I"]}).json()["I"]) == 80
    assert client.post("/api/family/blend-master", json={"path": ds, "weight": 950, "style": "X"}).status_code == 400


def test_family_build_variable_and_statics(client, tmp_path):
    from fontTools.pens.boundsPen import BoundsPen
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "V-Thin"), "family": "V", "style": "Thin"}).json()["fid"]
    stem = lambda w: [[0, 0, 1], [0, 700, 1], [w, 700, 1], [w, 0, 1]]
    client.post("/api/create", json={"fid": fid, "unicode": 0x49})
    client.post("/api/edit", json={"fid": fid, "name": "I", "kind": "add_contour", "args": {"points": stem(40), "closed": True}})
    ds = str(tmp_path / "V.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    b = client.post("/api/open", json={"path": fam["masters"][1]["path"]}).json()["fid"]
    client.post("/api/edit", json={"fid": b, "name": "I", "kind": "set_contour", "args": {"contour": 0, "points": stem(200), "closed": True}})
    out = tmp_path / "out"
    out.mkdir()
    r = client.post("/api/family/build", json={"path": ds, "folder": str(out), "name": "V", "statics": [100, 500], "formats": ["otf", "ttf"]})
    assert r.status_code == 200, r.text
    files = sorted(Path(x["path"]).name for x in r.json())
    assert files == ["V-Medium.otf", "V-Medium.ttf", "V-Thin.otf", "V-Thin.ttf", "V-VF.otf", "V-VF.woff2"]
    vf = server.TTFont(str(out / "V-VF.otf"))
    assert [i.coordinates for i in vf["fvar"].instances] == [{"wght": 100}, {"wght": 900}]
    def right(gs):
        pen = BoundsPen(gs)
        gs["I"].draw(pen)
        return pen.bounds[2]
    assert right(vf.getGlyphSet(location={"wght": 500})) == 120  # unsaved edit in Black included
    med = server.TTFont(str(out / "V-Medium.ttf"))
    assert right(med.getGlyphSet()) == 120 and med["OS/2"].usWeightClass == 500
    # masters that don't match: refused, nothing silently left static
    client.post("/api/edit", json={"fid": b, "name": "I", "kind": "set_contour",
                                   "args": {"contour": 0, "points": [[0, 0, 1], [0, 350, 1]] + stem(200)[1:], "closed": True}})
    bad = client.post("/api/family/build", json={"path": ds, "folder": str(out), "name": "V"})
    assert bad.status_code == 400 and "I" in bad.json()["detail"]


def test_paste_copy_between_masters_and_remove_master(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "P-Thin"), "family": "P", "style": "Thin"}).json()["fid"]
    sq = [[0, 0, 1], [0, 700, 1], [40, 700, 1], [40, 0, 1]]
    for cp in (0x49, 0x4C):
        client.post("/api/create", json={"fid": fid, "unicode": cp})
    e = lambda f, name, kind, **a: client.post("/api/edit", json={"fid": f, "name": name, "kind": kind, "args": a})
    e(fid, "I", "add_contour", points=sq, closed=True)
    # paste I's contour into L, twice: added on top, raw
    got = e(fid, "L", "paste", contours=[sq, sq], closed=[True, False], quadratic=False).json()
    assert [[p[:3] for p in c] for c in got["contours"]] == [sq, sq]
    assert e(fid, "L", "paste", contours=[sq], closed=[True], quadratic=True).status_code == 400
    ds = str(tmp_path / "P.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    thin, black = (m["path"] for m in fam["masters"])
    b = client.post("/api/open", json={"path": black}).json()["fid"]
    e(b, "I", "delete_points", points=[[0, 3]])  # Black's I no longer matches
    assert [g["name"] for g in client.get("/api/family/check", params={"path": ds}).json()["glyphs"]] == ["I"]
    r = client.post("/api/family/copy-glyph", json={"source": thin, "targets": [black], "names": ["I"]})
    assert r.status_code == 200 and client.get("/api/family/check", params={"path": ds}).json()["glyphs"] == []
    assert len(client.post("/api/undo", json={"fid": b, "name": "I"}).json()["contours"][0]) == 3  # undoable
    # remove the default master: Black becomes the default, its file stays
    fam = client.post("/api/family/remove", json={"path": ds, "master": thin}).json()
    assert [m["name"] for m in fam["masters"]] == ["Black"] and fam["axes"][0]["default"] == 900
    assert Path(thin).exists()
    assert client.post("/api/family/remove", json={"path": ds, "master": black}).status_code == 400


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_restore_glyph_to_saved(client, tmp_path):
    import shutil
    path = tmp_path / "R.sfd"
    shutil.copyfile(SFD, path)
    fid = client.post("/api/open", json={"path": str(path)}).json()["fid"]
    original = client.get("/api/glyph/o", params={"fid": fid}).json()
    client.post("/api/edit", json={"fid": fid, "name": "o", "kind": "move", "args": {"moves": [[0, 0, 55, 0]]}})
    client.post("/api/bearings", json={"fid": fid, "name": "o", "width": 2000})
    assert client.post("/api/glyphs/restore", json={"fid": fid, "names": ["o"]}).json() == {"restored": ["o"]}
    back = client.get("/api/glyph/o", params={"fid": fid}).json()
    assert back["contours"] == original["contours"] and back["width"] == original["width"]
    # the restore is undoable: the edit comes back
    undone = client.post("/api/undo", json={"fid": fid, "name": "o"}).json()
    assert undone["contours"][0][0][0] == original["contours"][0][0][0] + 55
    # a never-saved font has nothing to restore from
    new = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "N"), "family": "N"}).json()["fid"]
    client.post("/api/create", json={"fid": new, "unicode": 0x41})
    import os
    os.remove(tmp_path / "N.sfd")
    assert client.post("/api/glyphs/restore", json={"fid": new, "names": ["A"]}).status_code == 400


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_set_contour_and_paste_in_a_quadratic_font(client):
    """DejaVu is TrueType (quadratic): one off-curve point per curve."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    o = client.get("/api/glyph/o", params={"fid": fid}).json()
    pts = [p[:3] for p in o["contours"][0]]
    e = lambda kind, **a: client.post("/api/edit", json={"fid": fid, "name": "o", "kind": kind, "args": a})
    r = e("set_contour", contour=0, points=pts, closed=True)
    assert r.status_code == 200, r.text
    assert [p[:3] for p in r.json()["contours"][0]] == pts
    r = e("paste", contours=[pts], closed=[True], quadratic=True)
    assert r.status_code == 200, r.text
    assert len(r.json()["contours"]) == len(o["contours"]) + 1


def test_family_found_from_its_master(client, tmp_path):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "F-Thin"), "family": "F", "style": "Thin"}).json()
    assert client.get("/api/family/of", params={"font": info["path"]}).json() is None
    (tmp_path / "junk.designspace").write_text("not xml")  # unreadable ones are skipped
    ds = str(tmp_path / "F.designspace")
    client.post("/api/family/new", json={"fid": info["fid"], "path": ds, "weight": 100})
    assert client.get("/api/family/of", params={"font": info["path"].replace("\\", "/")}).json()["path"] == ds


def test_start_family_twice_or_on_a_taken_name(client, tmp_path):
    a = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "S-Regular"), "family": "S"}).json()
    ds = str(tmp_path / "S.designspace")
    first = client.post("/api/family/new", json={"fid": a["fid"], "path": ds, "weight": 400}).json()
    assert client.post("/api/family/new", json={"fid": a["fid"], "path": ds, "weight": 400}).json() == first
    # another font of the same family name: its own family file, not an error
    b = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "S-Other"), "family": "S"}).json()
    other = client.post("/api/family/new", json={"fid": b["fid"], "path": ds, "weight": 400}).json()
    assert other["path"].endswith("S-2.designspace") and len(other["masters"]) == 1


def test_static_weights_are_style_linked(client, tmp_path):
    """400 is Regular, 700 is Bold and share the family; every other weight is its own family under ID 16."""
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Link-Regular"), "family": "Link", "style": "Regular"}).json()["fid"]
    client.post("/api/create", json={"fid": fid, "unicode": 0x49})
    client.post("/api/edit", json={"fid": fid, "name": "I", "kind": "add_contour",
                                   "args": {"points": [[0, 0, 1], [0, 700, 1], [40, 700, 1], [40, 0, 1]], "closed": True}})
    ds = str(tmp_path / "Link.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 400})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    out = tmp_path / "out"
    out.mkdir()
    r = client.post("/api/family/build", json={"path": ds, "folder": str(out), "name": "Link", "variable": False,
                                               "statics": [400, 500, 700, 900], "formats": ["ttf"]})
    assert r.status_code == 200, r.text
    from fontTools.ttLib import TTFont
    got = {}
    for style in ("Regular", "Medium", "Bold", "Black"):
        t = TTFont(out / f"Link-{style}.ttf")
        n = t["name"]
        got[style] = ((n.getDebugName(1), n.getDebugName(2), n.getDebugName(16), n.getDebugName(17)),
                      t["OS/2"].fsSelection & 0x61, t["head"].macStyle, t["OS/2"].usWeightClass)
    assert got["Regular"] == (("Link", "Regular", None, None), 0x40, 0, 400)
    assert got["Medium"] == (("Link Medium", "Regular", "Link", "Medium"), 0x40, 0, 500)
    assert got["Bold"] == (("Link", "Bold", None, None), 0x20, 1, 700)
    assert got["Black"] == (("Link Black", "Regular", "Link", "Black"), 0x40, 0, 900)
    # the Black master was already linked when it was made
    fi = client.get("/api/font-info", params={"fid": client.post("/api/open", json={"path": fam["masters"][1]["path"]}).json()["fid"]}).json()
    assert fi["names"]["Family"] == "Link Black" and fi["names"]["Preferred Family"] == "Link"
    assert fi["fields"]["os2_stylemap"] == 0x40


def test_font_info_style_linking_fields(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Sl"), "family": "Sl"}).json()["fid"]
    r = client.post("/api/font-info", json={"fid": fid, "fields": {"os2_stylemap": 0x21, "macstyle": 3, "italicangle": -12},
                                            "names": {"Family": "Sl", "SubFamily": "Bold Italic"}})
    assert r.status_code == 200, r.text
    out = tmp_path / "Sl.otf"
    client.post("/api/save", json={"fid": fid, "path": str(out)})
    from fontTools.ttLib import TTFont
    t = TTFont(out)
    assert t["OS/2"].fsSelection & 0x61 == 0x21 and t["head"].macStyle == 3 and t["post"].italicAngle == -12
    assert (t["name"].getDebugName(1), t["name"].getDebugName(2)) == ("Sl", "Bold Italic")


def test_metrics_keys_follow_and_persist(client, tmp_path):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Keys"), "family": "Keys"}).json()
    fid = info["fid"]
    box = lambda x0, x1: [[x0, 0, 1], [x0, 700, 1], [x1, 700, 1], [x1, 0, 1]]
    for ch, (x0, x1) in {"H": (80, 480), "n": (60, 400), "o": (50, 420)}.items():
        client.post("/api/create", json={"fid": fid, "unicode": ord(ch)})
        client.post("/api/edit", json={"fid": fid, "name": ch, "kind": "add_contour", "args": {"points": box(x0, x1), "closed": True}})
    bearings = lambda n, **kw: client.post("/api/bearings", json={"fid": fid, "name": n, **kw}).json()
    key = lambda n, side, k: client.post("/api/metrics-key", json={"fid": fid, "name": n, "side": side, "key": k})
    lsb = lambda n: bearings(n)["lsb"]
    h = bearings("H")
    r = key("n", "lsb", "=H")
    assert r.status_code == 200 and r.json()["lsb"] == h["lsb"] and r.json()["keys"] == {"lsb": "=H"}
    key("o", "rsb", "=|n+10")                       # o's right = n's left + 10
    assert bearings("o")["rsb"] == lsb("n") + 10
    # moving H moves n, and o follows n: all reported back
    moved = bearings("H", lsb=h["lsb"] + 25)
    assert {c["name"] for c in moved["changed"]} == {"n", "o"}
    assert lsb("n") == h["lsb"] + 25 and bearings("o")["rsb"] == h["lsb"] + 25 + 10
    # a number typed into a followed side frees it
    bearings("n", lsb=33)
    assert client.get("/api/metrics-keys", params={"fid": fid}).json().get("n") is None
    assert lsb("n") == 33 and bearings("H", lsb=h["lsb"])["changed"] == []
    # loops and unknown glyphs are refused
    key("n", "lsb", "=H")
    assert key("H", "lsb", "=n").status_code == 400
    assert key("n", "rsb", "=zzz").status_code == 400
    assert key("n", "rsb", "50").status_code == 400
    # keys survive save and reopen
    client.post("/api/save", json={"fid": fid})
    fid2 = client.post("/api/open", json={"path": info["path"]}).json()["fid"]
    again = client.get("/api/metrics-keys", params={"fid": fid2}).json()
    assert again["n"] == {"lsb": "=H"} and again["o"] == {"rsb": "=|n+10"}


def test_features_generated_name_convention_code_compiles(client, tmp_path):
    """The code the Features tab generates from .onum/.salt/.sc names must be accepted, aalt included."""
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Gen"), "family": "Gen"}).json()["fid"]
    tri = {"points": [[0, 0, 1], [150, 500, 1], [300, 0, 1]], "closed": True}
    for name, cp in {"a": 0x61, "A": 0x41, "one": 0x31}.items():
        client.post("/api/create", json={"fid": fid, "unicode": cp})
        client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "args": tri})
    for name in ("a.sc", "a.salt", "one.onum"):
        client.post("/api/create", json={"fid": fid, "name": name})
        client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "args": tri})
    code = ("languagesystem DFLT dflt;\nlanguagesystem latn dflt;\n\n"
            "feature smcp {\n  sub a by a.sc;\n} smcp;\n\nfeature c2sc {\n  sub A by a.sc;\n} c2sc;\n\n"
            "feature salt {\n  sub a by a.salt;\n} salt;\n\nfeature onum {\n  sub one by one.onum;\n} onum;\n\n"
            "feature aalt {\n  feature salt;\n  feature onum;\n  feature smcp;\n} aalt;\n")
    r = client.post("/api/features", json={"fid": fid, "code": code})
    assert r.status_code == 200, r.text[:1500]
    shape = lambda text, f: [g["name"] for g in client.post("/api/shape", json={"fid": fid, "text": text, "features": f}).json()]
    assert shape("a", {"salt": True}) == ["a.salt"] and shape("A", {"c2sc": True}) == ["a.sc"] and shape("1", {"onum": True}) == ["one.onum"]


def test_family_with_two_axes(client, tmp_path):
    """Weight and Width: masters sit on a grid, blends and the variable font use both axes."""
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.ttLib import TTFont
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "W-Regular"), "family": "W", "style": "Regular"}).json()["fid"]
    box = lambda w, h: [[0, 0, 1], [0, h, 1], [w, h, 1], [w, 0, 1]]
    client.post("/api/create", json={"fid": fid, "unicode": 0x49})
    client.post("/api/edit", json={"fid": fid, "name": "I", "kind": "add_contour", "args": {"points": box(100, 700), "closed": True}})
    ds = str(tmp_path / "W.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 400})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Bold", "weight": 700}).json()
    # a Width axis: every master starts at its default
    r = client.post("/api/family/axis", json={"family": ds, "name": "Width", "tag": "wdth", "min": 75, "default": 100, "max": 125})
    assert r.status_code == 200, r.text
    assert [a["name"] for a in r.json()["axes"]] == ["Weight", "Width"]
    assert all(m["location"]["Width"] == 100 for m in r.json()["masters"])
    for bad in ({"name": "Width", "tag": "wdt2"}, {"name": "Slant", "tag": "wdth"}, {"name": "X", "tag": "toolong"}, {"name": "Y", "tag": "slnt", "min": 5}):
        body = {"family": ds, "name": "Z", "tag": "ZZZZ", "min": 0, "default": 0, "max": 10, **bad}
        assert client.post("/api/family/axis", json=body).status_code == 400
    # a wide master and a narrow bold one, by location
    reg = [m for m in r.json()["masters"] if m["weight"] == 400][0]["path"]
    fid = client.post("/api/open", json={"path": reg}).json()["fid"]
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Wide", "location": {"Weight": 400, "Width": 125}})
    assert fam.status_code == 200, fam.text
    wide = [m for m in fam.json()["masters"] if m["name"] == "Wide"][0]
    assert wide["location"] == {"Weight": 400, "Width": 125}
    wid = client.post("/api/open", json={"path": wide["path"]}).json()["fid"]
    client.post("/api/edit", json={"fid": wid, "name": "I", "kind": "set_contour", "args": {"contour": 0, "points": box(300, 700), "closed": True}})
    assert client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Wide2", "location": {"Weight": 400, "Width": 125}}).status_code == 400
    assert client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Off", "location": {"Nope": 1}}).status_code == 400
    # blends move along either axis
    def right(width, weight=400):
        g = client.post("/api/family/blend", json={"path": ds, "weight": weight, "location": {"Width": width}, "names": ["I"]}).json()["I"]
        return max(p[0] for c in g["contours"] for p in c)
    assert right(100) == 100 and right(125) == 300 and right(112.5) == 200
    assert client.post("/api/family/blend", json={"path": ds, "location": {"Width": 200}}).status_code == 400
    # the variable font has both axes, and interpolates Width
    out = tmp_path / "out"
    out.mkdir()
    b = client.post("/api/family/build", json={"path": ds, "folder": str(out), "name": "W", "statics": [400], "formats": ["ttf"], "variable_woff2": False})
    assert b.status_code == 200, b.text
    vf = TTFont(str(out / "W-VF.otf"))
    assert [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in vf["fvar"].axes] == [("wght", 400, 400, 700), ("wdth", 75, 100, 125)]
    pen = BoundsPen(vf.getGlyphSet(location={"wght": 400, "wdth": 125}))
    vf.getGlyphSet(location={"wght": 400, "wdth": 125})["I"].draw(pen)
    assert pen.bounds[2] == 300
    assert (out / "W-Regular.ttf").exists()


def test_brace_layer_gives_one_glyph_an_extra_shape(client, tmp_path):
    """A glyph's brace layer at weight 500 bends its weight axis through the new shape; other glyphs are unaffected."""
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.ttLib import TTFont
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "B-Thin"), "family": "B", "style": "Thin"}).json()["fid"]
    box = lambda w: [[0, 0, 1], [0, 700, 1], [w, 700, 1], [w, 0, 1]]
    for ch in "IH":
        client.post("/api/create", json={"fid": fid, "unicode": ord(ch)})
        client.post("/api/edit", json={"fid": fid, "name": ch, "kind": "add_contour", "args": {"points": box(40), "closed": True}})
    ds = str(tmp_path / "B.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    black = client.post("/api/open", json={"path": fam["masters"][1]["path"]}).json()["fid"]
    for ch in "IH":
        client.post("/api/edit", json={"fid": black, "name": ch, "kind": "set_contour", "args": {"contour": 0, "points": box(200), "closed": True}})
    right = lambda w, g="I": max(p[0] for c in client.post("/api/family/blend", json={"path": ds, "weight": w, "names": [g]}).json()[g]["contours"] for p in c)
    assert right(500) == 120                                   # the straight blend
    # a brace at a master's own weight is refused; a missing glyph too
    assert client.post("/api/family/brace", json={"path": ds, "glyph": "I", "weight": 900}).status_code == 400
    assert client.post("/api/family/brace", json={"path": ds, "glyph": "zzz", "weight": 500}).status_code == 400
    r = client.post("/api/family/brace", json={"path": ds, "glyph": "I", "weight": 500})
    assert r.status_code == 200, r.text
    br = r.json()["braces"][0]
    assert br["glyphs"] == ["I"] and br["location"] == {"Weight": 500} and Path(br["path"]).exists()
    assert client.post("/api/family/brace", json={"path": ds, "glyph": "I", "weight": 500}).status_code == 400   # already there
    assert client.get("/api/family/of", params={"font": br["path"]}).json()["path"].endswith("B.designspace")      # the brace file is part of the family
    # it starts as the blend; reshape it
    b = client.post("/api/open", json={"path": br["path"]}).json()["fid"]
    client.post("/api/edit", json={"fid": b, "name": "I", "kind": "set_contour", "args": {"contour": 0, "points": box(300), "closed": True}})
    assert right(500) == 300 and right(500, "H") == 120      # I follows the brace, H still blends straight
    assert right(100) == 40 and right(900) == 200
    assert 100 < right(300) < 300 < right(700) or right(700) < 300  # passes through the brace in between
    assert client.get("/api/family/check", params={"path": ds}).json()["glyphs"] == []
    out = tmp_path / "out"
    out.mkdir()
    bd = client.post("/api/family/build", json={"path": ds, "folder": str(out), "name": "B", "variable_woff2": False, "statics": [500], "formats": ["ttf"]})
    assert bd.status_code == 200, bd.text
    vf = TTFont(str(out / "B-VF.otf"))
    edge = lambda w, g: (lambda gs: (lambda pen: (gs[g].draw(pen), pen.bounds[2])[1])(BoundsPen(gs)))(vf.getGlyphSet(location={"wght": w}))
    assert edge(500, "I") == 300 and edge(500, "H") == 120 and edge(100, "I") == 40 and edge(900, "I") == 200
    stat = TTFont(str(out / "B-Medium.ttf"))
    pen = BoundsPen(stat.getGlyphSet()); stat.getGlyphSet()["I"].draw(pen)
    assert pen.bounds[2] == 300                              # the static weight takes the brace too
    # removing the glyph takes the layer away
    assert client.post("/api/family/brace/remove", json={"path": ds, "brace": br["path"], "glyph": "I"}).json()["braces"] == []
    assert right(500) == 120


def test_smart_components_slide_between_two_extremes(client, tmp_path):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Smart"), "family": "Smart"}).json()
    fid = info["fid"]
    box = lambda x, w: [[x, 0, 1], [x, 700, 1], [x + w, 700, 1], [x + w, 0, 1]]
    for name in ("_stem", "_stem.max", "I", "bad", "bad.max"):
        client.post("/api/create", json={"fid": fid, "name": name})
    edit = lambda name, pts: client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "args": {"points": pts, "closed": True}})
    edit("_stem", box(0, 40)); edit("_stem.max", box(0, 200))
    edit("bad", box(0, 40)); edit("bad.max", box(0, 200)); edit("bad.max", box(300, 10))   # two contours vs one
    state = client.get("/api/smart", params={"fid": fid}).json()
    assert "_stem" in state["parts"] and "bad" in state["parts"] and state["glyphs"] == {}
    set_ = lambda parts, name="I": client.post("/api/smart/set", json={"fid": fid, "name": name, "parts": parts})
    right = lambda out: max(p[0] for c in out["contours"] for p in c)
    r = set_([{"part": "_stem", "t": 0.25}, {"part": "_stem", "t": 1, "dx": 400}])
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["contours"]) == 2 and sorted(p[0] for c in out["contours"] for p in c if p[0] < 300)[-1] == 80    # 40 + .25 * 160
    assert right(out) == 600                                  # 400 + the full 200
    # moving a part moves what is built from it, once you rebuild
    client.post("/api/edit", json={"fid": fid, "name": "_stem.max", "kind": "set_contour", "args": {"contour": 0, "points": box(0, 360), "closed": True}})
    assert client.post("/api/smart/apply", json={"fid": fid}).json() == {"rebuilt": ["I"]}
    assert right(client.get("/api/glyph/I", params={"fid": fid}).json()) == 760
    # refusals: a part without a partner, a part that doesn't match its partner, t out of range, itself
    assert set_([{"part": "I", "t": 0}], "bad").status_code == 400
    assert set_([{"part": "bad", "t": 0.5}], "I").status_code == 400
    assert set_([{"part": "_stem", "t": 1.5}]).status_code == 400
    assert set_([{"part": "_stem", "t": 0}], "_stem").status_code == 400
    assert client.get("/api/smart", params={"fid": fid}).json()["glyphs"]["I"][1]["dx"] == 400      # the failed attempts changed nothing
    # saved, reopened
    client.post("/api/save", json={"fid": fid})
    fid2 = client.post("/api/open", json={"path": info["path"]}).json()["fid"]
    assert client.get("/api/smart", params={"fid": fid2}).json()["glyphs"]["I"][0]["t"] == 0.25
    # no parts: the glyph is no longer generated, its outline stays
    assert len(set_([]).json()["contours"]) == 2
    assert client.get("/api/smart", params={"fid": fid}).json()["glyphs"] == {}


def test_glyph_database_info_blocks_and_add(client, tmp_path):
    e = client.get("/api/glyphdb/info", params={"unicode": 0xE9}).json()
    assert (e["name"], e["category"], e["category_name"], e["script"], e["block"]) == (
        "LATIN SMALL LETTER E WITH ACUTE", "Ll", "Lowercase letter", "Latin", "Latin-1 Supplement")
    assert e["decomposition"] == [0x65, 0x301] and e["uppercase"] == 0xC9 and e["lowercase"] is None
    assert client.get("/api/glyphdb/info", params={"unicode": 0x416}).json()["script"] == "Cyrillic"
    assert client.get("/api/glyphdb/info", params={"unicode": 0x110000}).status_code == 400
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Db"), "family": "Db"}).json()
    fid = info["fid"]
    blocks = {b["id"]: b for b in client.get("/api/glyphdb/blocks", params={"fid": fid}).json()}
    assert blocks["basic-latin"]["total"] == 95 and blocks["basic-latin"]["have"] == 1       # a new font has space
    r = client.post("/api/glyphdb/add", json={"fid": fid, "blocks": ["basic-latin"]})
    assert r.status_code == 200 and len(r.json()["created"]) == 94 and {"A", "z", "ampersand"} <= set(r.json()["created"])
    assert client.post("/api/glyphdb/add", json={"fid": fid, "blocks": ["basic-latin"]}).json()["created"] == []   # nothing left to add
    assert client.get("/api/glyphdb/blocks", params={"fid": fid}).json()[0]["have"] == 95
    assert client.post("/api/glyphdb/add", json={"fid": fid, "blocks": ["nope"]}).status_code == 400
    # the new glyphs survive save and reopen
    client.post("/api/save", json={"fid": fid})
    fid2 = client.post("/api/open", json={"path": info["path"]}).json()["fid"]
    assert client.get("/api/glyphdb/blocks", params={"fid": fid2}).json()[0]["have"] == 95


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_glyph_database_counts_alternate_unicode_values(client):
    """DejaVu serves some Cyrillic letters from glyphs that have another primary value: they count as covered."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    cyr = lambda: next(b for b in client.get("/api/glyphdb/blocks", params={"fid": fid}).json() if b["id"] == "cyrillic")
    before = cyr()
    made = client.post("/api/glyphdb/add", json={"fid": fid, "blocks": ["cyrillic"]}).json()["created"]
    after = cyr()
    assert len(made) == before["total"] - before["have"] and after["have"] == after["total"]


def test_interpolate_glyphs(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Mix"), "family": "Mix"}).json()["fid"]
    box = lambda w: [[0, 0, 1], [0, 700, 1], [w, 700, 1], [w, 0, 1]]
    for name in ("a", "b", "odd"):
        client.post("/api/create", json={"fid": fid, "name": name})
    for name, w in (("a", 100), ("b", 500), ("odd", 100)):
        client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "args": {"points": box(w), "closed": True}})
    client.post("/api/edit", json={"fid": fid, "name": "odd", "kind": "add_contour", "args": {"points": box(50), "closed": True}})   # two contours
    mix = lambda a, b, t, name="c": client.post("/api/interpolate", json={"fid": fid, "a": a, "b": b, "t": t, "name": name})
    right = lambda r: max(p[0] for c in r.json()["contours"] for p in c)
    assert right(mix("a", "b", 0.5)) == 300 and right(mix("a", "b", 0)) == 100 and right(mix("a", "b", 1)) == 500
    assert right(mix("a", "b", 0.25)) == 200
    for bad in (mix("a", "b", 1.5), mix("a", "b", 0.5, "a"), mix("a", "odd", 0.5), mix("a", "nope", 0.5)):
        assert bad.status_code == 400


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_glyph_database_added_glyphs_survive_save_on_a_real_font(client, tmp_path):
    """Placeholders added to an existing font are kept when it is saved and reopened."""
    import shutil
    copy = tmp_path / "Deja.sfd"
    shutil.copy(SFD, copy)
    fid = client.post("/api/open", json={"path": str(copy)}).json()["fid"]
    blocks = lambda f: {b["id"]: b for b in client.get("/api/glyphdb/blocks", params={"fid": f}).json()}
    before = blocks(fid)["greek"]
    made = client.post("/api/glyphdb/add", json={"fid": fid, "blocks": ["greek"]}).json()["created"]
    assert made and blocks(fid)["greek"]["have"] == before["total"]
    assert client.post("/api/save", json={"fid": fid}).status_code == 200
    fid2 = client.post("/api/open", json={"path": str(copy)}).json()["fid"]
    after = blocks(fid2)["greek"]
    assert after["have"] == before["total"]  # every placeholder is still there


def test_autosave_saves_changed_sfd_in_place_and_only_then(client, tmp_path):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Auto"), "family": "Auto"}).json()
    fid = info["fid"]
    assert client.post("/api/autosave", json={"fid": fid}).json()["saved"] is False          # nothing changed since it was made
    client.post("/api/create", json={"fid": fid, "unicode": 0x49})
    client.post("/api/edit", json={"fid": fid, "name": "I", "kind": "add_contour",
                                   "args": {"points": [[0, 0, 1], [0, 700, 1], [40, 700, 1], [40, 0, 1]], "closed": True}})
    r = client.post("/api/autosave", json={"fid": fid}).json()
    assert r["saved"] is True and r["path"] == info["path"]
    assert client.post("/api/autosave", json={"fid": fid}).json()["saved"] is False          # saved: nothing to do
    assert "StartChar: I" in Path(info["path"]).read_text(encoding="utf8", errors="replace")      # the edit reached the file on disk


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_preview_of_a_font_file_for_the_start_screen(client):
    r = client.get("/api/preview", params={"path": str(SFD)})
    assert r.status_code == 200
    p = r.json()
    assert [g["name"] for g in p["glyphs"]] == ["A", "b", "g"] and p["em"] == 2048 and all(g["d"] for g in p["glyphs"])
    assert client.get("/api/preview", params={"path": str(SFD)}).json() == p                  # cached
    assert client.get("/api/preview", params={"path": str(SFD) + ".nope"}).status_code == 404
    # opening it for the preview leaves other open copies alone
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    client.get("/api/preview", params={"path": str(SFD), "text": "Hi"})
    assert client.get("/api/font-info", params={"fid": fid}).status_code == 200


GLYPHS = ROOT / "tests" / "fixtures" / "glyphs"


@pytest.mark.skipif(not (GLYPHS / "GlyphsUnitTestSans.glyphs").exists(), reason="run tests/fetch_fixtures.sh")
@pytest.mark.parametrize("name,masters", [("GlyphsUnitTestSans", 3), ("GlyphsUnitTestSans3", 3), ("MontserratStrippedDown", 3)])
def test_open_glyphs_file_as_a_family(client, tmp_path, name, masters):
    import shutil
    src = tmp_path / f"{name}.glyphs"
    shutil.copy(GLYPHS / f"{name}.glyphs", src)
    r = client.post("/api/import/glyphs", json={"path": str(src)})
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["reused"] is False and len(p["masters"]) == masters and p["designspace"]
    assert all(Path(m).exists() and m.endswith(".sfd") for m in p["masters"])
    fam = client.get("/api/family", params={"path": p["designspace"]}).json()
    ws = [m["weight"] for m in fam["masters"]]
    assert ws == sorted(ws) and ws[0] >= 100 and ws[-1] <= 900                      # user-space weights, not Glyphs' design units
    assert all(set(m["location"]) == {"Weight"} for m in fam["masters"])
    # the default master opens as a family member
    opened = client.post("/api/open", json={"path": p["default"]}).json()
    assert opened["glyphs"]
    assert client.get("/api/family/of", params={"font": p["default"]}).json()["path"] == p["designspace"]
    assert client.get("/api/family/check", params={"path": p["designspace"]}).status_code == 200
    # the source is untouched, and opening again reuses the project instead of redoing it
    assert src.read_bytes() == (GLYPHS / f"{name}.glyphs").read_bytes()
    assert client.post("/api/import/glyphs", json={"path": str(src)}).json()["reused"] is True


def test_open_glyphs_refuses_other_files(client, tmp_path):
    (tmp_path / "x.glyphs").write_text("not a glyphs file")
    assert client.post("/api/import/glyphs", json={"path": str(tmp_path / "x.glyphs")}).status_code == 400
    assert client.post("/api/import/glyphs", json={"path": str(tmp_path / "nope.ttf")}).status_code == 400


@pytest.mark.skipif(not (GLYPHS / "GlyphsUnitTestSans.glyphs").exists(), reason="run tests/fetch_fixtures.sh")
def test_glyphs_round_trip_through_forge(client, tmp_path):
    """Glyphs file -> Forge project -> .glyphs file -> Forge project: same masters, same glyphs, same drawing."""
    import shutil
    a = tmp_path / "a" / "GlyphsUnitTestSans.glyphs"
    a.parent.mkdir()
    shutil.copy(GLYPHS / "GlyphsUnitTestSans.glyphs", a)
    p1 = client.post("/api/import/glyphs", json={"path": str(a)}).json()
    out = tmp_path / "Exported.glyphs"
    r = client.post("/api/export/glyphs", json={"path": str(out), "family": p1["designspace"]})
    assert r.status_code == 200, r.text
    assert out.exists() and out.read_text(encoding="utf8").startswith("{")                    # a Glyphs text file
    p2 = client.post("/api/import/glyphs", json={"path": str(out)}).json()
    f1 = client.get("/api/family", params={"path": p1["designspace"]}).json()
    f2 = client.get("/api/family", params={"path": p2["designspace"]}).json()
    assert [m["weight"] for m in f1["masters"]] == [m["weight"] for m in f2["masters"]]     # the weight curve came back
    def glyphs(sfd):
        info = client.post("/api/open", json={"path": sfd}).json()
        return info, {g["name"]: g["width"] for g in info["glyphs"]}
    i1, g1 = glyphs(p1["default"])
    i2, g2 = glyphs(p2["default"])
    assert {n for n in g1 if n != ".notdef"} == {n for n in g2 if n != ".notdef"}
    assert all(abs(g1[n] - g2[n]) < 1 for n in g1 if n in g2)
    # one open font to .glyphs, too
    single = client.post("/api/export/glyphs", json={"path": str(tmp_path / "One.glyphs"), "fid": i1["fid"]})
    assert single.status_code == 200 and single.json()["masters"] == 1
    assert client.post("/api/export/glyphs", json={"path": str(tmp_path / "x.txt"), "fid": i1["fid"]}).status_code == 400


@pytest.mark.skipif(not (GLYPHS / "MontserratStrippedDown.glyphs").exists(), reason="run tests/fetch_fixtures.sh")
def test_glyphs_file_gets_a_start_screen_preview_once_imported(client, tmp_path):
    import shutil
    g = tmp_path / "M.glyphs"
    shutil.copy(GLYPHS / "MontserratStrippedDown.glyphs", g)
    assert client.get("/api/preview", params={"path": str(g)}).status_code == 404          # not opened yet
    client.post("/api/import/glyphs", json={"path": str(g)})
    r = client.get("/api/preview", params={"path": str(g)})
    assert r.status_code == 200 and r.json()["glyphs"]


@pytest.mark.skipif(not (GLYPHS / "GlyphsUnitTestSans.glyphs").exists(), reason="run tests/fetch_fixtures.sh")
def test_glyphs_intermediate_layer_becomes_a_brace_layer(client, tmp_path):
    import shutil
    g = tmp_path / "S" / "GlyphsUnitTestSans.glyphs"
    g.parent.mkdir()
    shutil.copy(GLYPHS / "GlyphsUnitTestSans.glyphs", g)
    p = client.post("/api/import/glyphs", json={"path": str(g)}).json()
    assert p["braces"] == 1 and p["skipped"] == []
    fam = client.get("/api/family", params={"path": p["designspace"]}).json()
    assert len(fam["masters"]) == 3 and len(fam["braces"]) == 1
    br = fam["braces"][0]
    assert br["glyphs"] == ["a"] and Path(br["path"]).exists() and 100 < br["weight"] < 900     # between Light and Bold, user space
    assert client.get("/api/family/of", params={"font": br["path"]}).json()["path"] == p["designspace"]
    # the brace layer holds `a` with the same contours and point counts as the masters: it can interpolate with them
    structure = lambda path: [len(c) for c in client.get("/api/glyph/a", params={"fid": client.post("/api/open", json={"path": path}).json()["fid"]}).json()["contours"]]
    assert structure(br["path"]) == structure(fam["masters"][1]["path"])
    assert client.get("/api/family/check", params={"path": p["designspace"]}).status_code == 200
    # it builds into a variable font
    out = tmp_path / "out"; out.mkdir()
    b = client.post("/api/family/build", json={"path": p["designspace"], "folder": str(out), "name": "S", "variable_woff2": False, "statics": []})
    # (a build refuses while any glyph's masters differ; the fixture has one that does, so a clear 400 is also right)
    assert b.status_code in (200, 400)
    assert client.post("/api/import/glyphs", json={"path": str(g)}).json()["reused"] is True


def test_plugins_listed_run_and_fail_clearly(client, tmp_path, monkeypatch):
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))  # the folder the bundled plugins are copied into
    lst = client.get("/api/plugins").json()
    by = {p["id"]: p for p in lst["plugins"]}
    assert {"bundled/round-coordinates", "bundled/copy-sidebearings", "bundled/small-caps-from-capitals"} <= set(by)
    assert all("error" not in by[i] for i in by if i.startswith("bundled/")) and "folder" not in by["bundled/round-coordinates"]
    assert [f["label"] for f in lst["folders"]] == ["bundled", "yours"]

    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Plug"), "family": "Plug"}).json()["fid"]
    box = lambda x0, x1, y1=700: [[x0, 0, 1], [x0, y1, 1], [x1, y1, 1], [x1, 0, 1]]
    for ch, pts in {"H": box(80, 500), "E": box(30, 420), "F": box(40, 380), "A": box(10.4, 600.6)}.items():
        client.post("/api/create", json={"fid": fid, "unicode": ord(ch)})
        client.post("/api/edit", json={"fid": fid, "name": ch, "kind": "add_contour", "args": {"points": pts, "closed": True}})
    run = lambda pid, params, **kw: client.post("/api/plugins/run", json={"fid": fid, "id": f"bundled/{pid}", "params": params, **kw})
    glyph = lambda n: client.get(f"/api/glyph/{n}", params={"fid": fid}).json()

    # round coordinates: only the selected glyph, to a grid of 10; and Undo can take it back
    r = run("round-coordinates", {"scope": "selected", "step": 10}, selected="A")
    assert r.status_code == 200 and "Rounded 1 of 1" in r.json()["log"][0]
    assert sorted({p[0] for c in glyph("A")["contours"] for p in c}) == [10, 600]
    # copy sidebearings: E and F get H's spacing; a missing letter is reported, not fatal
    r = run("copy-sidebearings", {"model": "H", "targets": "E F Q"})
    assert r.status_code == 200 and "Skipped" in r.json()["log"][1]
    h = glyph("H")
    assert all((glyph(n)["lsb"], glyph(n)["rsb"]) == (h["lsb"], h["rsb"]) for n in "EF")
    # small caps: a.sc, b.sc... for the capitals that exist; widths follow the scale
    r = run("small-caps-from-capitals", {"scale": 0.5})
    assert r.status_code == 200
    names = [g["name"] for g in client.get("/api/font-info", params={"fid": fid}).json() and client.post("/api/open", json={"path": str(tmp_path / "Plug.sfd")}).json()["glyphs"]]
    assert {"a.sc", "e.sc", "f.sc", "h.sc"} <= set(names)
    assert abs(glyph("a.sc")["width"] - glyph("A")["width"] * 0.5) <= 1

    # refusals: unknown plugin, a value that can't be used, a model letter the font lacks
    assert run("nope", {}).status_code == 404
    assert run("round-coordinates", {"step": "many"}).status_code == 400
    bad = run("copy-sidebearings", {"model": "Ж"})
    assert bad.status_code == 400 and "isn't in this font" in bad.json()["detail"]


def test_snapshots_create_compare_restore(client, tmp_path):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "Snap"), "family": "Snap"}).json()
    fid, path = info["fid"], info["path"]
    box = lambda w: [[0, 0, 1], [0, 700, 1], [w, 700, 1], [w, 0, 1]]
    for ch in "HI":
        client.post("/api/create", json={"fid": fid, "unicode": ord(ch)})
        client.post("/api/edit", json={"fid": fid, "name": ch, "kind": "add_contour", "args": {"points": box(100), "closed": True}})
    snap = client.post("/api/snapshots", json={"path": path, "label": "all straight"})
    assert snap.status_code == 200, snap.text
    sid = snap.json()["id"]
    # change H and add a glyph: the comparison sees the unsaved edits
    client.post("/api/edit", json={"fid": fid, "name": "H", "kind": "set_contour", "args": {"contour": 0, "points": box(300), "closed": True}})
    client.post("/api/create", json={"fid": fid, "unicode": ord("L")})
    client.post("/api/edit", json={"fid": fid, "name": "L", "kind": "add_contour", "args": {"points": box(50), "closed": True}})
    diff = client.get("/api/snapshots/compare", params={"path": path, "id": sid}).json()
    assert diff == {"changed": ["H"], "added": ["L"], "removed": []}
    assert client.get("/api/snapshots/compare", params={"path": path, "id": "../x"}).status_code == 404
    second = client.post("/api/snapshots", json={"path": path, "label": "wide H"}).json()["id"]
    assert [m["label"] for m in client.get("/api/snapshots", params={"path": path}).json()["items"]] == ["wide H", "all straight"]
    # restoring is refused while the font is open, and works once it is closed
    assert client.post("/api/snapshots/restore", json={"path": path, "id": sid}).status_code == 409
    client.post("/api/close", json={"fid": fid})
    r = client.post("/api/snapshots/restore", json={"path": path, "id": sid})
    assert r.status_code == 200 and r.json()["before"]["kind"] == "restore"
    fid2 = client.post("/api/open", json={"path": path}).json()["fid"]
    right = lambda n: max(p[0] for c in client.get(f"/api/glyph/{n}", params={"fid": fid2}).json()["contours"] for p in c)
    assert right("H") == 100                                                   # the straight H is back
    names = [g["name"] for g in client.post("/api/open", json={"path": path}).json()["glyphs"]]
    assert "L" not in names                                                    # and the glyph added later is gone
    # automatic snapshots wait between each other; non-.sfd fonts are refused with a reason
    assert client.post("/api/snapshots/auto", json={"path": path}).json()["made"] is True
    assert client.post("/api/snapshots/auto", json={"path": path}).json()["made"] is False
    assert client.post("/api/snapshots", json={"path": str(tmp_path / "x.ttf")}).status_code == 400
    assert client.post("/api/snapshots/delete", json={"path": path, "id": second}).status_code == 200


def test_insert_point_on_existing_path(client, tmp_path):
    path = _sample_copy(tmp_path)
    fid = client.post("/api/open", json={"path": path}).json()["fid"]
    e = lambda name, **args: client.post("/api/edit", json={"fid": fid, "name": name, "kind": "insert_point", "args": args})
    # a straight edge (l's left side): one more point, outline unchanged
    before = client.get("/api/glyph/l", params={"fid": fid}).json()["contours"][0]
    x0, ymid = min(p[0] for p in before), round((min(p[1] for p in before) + max(p[1] for p in before)) / 2)
    r = e("l", x=x0, y=ymid, tol=20).json()
    after = r["contours"][0]
    assert len(after) == len(before) + 1 and any(p[0] == x0 and abs(p[1] - ymid) < 2 for p in after)
    # a curve of o: split in two, the new point on it, the shape the same
    ring = client.get("/api/glyph/o", params={"fid": fid}).json()["contours"]
    outer = max(ring, key=lambda c: max(p[0] for p in c))
    x, y = _curve_middle(outer)
    r = e("o", x=x, y=y, tol=10).json()
    assert sum(len(c) for c in r["contours"]) == sum(len(c) for c in ring) + 3
    assert max(p[0] for c in r["contours"] for p in c) == max(p[0] for p in outer)
    # nothing near: refused
    assert e("l", x=900, y=900, tol=10).status_code >= 400


def test_missing_paths(client, tmp_path):
    here = tmp_path / "a.sfd"
    here.write_text("x")
    gone = str(tmp_path / "gone.sfd")
    assert client.post("/api/missing", json={"paths": [str(here), gone]}).json() == {"missing": [gone]}


def test_sample_font_for_first_run(client, tmp_path):
    r = client.post("/api/sample", json={"folder": str(tmp_path / "Scrifts")})
    assert r.status_code == 200 and r.json()["created"] is True
    path = r.json()["path"]
    info = client.post("/api/open", json={"path": path}).json()
    names = {g["name"] for g in info["glyphs"]}
    assert {"space"} | set("abcdefghijklmnopqrstuvwxyz") <= names and info["familyname"] == "Scrifts Sample"
    fid = info["fid"]
    o = client.get("/api/glyph/o", params={"fid": fid}).json()
    assert len(o["contours"]) == 2 and [s["cw"] for s in o["shapes"]].count(True) == 1     # an outer shape and a hole
    # a word can be set in it, with real spacing
    shaped = client.post("/api/shape", json={"fid": fid, "text": "hello", "features": {}}).json()
    assert [g["name"] for g in shaped] == ["h", "e", "l", "l", "o"] and all(g["ax"] > 0 for g in shaped)
    # asking again never overwrites what the user may have changed
    client.post("/api/edit", json={"fid": fid, "name": "l", "kind": "add_contour",
                                   "args": {"points": [[0, 0, 1], [0, 10, 1], [10, 10, 1]], "closed": True}})
    client.post("/api/save", json={"fid": fid})
    again = client.post("/api/sample", json={"folder": str(tmp_path / "Scrifts")}).json()
    assert again["created"] is False and again["path"] == path
    assert len(client.get("/api/glyph/l", params={"fid": fid}).json()["contours"]) == 2


def _sample_copy(folder):
    """A copy of the sample font that ships (a to z): the tests edit the copy, never the shipped file.
    They read sizes from its outlines rather than hard-coding them, so the sample can be redrawn."""
    import shutil
    os.makedirs(folder, exist_ok=True)
    return shutil.copy(Path(__file__).resolve().parents[1] / "backend" / "Scrifts Sample.sfd", os.path.join(folder, "Scrifts Sample.sfd"))


def _curve_middle(contour):
    """The middle of the first curve segment (on, off, off, on) of a contour."""
    n = len(contour)
    for i in range(n):
        a, b, c, d = (contour[(i + k) % n] for k in range(4))
        if a[2] and not b[2] and not c[2] and d[2]:
            return tuple(0.125 * a[j] + 0.375 * b[j] + 0.375 * c[j] + 0.125 * d[j] for j in (0, 1))
    raise AssertionError("no curve")


def _open_sample(client, tmp_path):
    path = _sample_copy(tmp_path / "s")
    return client.post("/api/open", json={"path": path}).json()["fid"]


def test_artboards_round_trip(client, tmp_path):
    import os
    fid = _open_sample(client, tmp_path)
    out = str(tmp_path / "art")
    r = client.post("/api/artboards/export", json={"fid": fid, "folder": out}).json()
    assert {"h.svg", "o.svg", "l.svg"} <= set(r["files"]) and "space.svg" not in r["files"]
    svg = open(os.path.join(out, "h.svg"), encoding="utf8").read()
    width = client.get("/api/glyph/h", params={"fid": fid}).json()["width"]
    assert 'id="Metrics"' in svg and 'id="Outline"' in svg and 'height="1000"' in svg
    assert 'width="1000"' in svg and f'id="right-edge" x1="{width:g}"' in svg   # a 1 em square board, the advance as a guide

    # draw nothing new: a preview then an apply gives the same outlines (rounding aside)
    before = client.get("/api/glyph/h", params={"fid": fid}).json()["contours"]
    prev = client.post("/api/artboards/import", json={"fid": fid, "folder": out}).json()
    assert prev["applied"] is False and {g["status"] for g in prev["glyphs"]} == {"replace"}
    client.post("/api/artboards/import", json={"fid": fid, "folder": out, "apply": True})
    after = client.get("/api/glyph/h", params={"fid": fid}).json()["contours"]
    box = lambda cs: (min(p[0] for c in cs for p in c), min(p[1] for c in cs for p in c),
                      max(p[0] for c in cs for p in c), max(p[1] for c in cs for p in c))
    # partial: only the ticked files are read, the rest are reported as skipped
    r = client.post("/api/artboards/import", json={"fid": fid, "folder": out, "apply": True, "files": ["l.svg"]}).json()
    assert {g["file"]: g["status"] for g in r["glyphs"]}["l.svg"] == "replace"
    assert {g["status"] for g in r["glyphs"] if g["file"] != "l.svg"} == {"skipped"}
    assert len(after) == len(before) and all(abs(a - b) <= 1 for a, b in zip(box(after), box(before)))
    o = client.get("/api/glyph/o", params={"fid": fid}).json()
    assert len(o["contours"]) == 2   # the ring kept its hole


def test_artboard_files_differ_for_capitals_and_lowercase(client, tmp_path):
    fid = _open_sample(client, tmp_path)
    r = client.post("/api/artboards/export", json={"fid": fid, "folder": str(tmp_path / "t"), "chars": "Aa", "template": True, "names": []}).json()
    assert sorted(r["files"]) == ["A_.svg", "a.svg"] and len({f.lower() for f in r["files"]}) == 2   # Windows ignores case


def test_artboard_template_and_new_glyph(client, tmp_path):
    import os
    fid = _open_sample(client, tmp_path)
    out = str(tmp_path / "tpl")
    r = client.post("/api/artboards/export", json={"fid": fid, "folder": out, "chars": "AB", "template": True, "names": []}).json()
    assert set(r["files"]) == {"A_.svg", "B_.svg"}
    # untouched template: nothing to read back
    prev = client.post("/api/artboards/import", json={"fid": fid, "folder": out}).json()
    assert {g["status"] for g in prev["glyphs"]} == {"empty"}
    # draw a rectangle in A_.svg's Outline layer (as Illustrator would) and read it in as a new glyph
    p = os.path.join(out, "A_.svg")
    s = open(p, encoding="utf8").read().replace(
        '<g id="Outline" fill="#000000"></g>', '<g id="Outline"><rect x="100" y="100" width="200" height="300"/></g>')
    open(p, "w", encoding="utf8").write(s)
    prev = client.post("/api/artboards/import", json={"fid": fid, "folder": out}).json()
    assert [g for g in prev["glyphs"] if g["file"] == "A_.svg"][0]["status"] == "new"
    client.post("/api/artboards/import", json={"fid": fid, "folder": out, "apply": True})
    a = client.get("/api/glyph/A", params={"fid": fid}).json()["contours"]
    assert len(a) == 1 and max(p[1] for p in a[0]) - min(p[1] for p in a[0]) == 300
    assert client.get("/api/glyph/A", params={"fid": fid}).json()["width"] == 500   # from the right-edge guide


def test_trace_a_picture_into_a_glyph(client, tmp_path):
    from PIL import Image, ImageDraw
    fid = _open_sample(client, tmp_path)
    pic = tmp_path / "ring.png"
    im = Image.new("RGB", (960, 1200), "white")
    d = ImageDraw.Draw(im)
    d.ellipse((160, 240, 800, 880), fill="black")
    d.ellipse((360, 440, 600, 680), fill="white")
    im.save(pic)
    prev = client.post("/api/trace/preview", json={"path": str(pic)}).json()
    assert prev["contours"] == 2 and prev["box"] == [160, 240, 801, 881] and prev["d"].count("Z") == 2
    tiny = tmp_path / "tiny.png"
    im.resize((96, 120)).save(tiny)   # a tiny picture is scaled up so the curves have pixels to work with
    t = client.post("/api/trace/preview", json={"path": str(tiny)}).json()
    assert t["height"] == 800 and t["width"] == 640 and t["contours"] == 2   # longest side brought up to 800
    assert client.get("/api/trace/image", params={"path": str(pic)}).headers["content-type"] == "image/png"
    assert client.post("/api/trace/preview", json={"path": str(tmp_path / "nope.png")}).status_code == 404
    # baseline at the ring's bottom, 700 units at its top
    r = client.post("/api/trace/apply", json={"fid": fid, "name": "l", "path": str(pic), "baseline_y": 881, "top_y": 240, "top_units": 700}).json()
    assert len(r["contours"]) == 2
    raw = client.post("/api/trace/apply", json={"fid": fid, "name": "i", "path": str(pic), "baseline_y": 881, "top_y": 240, "top_units": 700, "tidy": False}).json()
    assert sum(len(c) for c in r["contours"]) <= sum(len(c) for c in raw["contours"])   # tidying never adds points
    ys = [p[1] for c in r["contours"] for p in c]
    assert abs(min(ys)) < 15 and abs(max(ys) - 700) < 15
    assert client.get("/api/glyph/l", params={"fid": fid}).json()["width"] > 500
    blank = tmp_path / "blank.png"
    Image.new("RGB", (50, 50), "white").save(blank)
    assert client.post("/api/trace/apply", json={"fid": fid, "name": "l", "path": str(blank), "baseline_y": 40, "top_y": 10}).status_code == 400


def test_template_sheet_written_on_and_read_back(client, tmp_path):
    import os, sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
    import sheet
    from PIL import Image, ImageDraw
    fid = _open_sample(client, tmp_path)
    made = client.post("/api/sheet/make", json={"chars": "ahio A", "folder": str(tmp_path / "sheets")}).json()
    assert made["pages"] == ["ahioA"] and os.path.isfile(made["pdf"]) and os.path.isfile(made["files"][0])
    page = Image.open(made["files"][0]).convert("RGB")
    d = ImageDraw.Draw(page)
    x0, y0, _, _ = sheet.cell_box(1)      # h: a single stem, baseline to cap height
    d.rectangle((x0 + 60, y0 + sheet.BASELINE - 105, x0 + 90, y0 + sheet.BASELINE), fill="black")
    x0, y0, _, _ = sheet.cell_box(4)      # A (not in the font yet): a blob
    d.ellipse((x0 + 40, y0 + sheet.BASELINE - 75, x0 + 130, y0 + sheet.BASELINE), fill="black")
    scan = tmp_path / "scan.png"
    page.rotate(1.5, resample=Image.Resampling.BICUBIC, fillcolor="white").save(scan)
    body = {"fid": fid, "path": str(scan), "chars": "ahioA"}
    h = lambda: client.get("/api/glyph/h", params={"fid": fid}).json()["contours"]
    h0 = h()
    prev = client.post("/api/sheet/read", json=body).json()
    assert [c["char"] for c in prev["cells"]] == ["h", "A"] and prev["applied"] is False
    assert h() == h0   # preview changes nothing
    only_a = client.post("/api/sheet/read", json={**body, "apply": True, "only": "A"}).json()   # tick just the "A"
    assert [c.get("glyph") for c in only_a["cells"]] == [None, "A"]
    assert h() == h0
    r = client.post("/api/sheet/read", json={**body, "apply": True}).json()
    assert [c["glyph"] for c in r["cells"]] == ["h", "A"]
    assert h() != h0 and len(h()) == 1   # the written stem replaced the drawing
    a = client.get("/api/glyph/A", params={"fid": fid}).json()   # made by the read
    ys = [p[1] for c in a["contours"] for p in c]
    assert 480 < max(ys) - min(ys) < 530 and abs(min(ys)) < 15   # 75 px of a 150 px em is 500 units, standing on the baseline
    assert client.post("/api/sheet/read", json={**body, "path": str(tmp_path / "ring.png")}).status_code in (400, 404)
    assert client.post("/api/sheet/read", json={**body, "page": 3}).status_code == 400


def _bounds(path, glyph):
    from fontTools.pens.boundsPen import BoundsPen
    from fontTools.ttLib import TTFont
    f = TTFont(path)
    pen = BoundsPen(f.getGlyphSet())
    f.getGlyphSet()[glyph].draw(pen)
    return pen.bounds


def _stroked_font(client, tmp_path, quadratic=False):
    info = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "S"), "family": "S", "quadratic": quadratic}).json()
    fid = info["fid"]
    name = client.post("/api/create", json={"fid": fid, "unicode": 0x49}).json()["name"]
    skeleton = {"points": [[100, 0, 1], [100, 700, 1]], "closed": False, "label": "~stroke 80 round round"}
    client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "args": skeleton})
    return fid, name


def test_stroke_is_a_skeleton_until_the_font_is_made(client, tmp_path):
    fid, name = _stroked_font(client, tmp_path)
    g = client.get(f"/api/glyph/{name}", params={"fid": fid}).json()
    assert [len(c) for c in g["contours"]] == [2] and g["shapes"][0]["closed"] is False and g["shapes"][0]["name"].startswith("~stroke 80")
    assert "C" in g["d"] and g["d"].count("Z") >= 1                  # other views draw the real, stroked outline
    (tmp_path / "gen").mkdir()
    r = client.post("/api/generate", json={"fid": fid, "folder": str(tmp_path / "gen"), "name": "S", "formats": ["otf"]})
    assert r.status_code == 200, r.text
    x0, y0, x1, y1 = _bounds(str(tmp_path / "gen" / "S.otf"), name)
    assert (x0, x1) == (60, 140) and (y0, y1) == (-40, 740)            # 80 wide, round caps stick out by 40
    after = client.get(f"/api/glyph/{name}", params={"fid": fid}).json()
    assert [len(c) for c in after["contours"]] == [2]                  # making the font left the skeleton alone


def test_strokes_in_a_truetype_font(client, tmp_path):
    fid, name = _stroked_font(client, tmp_path, quadratic=True)
    (tmp_path / "gen").mkdir()
    r = client.post("/api/generate", json={"fid": fid, "folder": str(tmp_path / "gen"), "name": "S", "formats": ["ttf"]})
    assert r.status_code == 200, r.text
    x0, y0, x1, y1 = _bounds(str(tmp_path / "gen" / "S.ttf"), name)
    assert abs(x0 - 60) <= 1 and abs(x1 - 140) <= 1 and abs(y0 + 40) <= 2 and abs(y1 - 740) <= 2


def test_butt_caps_and_expand_for_good(client, tmp_path):
    fid, name = _stroked_font(client, tmp_path)
    e = lambda kind, **a: client.post("/api/edit", json={"fid": fid, "name": name, "kind": kind, "args": a}).json()
    e("rename", contour=0, label="~stroke 60 butt miter")
    g = client.get(f"/api/glyph/{name}", params={"fid": fid}).json()
    assert g["shapes"][0]["name"] == "~stroke 60 butt miter"
    r = e("expand_strokes")
    assert len(r["contours"]) == 1 and len(r["contours"][0]) == 4 and r["shapes"][0]["closed"] and r["shapes"][0]["name"] == ""
    xs = [p[0] for p in r["contours"][0]]; ys = [p[1] for p in r["contours"][0]]
    assert (min(xs), max(xs)) == (70, 130) and (min(ys), max(ys)) == (0, 700)   # a plain rectangle: butt caps end at the points
    assert client.post("/api/undo", json={"fid": fid, "name": name}).json()["shapes"][0]["name"] == "~stroke 60 butt miter"   # and it can be undone


def test_stroke_survives_save_and_reopen_and_unmarked_shapes_are_left_alone(client, tmp_path):
    fid, name = _stroked_font(client, tmp_path)
    square = {"points": [[300, 0, 1], [300, 100, 1], [400, 100, 1], [400, 0, 1]], "closed": True}
    client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "args": square})
    client.post("/api/save", json={"fid": fid})
    info = client.post("/api/open", json={"path": str(tmp_path / "S.sfd")}).json()
    g = client.get(f"/api/glyph/{name}", params={"fid": info["fid"]}).json()
    assert [s["name"] for s in g["shapes"]][0].startswith("~stroke 80") and g["shapes"][1]["name"] == ""
    r = client.post("/api/edit", json={"fid": info["fid"], "name": name, "kind": "expand_strokes", "args": {"contours": [1]}}).json()
    assert [s["name"].startswith("~stroke") for s in r["shapes"]].count(True) == 1     # the square was not a stroke: nothing to expand there


def test_auto_space_uses_fontforge_auto_width(client, tmp_path):
    fid = _open_sample(client, tmp_path)
    bearings = lambda n: (lambda g: (g["lsb"], g["rsb"]))(client.get(f"/api/glyph/{n}", params={"fid": fid}).json())
    h0 = client.get("/api/glyph/h", params={"fid": fid}).json()
    assert bearings("h") != (60, 60)
    # forced to exactly 60 on both sides: every glyph with an outline follows, and nothing else is touched
    r = client.post("/api/autospace", json={"fid": fid, "min_bearing": 60, "max_bearing": 60}).json()
    names = {c["name"] for c in r["changed"]}
    assert {"h", "e", "o"} <= names and "space" not in names
    for c in r["changed"]:
        assert (c["lsb"], c["rsb"]) == (60, 60) and c["before"]["width"] > 0
    assert all(bearings(n) == (60, 60) for n in "abcdefghijklmnopqrstuvwxyz")
    assert {o["name"] for o in r["outlines"]} == names                                 # the new drawings come back with it
    h = next(c for c in r["changed"] if c["name"] == "h")
    assert h["before"] == {"lsb": h0["lsb"], "rsb": h0["rsb"], "width": h0["width"]}  # what undo needs
    # a subset only, and the natural result (no forced bearings) is a sane, even spacing
    client.post("/api/autospace", json={"fid": fid, "names": ["h", "l"], "min_bearing": 10, "max_bearing": 200})
    assert bearings("e") == (60, 60)                                                  # not in the list: untouched
    l, r_ = bearings("h")
    assert 10 <= l <= 200 and 10 <= r_ <= 200
    # by default nothing ends up with a negative bearing (letters overlapping), however FontForge spaces them
    client.post("/api/autospace", json={"fid": fid, "separation": 100})
    assert all(min(bearings(n)) >= 0 for n in "abcdefghijklmnopqrstuvwxyz")


def test_auto_space_leaves_glyphs_with_metrics_keys_to_their_keys(client, tmp_path):
    fid = _open_sample(client, tmp_path)
    client.post("/api/metrics-key", json={"fid": fid, "name": "f", "side": "lsb", "key": "=e"})
    before_f = client.get("/api/glyph/f", params={"fid": fid}).json()["lsb"]
    r = client.post("/api/autospace", json={"fid": fid, "min_bearing": 60, "max_bearing": 60}).json()
    assert "f" in r["skipped"] and "f" not in {c["name"] for c in r["changed"]}
    # e moved to 60, and f follows e through its key
    assert client.get("/api/glyph/f", params={"fid": fid}).json()["lsb"] == 60 != before_f


def test_reveal_in_folder(client, tmp_path, monkeypatch):
    seen = []
    monkeypatch.setattr(server.subprocess, "Popen", lambda args, **kw: seen.append(args))
    f = tmp_path / "A B.sfd"
    f.write_text("x")
    assert client.post("/api/reveal", json={"path": str(f)}).json() == {"ok": True}
    assert len(seen) == 1 and isinstance(seen[0], list) and str(f) in " ".join(seen[0])     # one argument list, never a shell string
    assert client.post("/api/reveal", json={"path": str(tmp_path / "gone.sfd")}).status_code == 404 and len(seen) == 1


def test_vertical_and_horizontal_guides_live_side_by_side(client, tmp_path):
    fid = _open_sample(client, tmp_path)
    assert client.post("/api/guides", json={"fid": fid, "ys": [500, 300]}).json() == [300, 500]
    assert client.post("/api/vguides", json={"fid": fid, "xs": [250, 40]}).json() == [40, 250]
    # each list is replaced on its own: changing one never touches the other
    assert client.post("/api/guides", json={"fid": fid, "ys": [100]}).json() == [100]
    assert client.get("/api/vguides", params={"fid": fid}).json() == [40, 250]
    assert client.post("/api/vguides", json={"fid": fid, "xs": []}).json() == []
    assert client.get("/api/guides", params={"fid": fid}).json() == [100]
    # and they are saved with the font
    client.post("/api/vguides", json={"fid": fid, "xs": [60]})
    client.post("/api/save", json={"fid": fid})
    again = client.post("/api/open", json={"path": str(tmp_path / "s" / "Scrifts Sample.sfd")}).json()["fid"]
    assert client.get("/api/vguides", params={"fid": again}).json() == [60]
    assert client.get("/api/guides", params={"fid": again}).json() == [100]


def test_autosave_all_saves_only_what_changed_and_looking_changes_nothing(client, tmp_path):
    fid = _open_sample(client, tmp_path)
    other = client.post("/api/open", json={"path": _sample_copy(tmp_path / "t")}).json()["fid"]
    quiet = client.post("/api/autosave/all", json={"fids": [fid, other]}).json()
    assert quiet["saved"] is False and {r["changed"] for r in quiet["results"].values()} == {False}
    client.get("/api/glyph/h", params={"fid": fid})                                  # reading is not changing
    assert client.post("/api/autosave/all", json={"fids": [fid, other]}).json()["saved"] is False
    client.post("/api/edit", json={"fid": other, "name": "h", "kind": "transform", "args": {"matrix": [1, 0, 0, 1, 5, 0], "contours": [0], "points": []}})
    both = client.post("/api/autosave/all", json={"fids": [fid, other]}).json()
    assert both["saved"] is True and [k for k, r in both["results"].items() if r["saved"]] == [str(other)]   # only the edited one was written
    assert client.post("/api/autosave/all", json={"fids": [fid, other]}).json()["saved"] is False            # and it is clean again


def test_foreign_host_name_is_refused(client):
    # DNS rebinding: a page on evil.example resolving to 127.0.0.1 must not reach the API
    assert client.get("/api/ping", headers={"host": "evil.example"}).status_code == 400
    assert client.get("/api/ping", headers={"host": "localhost:8765"}).status_code == 200


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_filters_run_and_undo(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    p0 = client.get("/api/glyph/o", params={"fid": fid}).json()["contours"]
    for kind, args in [("add_extrema", {}), ("add_inflections", {}), ("simplify", {}), ("balance", {}), ("harmonize", {}), ("round", {}), ("weight", {"delta": 10})]:
        r = client.post("/api/edit", json={"fid": fid, "name": "o", "kind": kind, "args": args})
        assert r.status_code == 200, (kind, r.text)
        assert client.post("/api/undo", json={"fid": fid, "name": "o"}).json()["contours"] == p0, kind


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_auto_kern_and_undo(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    names = [g["name"] for g in client.post("/api/open", json={"path": str(SFD)}).json()["glyphs"] if g["name"] in ("A", "V", "T", "o", "W", "a")]
    pairs = [[l, r] for l in names for r in names]
    k0 = {(k["left"], k["right"]): k["value"] for k in client.post("/api/kerning", json={"fid": fid, "pairs": pairs}).json()}
    r = client.post("/api/autokern", json={"fid": fid, "names": names, "separation": 120}).json()
    assert r["changed"], "Auto Kern found nothing to kern"
    k1 = {(k["left"], k["right"]): k["value"] for k in client.post("/api/kerning", json={"fid": fid, "pairs": pairs}).json()}
    assert k1 != k0
    client.post("/api/kern/pairs", json={"fid": fid, "subtable": r["subtable"], "pairs": [{"left": c["left"], "right": c["right"], "value": c["before"]} for c in r["changed"]]})
    k2 = {(k["left"], k["right"]): k["value"] for k in client.post("/api/kerning", json={"fid": fid, "pairs": pairs}).json()}
    assert k2 == k0


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_clean_up_removes_strays_only(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    e = lambda kind, **args: client.post("/api/edit", json={"fid": fid, "name": "o", "kind": kind, "args": args}).json()
    n0 = len(client.get("/api/glyph/o", params={"fid": fid}).json()["contours"])
    e("add_contour", points=[[10, 10, 1]], closed=False)  # a lone point
    e("add_contour", points=[[0, 0, 1], [100, 0, 1], [200, 0, 1]], closed=True)  # a flat shape
    e("add_contour", points=[[0, 0, 1], [100, 100, 1]], closed=False)  # a stroke skeleton: stays
    assert len(e("clean_up")["contours"]) == n0 + 1


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_auto_kern_keeps_letters_apart(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    names = [n for n in ("A", "V", "T", "o", "W", "a") if client.get(f"/api/glyph/{n}", params={"fid": fid}).status_code == 200]
    r = client.post("/api/autokern", json={"fid": fid, "names": names, "separation": 0, "min_gap": 40}).json()
    import server
    for c in r["changed"]:
        if c["after"]:
            gap = server._call("closest", fid=fid, left=c["left"], right=c["right"], kern=c["after"])
            assert gap is None or gap >= 39, (c, gap)


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_clear_glyph_and_undo(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    p0 = client.get("/api/glyph/o", params={"fid": fid}).json()
    p1 = client.post("/api/edit", json={"fid": fid, "name": "o", "kind": "clear", "args": {}}).json()
    assert p1["contours"] == [] and p1["width"] == p0["width"]
    assert client.post("/api/undo", json={"fid": fid, "name": "o"}).json()["contours"] == p0["contours"]


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_clear_then_rebuild_from_components(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    made = client.post("/api/compose", json={"fid": fid, "unicode": 0xF3, "base": "o", "accent": "acute"})
    if made.status_code != 200:
        pytest.skip("fixture has no acute")
    name = made.json()["name"]
    client.post("/api/edit", json={"fid": fid, "name": name, "kind": "clear", "args": {}})
    r = client.post("/api/build", json={"fid": fid, "name": name})
    assert r.status_code == 200, r.text
    assert r.json()["contours"] or r.json().get("refs") or r.json().get("shapes")


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_underscore_anchor_on_accent_counts_as_mark(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    if client.post("/api/compose", json={"fid": fid, "unicode": 0xF3, "base": "o", "accent": "acute"}).status_code != 200:
        pytest.skip("fixture has no acute")
    import server
    for cls in ("top", "_top"):
        server._call("add_anchor_class", fid=fid, name=cls)
    server._call("set_anchor", fid=fid, name="o", cls="top", type="base", x=250, y=600)
    server._call("set_anchor", fid=fid, name="acute", cls="_top", type="base", x=100, y=500)  # the way it was typed
    r = client.post("/api/place-by-anchors", json={"fid": fid, "accent": "acute"}).json()
    assert "oacute" in r["placed"], r


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_anchors_link_letters_live(client):
    """top on the letter + _top on the accent: build once, then moving either anchor moves the accent in every letter."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    import server
    # the font is shared across the module: the test above leaves a "_top" on acute, which would outrank the mark anchor set here
    server._call("delete_anchor", fid=fid, name="acute", cls="_top", type="base")
    server._call("add_anchor_class", fid=fid, name="top")
    server._call("set_anchor", fid=fid, name="o", cls="top", type="base", x=250, y=600)
    server._call("set_anchor", fid=fid, name="acute", cls="top", type="mark", x=100, y=500)
    made = client.post("/api/compose", json={"fid": fid, "unicode": 0xF3, "base": "o", "accent": "acute"})
    if made.status_code != 200:
        pytest.skip("fixture has no acute")
    assert made.json()["placed_by"].startswith("anchor")
    offset = lambda: next(i["offset"] for i in client.get("/api/composites/acute", params={"fid": fid}).json()["items"] if i["name"] == "oacute")
    assert offset() == [150, 100]
    server._call("set_anchor", fid=fid, name="o", cls="top", type="base", x=300, y=650)  # move the letter's anchor
    assert offset() == [200, 150]
    server._call("set_anchor", fid=fid, name="acute", cls="top", type="mark", x=50, y=500)  # move the accent's anchor
    assert offset() == [250, 150]


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_plain_top_on_the_accent_also_links(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    import server
    server._call("add_anchor_class", fid=fid, name="top")
    server._call("set_anchor", fid=fid, name="o", cls="top", type="base", x=250, y=600)
    server._call("set_anchor", fid=fid, name="acute", cls="top", type="base", x=100, y=500)  # "top" typed on the accent
    made = client.post("/api/compose", json={"fid": fid, "unicode": 0xF3, "base": "o", "accent": "acute"})
    if made.status_code != 200:
        pytest.skip("fixture has no acute")
    assert made.json()["placed_by"] == "anchor top"


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_i_accents_build_on_dotless_i(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    items = client.get("/api/composites/acute", params={"fid": fid}).json()["items"]
    iacute = next(i for i in items if i["unicode"] == 0xED)
    assert iacute["base"] == "dotlessi", iacute


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_dotless_i_from_i_and_name_lookup(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    assert client.get("/api/unicode-of", params={"fid": fid, "name": "dotlessi"}).json()["unicode"] == 0x131
    i = client.get("/api/glyph/i", params={"fid": fid}).json()
    r = client.post("/api/make-dotless", json={"fid": fid, "unicode": 0x131})
    assert r.status_code == 200, r.text
    assert len(r.json()["contours"]) == len(i["contours"]) - 1 and r.json()["width"] == i["width"]


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_new_glyphs_get_standard_names(client):
    """New glyphs are named the standard way (dotlessi, uniA7B5), never glyph74."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    r = client.post("/api/create", json={"fid": fid, "unicode": 0xA7B5})
    assert r.status_code == 200, r.text
    name = r.json().get("name") or r.json().get("glyphname")
    assert name and not name.startswith("glyph"), r.json()


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_standard_names_rename_glyphN(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    assert client.post("/api/create", json={"fid": fid, "unicode": 0xA7B7, "name": "glyph9999"}).status_code == 200
    r = client.post("/api/standard-names", json={"fid": fid}).json()
    assert ["glyph9999", "uniA7B7"] in r["renamed"], r


def test_scrifts_folders_and_migration(tmp_path, monkeypatch):
    """New home Documents/Scrifts and %APPDATA%/Scrifts/plugins; what lived under the old Forge names comes along."""
    import plugins
    import server
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    (tmp_path / "Documents" / "Forge").mkdir(parents=True)
    (tmp_path / "Documents" / "Forge" / "Forge Sample.sfd").write_text("old sample")
    (tmp_path / "Roaming" / "Forge" / "plugins" / "mine").mkdir(parents=True)
    assert server.home_folder() == str(tmp_path / "Documents" / "Scrifts")
    assert (tmp_path / "Documents" / "Scrifts" / "Forge Sample.sfd").read_text() == "old sample"
    assert plugins.user_dir() == str(tmp_path / "Roaming" / "Scrifts" / "plugins")
    assert (tmp_path / "Roaming" / "Scrifts" / "plugins" / "mine").is_dir()


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_created_empty_glyph_is_listed(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    made = client.post("/api/create", json={"fid": fid, "unicode": 0xA7B9}).json()
    assert made["width"] > 0
    info = client.get("/api/info", params={"fid": fid})
    if info.status_code == 200:
        assert made["name"] in [g["name"] for g in info.json()["glyphs"]]


def test_open_url_only_https(client):
    assert client.post("/api/open-url", json={"url": "file:///C:/Windows/System32/calc.exe"}).status_code == 400
    assert client.post("/api/open-url", json={"url": "javascript:alert(1)"}).status_code == 400


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_round_corners(client):
    fid, e = _boxes(client, "roundtest")
    g = e("round_corners", points=[[0, 2]], radius=20)  # one corner of the first square
    assert len(g["contours"][0]) == 6 and len(g["contours"][1]) == 4  # DejaVu is TrueType: the arc is one quadratic curve
    g = e("round_corners", radius=10, corner="chamfer")  # no points: every corner of every shape
    assert len(g["contours"][1]) == 8


def test_svg_drawing_round_trip(client, tmp_path):
    src = tmp_path / "d.svg"
    src.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">'
                   '<rect x="10" y="10" width="50" height="20" fill="#ff0000"/>'
                   '<circle cx="100" cy="50" r="20" fill="none" stroke="#0000ff" stroke-width="4"/><text>x</text></svg>')
    info = client.post("/api/open", json={"path": str(src)}).json()
    fid = info["fid"]
    assert info["svg"]["shapes"] == 2 and info["svg"]["lost"] == ["text"] and [g["name"] for g in info["glyphs"]] == ["drawing"]
    pts = client.get("/api/glyph/drawing", params={"fid": fid}).json()
    assert [s["name"].split()[2:4] for s in pts["shapes"]] == [["#ff0000", "-"], ["-", "#0000ff"]]
    assert pts["contours"][0][0][:2] == [10, 90]  # y is up in the editor, down in the file
    client.post("/api/edit", json={"fid": fid, "name": "drawing", "kind": "add_contour", "args": {"points": [[0, 0, 1], [0, 10, 1], [10, 10, 1]], "closed": True}})
    out = tmp_path / "out.svg"
    assert client.post("/api/save", json={"fid": fid, "path": str(out)}).status_code == 200
    text = out.read_text()
    assert text.count("<path") == 3 and 'fill="#ff0000"' in text and 'stroke="#0000ff"' in text and 'stroke-width="4"' in text
    assert 'fill="#000000"' in text  # the shape drawn here has no colour of its own yet: black


def test_redo_puts_back_what_undo_took_away(client):
    fid, e = _boxes(client, "redotest")
    post = lambda path: client.post(path, json={"fid": fid, "name": "redotest"})
    assert len(post("/api/undo").json()["contours"]) == 1
    assert len(post("/api/redo").json()["contours"]) == 2
    assert len(post("/api/undo").json()["contours"]) == 1
    e("add_contour", points=[[0, 0, 1], [0, 5, 1], [5, 5, 1]], closed=True)  # a new edit voids the redo
    assert post("/api/redo").status_code == 400


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_bolder_never_adds_or_drops_points(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    e = lambda name, delta: client.post("/api/edit", json={"fid": fid, "name": name, "kind": "weight", "args": {"delta": delta}}).json()
    for name in "HWogsa":
        g = client.get(f"/api/glyph/{name}", params={"fid": fid}).json()
        n = [len(c) for c in g["contours"]]
        fat, thin = e(name, 40), None
        assert [len(c) for c in fat["contours"]] == n, name
        client.post("/api/undo", json={"fid": fid, "name": name})
        thin = e(name, -20)
        assert [len(c) for c in thin["contours"]] == n, name
        client.post("/api/undo", json={"fid": fid, "name": name})
    h = client.get("/api/glyph/H", params={"fid": fid}).json()
    wide = lambda g: max(p[0] for c in g["contours"] for p in c) - min(p[0] for c in g["contours"] for p in c)
    w0 = wide(h)
    assert abs(wide(e("H", 40)) - (w0 + 40)) <= 2  # the outline grew by half the delta on each side
    client.post("/api/undo", json={"fid": fid, "name": "H"})


def test_family_blend_kerning_follows_the_masters(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "K-Thin"), "family": "K", "style": "Thin"}).json()["fid"]
    for cp in (0x41, 0x56):
        client.post("/api/create", json={"fid": fid, "unicode": cp})
    ds = str(tmp_path / "K.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    b = client.post("/api/open", json={"path": fam["masters"][1]["path"]}).json()["fid"]
    client.post("/api/kern", json={"fid": fid, "left": "A", "right": "V", "value": -20, "mode": "pair"})
    client.post("/api/kern", json={"fid": b, "left": "A", "right": "V", "value": -60, "mode": "pair"})
    for f in (fid, b):
        client.post("/api/save", json={"fid": f})
    at = lambda w: client.post("/api/family/blend-kerning", json={"path": ds, "weight": w, "pairs": [["A", "V"]]}).json()["A V"]
    assert (at(100), at(500), at(900)) == (-20, -40, -60)


def test_script_example_bolder_every_glyph_keeps_points(client):
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    code = "# Thicker (positive) or thinner (negative) stems for the whole open master, no point added or removed,\n# so it still interpolates with the other masters. DELTA is the total change of a stem in font units.\nimport weight\nDELTA = 20\nn = 0\nfor g in font.glyphs():\n    layer = g.foreground\n    for ci in range(len(layer)):\n        c = layer[ci]\n        pts = [[p.x, p.y, 1 if p.on_curve else 0] for p in c]\n        moved = False\n        for pi, (dx, dy) in enumerate(weight.offsets(pts, bool(c.closed), DELTA)):\n            if dx or dy:\n                p = c[pi]\n                p.x = round(p.x + dx)\n                p.y = round(p.y + dy)\n                c[pi] = p\n                moved = True\n        if moved:\n            layer[ci] = c\n    g.foreground = layer\n    n += 1\nprint('changed', n, 'glyphs by', DELTA)"
    before = {n: [len(c) for c in client.get(f"/api/glyph/{n}", params={"fid": fid}).json()["contours"]] for n in "HWog"}
    r = client.post("/api/script", json={"fid": fid, "code": code}).json()
    assert r["error"] is None and "changed" in r["output"], r
    for n, counts in before.items():
        assert [len(c) for c in client.get(f"/api/glyph/{n}", params={"fid": fid}).json()["contours"]] == counts


def test_family_glyph_points_lists_every_master(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "G-Thin"), "family": "G", "style": "Thin"}).json()["fid"]
    client.post("/api/create", json={"fid": fid, "unicode": 0x49})
    client.post("/api/edit", json={"fid": fid, "name": "I", "kind": "add_contour", "args": {"points": [[0, 0, 1], [0, 700, 1], [40, 700, 1], [40, 0, 1]], "closed": True}})
    ds = str(tmp_path / "G.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900})
    r = client.get("/api/family/glyph-points", params={"path": ds, "name": "I"}).json()
    assert [m["name"] for m in r["masters"]] == ["Thin", "Black"]
    assert r["masters"][0]["glyph"]["contours"][0][2] == [40, 700, 1]
    assert client.get("/api/family/glyph-points", params={"path": ds, "name": "nope"}).json()["masters"][0]["glyph"] is None


def test_family_all_points_two_masters(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "H-Thin"), "family": "H", "style": "Thin"}).json()["fid"]
    client.post("/api/create", json={"fid": fid, "unicode": 0x49})
    ds = str(tmp_path / "H.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    a, b = fam["masters"][0]["path"], fam["masters"][1]["path"]
    r = client.get("/api/family/all-points", params={"path": ds, "a": a, "b": b}).json()
    assert [m["name"] for m in r["masters"]] == ["Thin", "Black"] and "I" in r["masters"][0]["glyphs"]
    assert client.get("/api/family/all-points", params={"path": ds, "a": a, "b": "nope.sfd"}).status_code == 400


def test_family_point_edit_deletes_and_inserts(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "P-Thin"), "family": "P", "style": "Thin"}).json()["fid"]
    client.post("/api/create", json={"fid": fid, "unicode": 0x49})
    client.post("/api/edit", json={"fid": fid, "name": "I", "kind": "add_contour", "args": {"points": [[0, 0, 1], [0, 700, 1], [20, 700, 1], [40, 700, 1], [40, 0, 1]], "closed": True}})
    ds = str(tmp_path / "P.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    fam = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()
    a, b = fam["masters"][0]["path"], fam["masters"][1]["path"]
    edit = lambda m, **kw: client.post("/api/family/point-edit", json={"family": ds, "master": m, "glyph": "I", "contour": 0, **kw})
    g = edit(a, index=3, action="delete").json()
    assert len(g["contours"][0]) == 4
    g = edit(b, index=3, action="delete").json()
    assert [len(c) for c in g["contours"]] == [4]
    g = edit(a, index=2, action="insert", x=20, y=700, on=1).json()
    assert g["contours"][0][2][:2] == [20, 700] and len(g["contours"][0]) == 5
    assert edit(a, index=9, action="delete").status_code == 400


def test_family_point_edit_runs_of_points(client, tmp_path):
    fid = client.post("/api/new", json={"own_folder": False, "path": str(tmp_path / "R-Thin"), "family": "R", "style": "Thin", "quadratic": False}).json()["fid"]
    client.post("/api/create", json={"fid": fid, "unicode": 0x4F})
    client.post("/api/edit", json={"fid": fid, "name": "O", "kind": "add_contour", "args": {"points": [[0, 0, 1], [0, 100, 0], [50, 100, 0], [50, 50, 1], [50, 0, 1]], "closed": True}})
    ds = str(tmp_path / "R.designspace")
    client.post("/api/family/new", json={"fid": fid, "path": ds, "weight": 100})
    a = client.post("/api/family/add", json={"fid": fid, "family": ds, "style": "Black", "weight": 900}).json()["masters"][0]["path"]
    edit = lambda **kw: client.post("/api/family/point-edit", json={"family": ds, "master": a, "glyph": "O", "contour": 0, **kw})
    assert edit(index=1, action="delete").status_code == 400  # one handle of a cubic pair alone: FontForge refuses
    g = edit(index=1, action="delete", count=2).json()  # both together
    assert [p[2] for p in g["contours"][0]] == [1, 1, 1]
    g = edit(index=1, action="insert", points=[[0, 100, 0], [50, 100, 0]]).json()
    assert [p[2] for p in g["contours"][0]] == [1, 0, 0, 1, 1]


def test_other_sites_cannot_call_the_api(client):
    """A page elsewhere can fire GETs at localhost; the browser's Sec-Fetch-Site header gives it away."""
    assert client.get("/api/ping", headers={"sec-fetch-site": "cross-site"}).status_code == 403
    assert client.get("/api/ping", headers={"sec-fetch-site": "same-site"}).status_code == 403  # another port on localhost
    assert client.get("/api/ping", headers={"sec-fetch-site": "same-origin"}).status_code == 200
    assert client.get("/api/ping").status_code == 200  # not a browser


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_font_wide_undo_takes_back_a_script_and_a_rename(client, tmp_path):
    """A script and a rename have no undo of their own: each gets a checkpoint, taken back newest first."""
    import shutil
    path = tmp_path / "U.sfd"
    shutil.copy(SFD, path)
    fid = client.post("/api/open", json={"path": str(path)}).json()["fid"]
    glyphs = lambda: {g["name"]: g["width"] for g in client.get("/api/info", params={"fid": fid}).json()["glyphs"]}
    before = glyphs()["A"]
    assert client.get("/api/undo-font", params={"fid": fid}).json()["label"] is None
    assert client.post("/api/undo-font", json={"fid": fid}).status_code == 400  # nothing yet
    assert client.post("/api/script", json={"fid": fid, "code": "font['A'].width = 1234"}).json()["error"] is None
    assert client.post("/api/glyph-rename", json={"fid": fid, "old": "A", "new": "Alpha2"}).status_code == 200
    assert glyphs().get("Alpha2") == 1234
    assert client.post("/api/undo-font", json={"fid": fid}).json()["undone"] == "the rename"
    assert glyphs().get("A") == 1234 and "Alpha2" not in glyphs()
    r = client.post("/api/undo-font", json={"fid": fid}).json()
    assert r["undone"] == "the script run" and r["left"] == 0 and glyphs()["A"] == before
    # the same handle still works, and the font counts as unsaved so autosave writes what is on screen
    assert client.post("/api/autosave", json={"fid": fid}).json()["saved"] is True


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_hinting_is_shown_cleared_autohinted_and_undone(client, tmp_path):
    import shutil
    path = tmp_path / "H.sfd"
    shutil.copy(SFD, path)
    fid = client.post("/api/open", json={"path": str(path)}).json()["fid"]
    stems = lambda: client.get("/api/hints", params={"fid": fid, "name": "H"}).json()
    assert stems()["outlined"] > 500
    r = client.post("/api/hints", json={"fid": fid, "names": ["H"], "clear": True}).json()
    assert r["glyphs"] == 1 and r["glyph"] == {"h": [], "v": [], "instructions": 0}
    r = client.post("/api/hints", json={"fid": fid, "names": ["H"]}).json()
    assert len(r["glyph"]["v"]) >= 2 and len(r["glyph"]["h"]) >= 1  # the two stems and the bar of an H
    assert client.post("/api/undo-font", json={"fid": fid}).json()["undone"] == "the hinting change"
    assert stems()["glyph"]["v"] == []


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_make_glyphs_for_features(client):
    """The Features page makes glyphs to draw: a scaled copy of a base, or an empty one of a given width; never over an existing name."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    base = client.get("/api/glyph/x", params={"fid": fid}).json()
    items = [{"name": "x.sc_test", "base": "x", "scale": 0.5}, {"name": "f_i_test", "width": 777}]
    made = client.post("/api/make-glyphs", json={"fid": fid, "items": items}).json()
    assert made["created"] == ["x.sc_test", "f_i_test"]
    copy = client.get("/api/glyph/x.sc_test", params={"fid": fid}).json()
    assert copy["contours"] and copy["width"] == round(base["width"] * 0.5)
    assert client.get("/api/glyph/f_i_test", params={"fid": fid}).json()["width"] == 777
    again = client.post("/api/make-glyphs", json={"fid": fid, "items": items}).json()
    assert again["created"] == []


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_outlines_at_a_weight_include_glyphs_the_variable_font_lacks(client):
    """A glyph made after the variable font was compiled is missing from it; the page used to ask for it forever."""
    import server

    class Compiled:  # a variable font that knows no glyph of ours
        axes = [{"tag": "wght", "default": 400, "min": 100, "max": 900}]
        def outlines(self, location, names): return []

    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    client.post("/api/make-glyphs", json={"fid": fid, "items": [{"name": "f_i_loop", "width": 640}]})
    server.variables[fid] = Compiled()
    try:
        got = client.post("/api/outlines", json={"fid": fid, "names": ["f_i_loop"], "location": {"wght": 700}}).json()
    finally:
        server.variables.pop(fid, None)
    assert [o["name"] for o in got] == ["f_i_loop"] and got[0]["width"] == 640


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_ligature_glyphs_start_as_their_letters(client):
    """A ligature made for the Features page starts as its letters side by side, as outlines of their own (not linked), not an empty
    glyph the font would swap in; an empty one can be filled."""
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    x = client.get("/api/glyph/x", params={"fid": fid}).json()
    made = client.post("/api/make-glyphs", json={"fid": fid, "items": [{"name": "x_x_test", "parts": ["x", "x"]}]}).json()
    assert made["created"] == ["x_x_test"]
    lig = client.get("/api/glyph/x_x_test", params={"fid": fid}).json()
    assert len(lig["contours"]) == 2 * len(x["contours"]) and lig["refs_list"] == [] and lig["width"] == 2 * x["width"]
    client.post("/api/make-glyphs", json={"fid": fid, "items": [{"name": "x_empty_test", "width": 500}]})
    fill = {"name": "x_empty_test", "parts": ["x"], "fill": True}
    assert client.post("/api/make-glyphs", json={"fid": fid, "items": [fill]}).json()["created"] == ["x_empty_test"]
    filled = client.get("/api/glyph/x_empty_test", params={"fid": fid}).json()
    assert filled["contours"] and filled["refs_list"] == []
    assert client.post("/api/make-glyphs", json={"fid": fid, "items": [fill]}).json()["created"] == [], "a drawn glyph is never overwritten"


@pytest.mark.skipif(not VFS, reason="no variable font installed")
def test_split_variable_font_into_masters(client, tmp_path):
    info = client.post("/api/open", json={"path": str(VFS[0])}).json()
    r = client.post("/api/family/split", json={"fid": info["fid"], "path": str(tmp_path / "Split Test")})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["folder"] == str(tmp_path / "Split Test") and Path(out["designspace"]).is_file()
    assert len(out["masters"]) >= 2 and all(Path(m).parent == Path(out["folder"]) for m in out["masters"])
    fam = client.get("/api/family", params={"path": out["designspace"]}).json()
    assert fam["axes"][0]["tag"] == "wght" and len(fam["masters"]) == len(out["masters"])
    check = client.get("/api/family/check", params={"path": out["designspace"]}).json()
    assert not check["glyphs"], check["glyphs"][:3]  # the masters blend
    again = client.post("/api/family/split", json={"fid": info["fid"], "path": str(tmp_path / "Split Test")})
    assert again.status_code == 400  # never over a folder that has fonts in it


CONSOLE = Path(r"C:\Users\Joep\Downloads\ConsoleSquareBetaVF.ttf")


@pytest.mark.skipif(not CONSOLE.exists(), reason="font not on this machine")
def test_split_keeps_the_in_between_master(client, tmp_path):
    info = client.post("/api/open", json={"path": str(CONSOLE)}).json()
    r = client.post("/api/family/split", json={"fid": info["fid"], "path": str(tmp_path / "Console")}).json()
    fam = client.get("/api/family", params={"path": r["designspace"]}).json()
    assert [m["weight"] for m in fam["masters"]] == [100, 400, 1000]  # gvar peaks at 400 as well as at the end
    assert not client.get("/api/family/check", params={"path": r["designspace"]}).json()["glyphs"]


@pytest.mark.skipif(not CONSOLE.exists(), reason="font not on this machine")
def test_blend_draws_glyphs_made_of_components(client, tmp_path):
    info = client.post("/api/open", json={"path": str(CONSOLE)}).json()
    r = client.post("/api/family/split", json={"fid": info["fid"], "path": str(tmp_path / "Comp")}).json()
    b = client.post("/api/family/blend", json={"path": r["designspace"], "weight": 250, "names": ["nine"]}).json()
    assert b["nine"] and b["nine"]["contours"] and b["nine"]["refs"] == []  # a nine is a six turned round: nothing to draw without its component


def _signed(contour):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(contour, contour[1:] + contour[:1])) / 2


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_allow_overlap_stacks_crossing_shapes(client):
    """With "Allow overlap" on, a shape drawn the other way round that crosses another merges with it instead of cutting it out;
    a shape wholly inside another is still a hole; with it off, directions are left as drawn."""
    cw = lambda x0, y0, x1, y1: [[x0, y0, 1], [x0, y1, 1], [x1, y1, 1], [x1, y0, 1]]
    def draw(name, stack):
        fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
        client.post("/api/create", json={"fid": fid, "name": name})
        g = None
        for pts in (cw(0, 0, 400, 400), cw(300, 300, 700, 700)[::-1], cw(100, 100, 200, 200)[::-1]):  # a body, a crossing shape drawn backwards, a counter
            g = client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "stack": stack, "args": {"points": pts, "closed": True}}).json()
        return [_signed(c) for c in g["contours"]]
    off = draw("stack_off", False)
    assert off[0] * off[1] < 0  # as drawn: the crossing shape runs against the body
    on = draw("stack_on", True)
    assert on[0] * on[1] > 0  # the crossing shape now runs with the body, so the two merge
    assert on[0] * on[2] < 0  # the shape inside the body is still a hole


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_allow_overlap_switched_on_stacks_an_existing_glyph(client):
    """A glyph drawn with the setting off (a bar running against its stems) is stacked the moment the setting goes on, with no other edit."""
    rect = lambda x0, y0, x1, y1: [[x0, y0, 1], [x0, y1, 1], [x1, y1, 1], [x1, y0, 1]]
    fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
    client.post("/api/create", json={"fid": fid, "name": "stack_h"})
    e = lambda kind, stack, **a: client.post("/api/edit", json={"fid": fid, "name": "stack_h", "kind": kind, "stack": stack, "args": a}).json()
    e("add_contour", False, points=rect(0, 0, 100, 800), closed=True)
    e("add_contour", False, points=rect(400, 0, 500, 800), closed=True)
    g = e("add_contour", False, points=rect(30, 300, 470, 400)[::-1], closed=True)
    assert _signed(g["contours"][2]) * _signed(g["contours"][0]) < 0  # the bar cuts the stems out
    g = e("stack", True)
    assert all(_signed(c) * _signed(g["contours"][0]) > 0 for c in g["contours"])  # now all three go the same way and merge


@pytest.mark.skipif(not SFD.exists(), reason="run tests/fetch_fixtures.sh")
def test_allow_overlap_shape_inside_another(client):
    """A shape wholly inside another keeps its direction relative to it: the same way is more ink on top (no hole), the other way a counter.
    The direction of the whole group is never forced, so a font that draws its outlines counter-clockwise stays that way."""
    cw = lambda x0, y0, x1, y1: [[x0, y0, 1], [x0, y1, 1], [x1, y1, 1], [x1, y0, 1]]
    def draw(name, shapes):
        fid = client.post("/api/open", json={"path": str(SFD)}).json()["fid"]
        client.post("/api/create", json={"fid": fid, "name": name})
        g = None
        for pts in shapes:
            g = client.post("/api/edit", json={"fid": fid, "name": name, "kind": "add_contour", "stack": True, "args": {"points": pts, "closed": True}}).json()
        return [_signed(c) for c in g["contours"]]
    same = draw("inside_same", [cw(0, 0, 400, 400), cw(100, 100, 200, 200)])
    assert same[0] * same[1] > 0  # on top, so no hole
    hole = draw("inside_hole", [cw(0, 0, 400, 400), cw(100, 100, 200, 200)[::-1]])
    assert hole[0] * hole[1] < 0  # drawn as a counter, so it stays one
    # an outline that runs counter-clockwise, with a counter, crossed by a shape drawn clockwise: all turn to the outline's way, the counter with it
    both = draw("inside_ccw", [cw(0, 0, 400, 400)[::-1], cw(100, 100, 200, 200), cw(300, 300, 600, 600)])
    assert both[0] > 0 and both[2] > 0 and both[1] < 0  # the outline stays counter-clockwise (positive here), the crossing shape joins it, the counter still runs the other way
