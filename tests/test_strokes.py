import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))
import strokes as st


def test_mark_and_parse_round_trip():
    assert st.mark(80) == "~stroke 80 round round" and st.mark(62.5, "butt", "miter") == "~stroke 62.5 butt miter"
    assert st.parse("~stroke 80 butt bevel") == st.Stroke(80, "butt", "bevel")
    assert st.parse("~stroke 40") == st.Stroke(40, "round", "round")        # cap and join have defaults


def test_ordinary_names_and_bad_marks_are_not_strokes():
    for n in ("", None, "bowl", "Shape 1", "~stroke", "~stroke x", "~stroke 0", "~stroke -5", "~stroke 10 pointy", "~stroke 10 round zigzag"):
        assert st.parse(n) is None, n
