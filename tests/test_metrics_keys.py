import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from metrics_keys import creates_cycle, parse_key, read_keys, value, write_keys  # noqa: E402


def test_parse():
    assert parse_key("=H") == ("H", False, 0)
    assert parse_key("=|n") == ("n", True, 0)
    assert parse_key("=H+10") == ("H", False, 10)
    assert parse_key("=a.sc-4.5") == ("a.sc", False, -4.5)
    for bad in ("50", "H", "=", "=|"):
        with pytest.raises(ValueError):
            parse_key(bad)


def test_value_same_and_opposite_side():
    h = (80, 60)  # lsb, rsb
    assert value("=H", "lsb", h) == 80 and value("=H", "rsb", h) == 60
    assert value("=|H", "lsb", h) == 60 and value("=|H", "rsb", h) == 80
    assert value("=H+10", "lsb", h) == 90 and value("=H-15", "rsb", h) == 45


def test_comment_round_trip_keeps_other_lines():
    c = write_keys("my note", {"lsb": "=H", "rsb": "=|n"})
    assert c.splitlines()[0] == "my note" and read_keys(c) == {"lsb": "=H", "rsb": "=|n"}
    assert write_keys(c, {}) == "my note"
    assert read_keys("") == {} and read_keys("@metrics {bad") == {}


def test_cycles():
    graph = {"a": ["b"], "b": ["c"], "c": []}
    refs = lambda g: graph.get(g, [])
    assert not creates_cycle("d", "lsb", "=a", refs)
    assert creates_cycle("c", "lsb", "=a", refs)   # c -> a -> b -> c
    assert creates_cycle("a", "rsb", "=a", refs)
