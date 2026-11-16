"""Plugins: small Python tools that show up in Scrifts' Plugins menu.

A plugin is a folder holding

    plugin.json   {"name": "...", "description": "...", "version": "1.0", "author": "...",
                   "params": [{"name": "step", "type": "integer", "label": "Round to", "default": 10, "min": 1, "max": 100}]}
    main.py       def run(font, ctx, params): ...

`font` is the open FontForge font, `ctx` helps (ctx.selected, ctx.glyphs(scope), ctx.undoable(...), ctx.log(...)),
`params` holds the values the user chose. Scrifts builds the settings form from `params`, so a plugin never draws UI.

This module is only the rules (stdlib only): reading manifests, checking what the user typed, finding plugins.
The code itself runs in the FontForge worker (worker.op_run_plugin).
"""
import json
import os

TYPES = ("number", "integer", "text", "bool", "choice")
SCOPES = ("selected", "all")


def user_dir() -> str:
    base = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), ".config")
    new = os.path.join(base, "Scrifts", "plugins")
    old = os.path.join(base, "Forge", "plugins")  # where they lived before the rename: copied over once
    if os.path.isdir(old) and not os.path.exists(new):
        try:
            import shutil
            shutil.copytree(old, new)
        except OSError:
            return old
    return new


def plugin_dirs(bundled: str) -> list[tuple[str, str]]:
    """(label, folder) where plugins are looked for: the ones shipped with Scrifts, then the user's own."""
    return [("bundled", bundled), ("yours", user_dir())]


def _same(a: str, b: str) -> bool:
    """Do these two plugin folders hold the same plugin.json and main.py?"""
    for f in ("plugin.json", "main.py"):
        try:
            if open(os.path.join(a, f), "rb").read() != open(os.path.join(b, f), "rb").read():
                return False
        except OSError:
            return False
    return True


def discover_user(bundled: str) -> list[dict]:
    """The plugins in the user's own folder, after putting back any that ship with Scrifts and are missing there
    (deleted, or new in this version). One that exists is never touched, so edits stay. A plugin that is still exactly
    the shipped one is listed as "bundled" (trusted); an edited or added one is "yours"."""
    import shutil
    mine = user_dir()
    os.makedirs(mine, exist_ok=True)
    shipped = {os.path.basename(i["folder"]): i["folder"] for i in discover([("bundled", bundled)])}
    for name, folder in shipped.items():
        if not os.path.exists(os.path.join(mine, name)):
            try:
                shutil.copytree(folder, os.path.join(mine, name))
            except OSError:
                pass
    found = discover([("yours", mine)])
    for p in found:
        name = os.path.basename(p["folder"])
        if name in shipped and _same(shipped[name], p["folder"]):
            p["source"], p["id"] = "bundled", "bundled/" + name
    return found


def read_manifest(folder: str) -> dict:
    """The manifest of the plugin in `folder`, checked. Raises ValueError saying what is wrong."""
    path = os.path.join(folder, "plugin.json")
    if not os.path.isfile(path):
        raise ValueError("no plugin.json")
    if not os.path.isfile(os.path.join(folder, "main.py")):
        raise ValueError("no main.py")
    try:
        m = json.load(open(path, encoding="utf8"))
    except ValueError as e:
        raise ValueError(f"plugin.json isn't valid JSON ({e})")
    if not isinstance(m, dict) or not str(m.get("name", "")).strip():
        raise ValueError('plugin.json needs a "name"')
    params, seen = [], set()
    for p in m.get("params", []):
        if not isinstance(p, dict) or not str(p.get("name", "")).isidentifier():
            raise ValueError('every param needs a "name" that is a plain identifier (letters, digits, _)')
        if p["name"] in seen:
            raise ValueError(f"param {p['name']} is listed twice")
        seen.add(p["name"])
        t = p.get("type", "text")
        if t not in TYPES:
            raise ValueError(f"param {p['name']}: type must be one of {', '.join(TYPES)}")
        if t == "choice" and not (isinstance(p.get("options"), list) and p["options"]):
            raise ValueError(f"param {p['name']}: a choice needs a list of options")
        params.append({**p, "type": t, "label": p.get("label") or p["name"].replace("_", " ").capitalize()})
    return {"name": str(m["name"]).strip(), "description": str(m.get("description", "")), "version": str(m.get("version", "")),
            "author": str(m.get("author", "")), "params": params}


def coerce(spec: list[dict], values: dict) -> dict:
    """What the user chose, made safe: right types, inside min/max, one of the options. Missing means the default.
    Raises ValueError naming the param when a value can't be used."""
    out = {}
    for p in spec:
        name, t = p["name"], p["type"]
        v = values.get(name, p.get("default"))
        if v is None:
            v = {"number": 0, "integer": 0, "text": "", "bool": False}.get(t, (p.get("options") or [None])[0])
        try:
            if t == "bool":
                v = bool(v)
            elif t in ("number", "integer"):
                v = float(v)
                if v != v:  # NaN
                    raise ValueError
                v = int(round(v)) if t == "integer" else v
                if "min" in p:
                    v = max(p["min"], v)
                if "max" in p:
                    v = min(p["max"], v)
            elif t == "choice":
                opts = [o["value"] if isinstance(o, dict) else o for o in p["options"]]
                if v not in opts:
                    raise ValueError
            else:
                v = str(v)
        except (TypeError, ValueError):
            raise ValueError(f"{p['label']}: {values.get(name)!r} isn't usable here")
        out[name] = v
    return out


def discover(dirs: list[tuple[str, str]]) -> list[dict]:
    """Every plugin folder in these places. A broken one is still listed, with its `error`, so the user can see why."""
    found = []
    for source, root in dirs:
        if not os.path.isdir(root):
            continue
        for name in sorted(os.listdir(root)):
            folder = os.path.join(root, name)
            if not os.path.isdir(folder) or name.startswith((".", "_")):
                continue
            item = {"id": f"{source}/{name}", "source": source, "folder": folder, "name": name, "description": "", "version": "", "author": "", "params": []}
            try:
                item.update(read_manifest(folder))
            except ValueError as e:
                item["error"] = str(e)
            found.append(item)
    return found
