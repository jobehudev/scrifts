import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import svgdoc

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 200 100">
  <g fill="red" transform="translate(5 5)" opacity="0.5">
    <rect x="0" y="0" width="50" height="20" stroke="#00f" style="stroke-width:3"/>
    <circle cx="10" cy="10" r="4" fill="none"/>
  </g>
  <path d="M0 0L10 10" fill="url(#g)"/>
  <text>hi</text><image href="x.png"/>
  <defs><path d="M0 0L1 1"/></defs>
</svg>"""


def test_parse_styles_groups_and_losses():
    d = svgdoc.parse(SVG)
    assert (d["width"], d["height"]) == (200, 100)
    r, c, p = d["shapes"]
    assert r["fill"] == "#ff0000" and r["stroke"] == "#0000ff" and r["sw"] == 3 and r["op"] == 0.5
    assert "translate(5 5)" in r["transform"] and "translate(-10 -20)" in r["transform"]
    assert c["fill"] is None and c["stroke"] is None
    assert p["fill"] == "#808080"
    assert d["lost"] == ["gradients and patterns (drawn grey)", "images", "text"]


def test_shapes_become_paths():
    d = svgdoc.parse('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><polygon points="0,0 10,0 10,10"/><rect width="4" height="4" rx="1"/></svg>')
    assert d["shapes"][0]["d"].endswith("Z") and "A1 1" in d["shapes"][1]["d"]


def test_tag_round_trip_and_write():
    s = {"fill": "#ff0000", "stroke": None, "sw": 1.5, "op": 1.0}
    assert svgdoc.untag(svgdoc.tag(7, s)) == (7, "#ff0000", None, 1.5, 1.0)
    assert svgdoc.untag("") is None and svgdoc.untag("~stroke 80 round round") is None
    out = svgdoc.write(100, 50, 2, [("M0 0L10 10", "#ff0000", "#000000", 2, 0.5)])
    assert 'viewBox="0 0 100 50"' in out and 'fill="#ff0000"' in out and 'stroke-width="2"' in out and 'opacity="0.5"' in out
