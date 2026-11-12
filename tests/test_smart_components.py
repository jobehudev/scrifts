import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from smart_components import clean, compose, max_name, read_smart, write_smart  # noqa: E402


def test_comment_round_trip_keeps_other_lines():
    parts = [{"part": "_part.stem", "t": 0.25, "dx": 10, "dy": 0}]
    c = write_smart("a note", parts)
    assert c.splitlines()[0] == "a note" and read_smart(c) == parts
    assert write_smart(c, []) == "a note"
    assert read_smart("") == [] and read_smart("@smart {bad") == []


def test_t_is_clamped_by_refusal():
    assert clean({"part": "p", "t": 1})["t"] == 1
    for bad in (-0.1, 1.5):
        with pytest.raises(ValueError):
            clean({"part": "p", "t": bad})


def test_compose_moves_each_part_and_takes_the_first_advance():
    a = {"width": 300, "contours": [[[0, 0, 1], [0, 10, 1]]], "closed": [True]}
    b = {"width": 100, "contours": [[[5, 5, 1]]], "closed": [False]}
    out = compose([(a, 20, 0), (b, 0, -5)])
    assert out["contours"] == [[[20, 0, 1], [20, 10, 1]], [[5, 0, 1]]] and out["closed"] == [True, False] and out["width"] == 320
    assert max_name("_part.stem") == "_part.stem.max"
