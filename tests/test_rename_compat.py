"""Projects and files made before the Forge -> Scrifts rename keep working."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import glyphs_io  # noqa: E402


def test_project_folder_uses_the_new_name_but_keeps_an_old_one(tmp_path):
    g = tmp_path / "Font.glyphs"
    assert glyphs_io.project_folder(str(g)).endswith("Font.scrifts")
    (tmp_path / "Font.forge").mkdir()
    assert glyphs_io.project_folder(str(g)).endswith("Font.forge")  # made before the rename: its edits live there
    (tmp_path / "Font.scrifts").mkdir()
    assert glyphs_io.project_folder(str(g)).endswith("Font.scrifts")


def test_designspace_lib_reads_the_old_key():
    old = {"com.forge.axisMaps": {"Weight": [[1, 2]]}}
    assert glyphs_io.lib_get(old, glyphs_io.AXIS_MAPS_KEY, {}) == {"Weight": [[1, 2]]}
    assert glyphs_io.lib_get({glyphs_io.AXIS_MAPS_KEY: {"a": 1}, **old}, glyphs_io.AXIS_MAPS_KEY, {}) == {"a": 1}
    assert glyphs_io.lib_get({}, glyphs_io.AXIS_MAPS_KEY, {}) == {}
