import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from style_linking import style_linking  # noqa: E402


def test_regular_and_bold_share_the_family():
    r = style_linking("MyGlyphFont", "Regular", 400)
    assert r["names"] == {"Family": "MyGlyphFont", "SubFamily": "Regular", "Preferred Family": "", "Preferred Styles": ""}
    assert r["fields"] == {"os2_stylemap": 0x40, "macstyle": 0}
    b = style_linking("MyGlyphFont", "Bold", 700)
    assert (b["names"]["Family"], b["names"]["SubFamily"]) == ("MyGlyphFont", "Bold")
    assert b["fields"] == {"os2_stylemap": 0x20, "macstyle": 1}


def test_other_weights_are_standalone_families():
    m = style_linking("MyGlyphFont", "Medium", 500)
    assert m["names"] == {"Family": "MyGlyphFont Medium", "SubFamily": "Regular",
                          "Preferred Family": "MyGlyphFont", "Preferred Styles": "Medium"}
    assert m["fields"] == {"os2_stylemap": 0x40, "macstyle": 0}


def test_italics():
    assert style_linking("F", "Italic", 400, True)["fields"] == {"os2_stylemap": 0x01, "macstyle": 2}
    bi = style_linking("F", "Bold Italic", 700, True)
    assert bi["fields"] == {"os2_stylemap": 0x21, "macstyle": 3} and bi["names"]["SubFamily"] == "Bold Italic"
    mi = style_linking("F", "Medium Italic", 500, True)
    assert mi["names"]["SubFamily"] == "Italic" and mi["names"]["Preferred Styles"] == "Medium Italic"
