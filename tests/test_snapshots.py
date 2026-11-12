import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import snapshots as sn  # noqa: E402


@pytest.fixture
def project(tmp_path):
    (tmp_path / "Fam.designspace").write_text("ds v1")
    (tmp_path / "A.sfd").write_text("a v1")
    (tmp_path / "B.sfd").write_text("b v1")
    files = [str(tmp_path / n) for n in ("Fam.designspace", "A.sfd", "B.sfd")]
    return tmp_path, str(tmp_path / "Fam.designspace"), files


def test_create_copies_every_file_and_leaves_the_project_alone(project):
    d, main, files = project
    m = sn.create(main, files, "first draft")
    assert m["label"] == "first draft" and m["kind"] == "manual" and sorted(m["files"]) == ["A.sfd", "B.sfd", "Fam.designspace"]
    assert (Path(sn.history_dir(main)) / m["id"] / "A.sfd").read_text() == "a v1"
    assert (d / "A.sfd").read_text() == "a v1"
    assert [x["id"] for x in sn.list_snapshots(main)] == [m["id"]]


def test_files_outside_the_project_folder_are_refused_and_nothing_is_left_behind(project, tmp_path_factory):
    d, main, files = project
    other = tmp_path_factory.mktemp("elsewhere") / "X.sfd"
    other.write_text("x")
    with pytest.raises(ValueError):
        sn.create(main, files + [str(other)])
    assert sn.list_snapshots(main) == []
    hd = Path(sn.history_dir(main))
    assert not hd.exists() or not any(hd.iterdir())


def test_restore_brings_back_old_files_and_can_itself_be_undone(project):
    d, main, files = project
    first = sn.create(main, files, "good")
    (d / "A.sfd").write_text("a v2 (a mistake)")
    (d / "B.sfd").write_text("b v2")
    r = sn.restore(main, first["id"], files)
    assert (d / "A.sfd").read_text() == "a v1" and (d / "B.sfd").read_text() == "b v1"
    before = r["before"]
    assert before["kind"] == "restore" and before["label"] == "Before restoring good"
    sn.restore(main, before["id"], files)  # take the restore back
    assert (d / "A.sfd").read_text() == "a v2 (a mistake)"


def test_automatic_snapshots_are_pruned_but_manual_ones_stay(project):
    d, main, files = project
    keep = sn.create(main, files, "manual one")
    for i in range(5):
        sn.create(main, files, kind="auto")
        time.sleep(0.01)
    assert len(sn.list_snapshots(main)) == 6
    gone = sn.prune(main, keep=2)
    left = sn.list_snapshots(main)
    assert len(gone) == 3 and [m["kind"] for m in left].count("auto") == 2 and any(m["id"] == keep["id"] for m in left)


def test_auto_snapshots_wait_between_each_other(project):
    d, main, files = project
    assert sn.due_for_auto(main)
    sn.create(main, files, kind="auto")
    assert not sn.due_for_auto(main)
    assert sn.due_for_auto(main, now=time.time() + sn.AUTO_EVERY + 1)


@pytest.mark.parametrize("sid", ["", "..", "../x", "a/b", ".hidden", "nope"])
def test_bad_snapshot_ids_are_refused(project, sid):
    _, main, files = project
    sn.create(main, files)
    with pytest.raises(ValueError):
        sn.path_of(main, sid)


def test_delete(project):
    _, main, files = project
    m = sn.create(main, files)
    sn.delete(main, m["id"])
    assert sn.list_snapshots(main) == []


def test_restore_refuses_a_file_outside_the_project(project):
    """meta.json can be edited by anyone who hands you a project: its paths must stay inside the project folder."""
    import json
    import os
    d, main, files = project
    m = sn.create(main, files, "bad")
    meta = os.path.join(sn.path_of(main, m["id"]), "meta.json")
    j = json.load(open(meta, encoding="utf8"))
    j["files"] = [os.path.join("..", "escaped.txt")]
    json.dump(j, open(meta, "w", encoding="utf8"))
    with pytest.raises(ValueError):
        sn.restore(main, m["id"], files)
    assert not (d.parent / "escaped.txt").exists()
