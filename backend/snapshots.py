"""Snapshots: checkpoints of a project's files, so work can always be taken back.

A project is one .sfd, or a family (a .designspace with its masters and brace layers). Its snapshots live in a
sibling folder, `<main file>.history/`, one folder per snapshot:

    MyFont.designspace.history/
        20261107-143012-a1/        meta.json  +  copies of every file, laid out as they are next to the project
        20261107-151500-b2/

Stdlib only. Files are copied, never moved or changed. Restoring puts a snapshot back over the project, and
takes a "Before restoring" snapshot first, so a restore can itself be undone.
"""
import json
import os
import shutil
import time
import uuid

AUTO_KEEP = 20          # automatic snapshots kept; manual ones are never pruned
AUTO_EVERY = 10 * 60    # seconds between automatic snapshots


def history_dir(main: str) -> str:
    return os.path.abspath(main) + ".history"


def _meta(folder: str):
    try:
        with open(os.path.join(folder, "meta.json"), encoding="utf8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def create(main: str, files: list[str], label: str = "", kind: str = "manual") -> dict:
    """Copy `files` (the project's files: absolute paths, all under the main file's folder) into a new snapshot."""
    base = os.path.dirname(os.path.abspath(main))
    root = history_dir(main)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    rels = []
    while True:  # two snapshots in the same second must not share a folder
        sid = stamp + "-" + uuid.uuid4().hex[:2]
        folder = os.path.join(root, sid)
        try:
            os.makedirs(folder)
            break
        except FileExistsError:
            continue
    try:
        for f in files:
            rel = os.path.relpath(os.path.abspath(f), base)
            if rel.startswith(".."):
                raise ValueError(f"{f} is outside the project folder")
            if not os.path.isfile(f):
                continue
            dest = os.path.join(folder, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copy2(f, dest)
            rels.append(rel)
        size = sum(os.path.getsize(os.path.join(folder, r)) for r in rels)
        meta = {"id": sid, "label": label.strip(), "kind": kind, "time": time.time(), "files": rels, "size": size,
                "main": os.path.relpath(os.path.abspath(main), base)}
        with open(os.path.join(folder, "meta.json"), "w", encoding="utf8") as fh:
            json.dump(meta, fh)
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)  # no half-made snapshots
        raise
    if kind == "auto":
        prune(main)
    return meta


def list_snapshots(main: str) -> list[dict]:
    """Newest first."""
    root = history_dir(main)
    out = [m for d in (os.listdir(root) if os.path.isdir(root) else []) if (m := _meta(os.path.join(root, d)))]
    return sorted(out, key=lambda m: m["time"], reverse=True)


def prune(main: str, keep: int = AUTO_KEEP) -> list[str]:
    """Delete the oldest automatic snapshots beyond `keep`; returns their ids."""
    autos = [m for m in list_snapshots(main) if m["kind"] == "auto"]
    gone = []
    for m in autos[keep:]:
        shutil.rmtree(os.path.join(history_dir(main), m["id"]), ignore_errors=True)
        gone.append(m["id"])
    return gone


def due_for_auto(main: str, now: float | None = None) -> bool:
    """Has it been long enough since the last automatic snapshot (or is there none)?"""
    last = next((m for m in list_snapshots(main) if m["kind"] == "auto"), None)
    return last is None or (now or time.time()) - last["time"] >= AUTO_EVERY


def path_of(main: str, sid: str) -> str:
    """The folder of a snapshot; refuses ids that are not a plain snapshot name."""
    if not sid or sid != os.path.basename(sid) or sid.startswith("."):
        raise ValueError("not a snapshot id")
    folder = os.path.join(history_dir(main), sid)
    if not os.path.isfile(os.path.join(folder, "meta.json")):
        raise ValueError(f"no snapshot {sid}")
    return folder


def delete(main: str, sid: str) -> None:
    shutil.rmtree(path_of(main, sid))


def restore(main: str, sid: str, current_files: list[str]) -> dict:
    """Put a snapshot's files back over the project. The files as they are now are snapshotted first
    (kind "restore"), so this can be taken back. The project's fonts must not be open: the caller closes them."""
    folder = path_of(main, sid)
    meta = _meta(folder)
    before = create(main, current_files, label=f"Before restoring {meta['label'] or sid}", kind="restore")
    base = os.path.dirname(os.path.abspath(main))
    for rel in meta["files"]:
        dest = os.path.abspath(os.path.join(base, rel))
        if os.path.commonpath([base, dest]) != base:  # meta.json is a file anyone can edit: never write outside the project
            raise ValueError(f"snapshot lists a file outside the project: {rel}")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy2(os.path.join(folder, rel), dest)
    return {"restored": meta, "before": before}
