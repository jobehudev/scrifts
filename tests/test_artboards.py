import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import artboards as ab


def test_file_names_are_safe():
    assert ab.file_name(".notdef") == "_notdef"
    assert ab.file_name("a/b:c") == "a_b_c"
    assert ab.file_name("A.alt") == "A_.alt" and ab.file_name("a") == "a" and ab.file_name("AE") == "A_E_"
    for n in ("A", "a", "AE", "A_B", ".notdef", "a_b", "uni0041", "A.alt"):
        assert ab.glyph_name(ab.file_name(n)) == (".notdef" if n == ".notdef" else n) or n == ".notdef"


def test_artboard_has_metrics_and_outline_layers():
    s = ab.artboard_svg("M0 0h10v10z", 500, 800, 200, xheight=500, capheight=700)
    assert 'width="500"' in s and 'height="1000"' in s and 'id="Metrics"' in s and 'id="Outline"' in s
    assert 'id="baseline"' in s and 'id="cap-height"' in s and 'id="x-height"' in s


def test_outline_only_drops_metrics_and_template_is_empty():
    s = ab.artboard_svg("M0 0h10v10z", 500, 800, 200)
    o = ab.outline_only(s)
    assert "baseline" not in o and "<path" in o
    assert not ab.has_shapes(ab.artboard_svg("", 500, 800, 200))
    assert ab.has_shapes(s)


def test_edges_are_read_back():
    s = ab.artboard_svg("M0 0h10v10z", 500, 800, 200)
    assert ab.edges_of(s) == (0.0, 500.0)
    assert ab.edges_of(s.replace('id="left-edge" x1="0" x2="0"', 'id="left-edge" x1="30" x2="30"'))[0] == 30.0
    assert ab.edges_of("<svg xmlns='http://www.w3.org/2000/svg'/>") == (None, None)
