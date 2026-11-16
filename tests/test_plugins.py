import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from plugins import coerce, discover, read_manifest  # noqa: E402


def make(tmp, name, manifest=None, code="def run(font, ctx, params): pass\n"):
    d = tmp / name
    d.mkdir(parents=True)
    if manifest is not None:
        (d / "plugin.json").write_text(manifest if isinstance(manifest, str) else json.dumps(manifest), encoding="utf8")
    if code is not None:
        (d / "main.py").write_text(code, encoding="utf8")
    return d


def test_a_good_manifest(tmp_path):
    d = make(tmp_path, "p", {"name": " Round ", "description": "d", "params": [{"name": "step", "type": "integer", "default": 5}]})
    m = read_manifest(str(d))
    assert m["name"] == "Round" and m["params"][0]["label"] == "Step" and m["version"] == ""


@pytest.mark.parametrize("manifest,code,why", [
    (None, "x", "no plugin.json"),
    ({"name": "x"}, None, "no main.py"),
    ("{not json", "x", "valid JSON"),
    ({"description": "no name"}, "x", '"name"'),
    ({"name": "x", "params": [{"name": "not valid"}]}, "x", "identifier"),
    ({"name": "x", "params": [{"name": "a"}, {"name": "a"}]}, "x", "twice"),
    ({"name": "x", "params": [{"name": "a", "type": "color"}]}, "x", "type must be"),
    ({"name": "x", "params": [{"name": "a", "type": "choice"}]}, "x", "options"),
])
def test_bad_manifests_say_why(tmp_path, manifest, code, why):
    d = make(tmp_path, "p", manifest, code)
    with pytest.raises(ValueError, match=why):
        read_manifest(str(d))


SPEC = [
    {"name": "step", "type": "integer", "label": "Step", "default": 10, "min": 1, "max": 100},
    {"name": "amount", "type": "number", "label": "Amount", "min": 0.5, "max": 2},
    {"name": "name", "type": "text", "label": "Name", "default": "sc"},
    {"name": "on", "type": "bool", "label": "On"},
    {"name": "scope", "type": "choice", "label": "Scope", "options": ["selected", "all"]},
]


def test_values_are_made_safe():
    assert coerce(SPEC, {}) == {"step": 10, "amount": 0.5, "name": "sc", "on": False, "scope": "selected"}
    got = coerce(SPEC, {"step": "250.4", "amount": 9, "on": 1, "scope": "all", "name": 7})
    assert got == {"step": 100, "amount": 2.0, "name": "7", "on": True, "scope": "all"}
    assert coerce(SPEC, {"step": -5})["step"] == 1


@pytest.mark.parametrize("bad", [{"scope": "everything"}, {"step": "many"}, {"amount": float("nan")}])
def test_values_that_cannot_be_used_are_refused(bad):
    with pytest.raises(ValueError):
        coerce(SPEC, bad)


def test_discover_lists_broken_plugins_too(tmp_path):
    make(tmp_path / "a", "good", {"name": "Good"})
    make(tmp_path / "a", "broken", "{nope", "x")
    make(tmp_path / "a", "_hidden", {"name": "Hidden"})
    found = discover([("bundled", str(tmp_path / "a")), ("yours", str(tmp_path / "missing"))])
    assert [(p["id"], p["name"], "error" in p) for p in found] == [("bundled/broken", "broken", True), ("bundled/good", "Good", False)]


def test_bundled_plugins_are_put_back_when_missing_and_edits_stay(tmp_path, monkeypatch):
    import os
    from plugins import discover_user, user_dir
    monkeypatch.setenv("APPDATA", str(tmp_path / "Roaming"))
    shipped = tmp_path / "shipped" / "round"
    shipped.mkdir(parents=True)
    (shipped / "plugin.json").write_text('{"name": "Round"}')
    (shipped / "main.py").write_text("def run(font, ctx, params): pass")
    got = {p["id"]: p for p in discover_user(str(tmp_path / "shipped"))}
    assert list(got) == ["bundled/round"] and os.path.isfile(os.path.join(user_dir(), "round", "main.py"))
    import shutil
    shutil.rmtree(os.path.join(user_dir(), "round"))
    assert list(p["id"] for p in discover_user(str(tmp_path / "shipped"))) == ["bundled/round"]  # back after a delete
    (open(os.path.join(user_dir(), "round", "main.py"), "w")).write("def run(font, ctx, params): print(1)")
    got = discover_user(str(tmp_path / "shipped"))
    assert [p["id"] for p in got] == ["yours/round"]  # an edited copy is the user's now, and is not overwritten
    assert "print(1)" in open(os.path.join(user_dir(), "round", "main.py")).read()
