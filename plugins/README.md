# Scrifts plugins

A plugin is a folder with two files: `plugin.json` (its name and settings) and `main.py` (the code, written in
**Python**). Put it in `%APPDATA%\Scrifts\plugins` (Plugins menu → Open your plugins folder…) and it shows up in the
Plugins menu.

The plugins that ship with Scrifts (the ones in this folder) are copied into that same folder each time Scrifts starts,
if they are missing, so you can read them, copy them as a starting point, edit them or delete them. A plugin you have
edited is never overwritten; one you delete comes back at the next start.

```
my-plugin/
  plugin.json
  main.py
```

**plugin.json**

```json
{
  "name": "Round coordinates",
  "description": "What it does, in a sentence or two.",
  "version": "1.0",
  "author": "You",
  "params": [
    { "name": "step", "type": "integer", "label": "Grid step", "default": 10, "min": 1, "max": 100 }
  ]
}
```

Param types: `number`, `integer` (with optional `min` / `max`), `text`, `bool`, and `choice` (with `options`, each a
plain value or `{ "value": ..., "label": ... }`). Scrifts draws the settings form from this list.

**main.py**

```python
def run(font, ctx, params):
    for g in ctx.glyphs(params["scope"]):   # "selected" or "all"
        ctx.undoable(g)                      # lets the editor's Undo take the change back
        g.round(params["step"])
    ctx.log("Done.")                         # shown to the user afterwards
```

* `font` is the open FontForge font: <https://fontforge.org/docs/scripting/python/fontforge.html>
* `psMat` and `fontforge` are already imported.
* `ctx.selected` is the selected glyph's name, `ctx.glyph("H")` finds a glyph by name or character,
  `ctx.glyphs(scope)` gives the glyph list, `ctx.undoable(...)` saves undo steps, `ctx.log(...)` reports.
* Raise an error with a clear sentence to stop and tell the user what is wrong.

**A plugin is code that runs with your permissions.** Only install plugins from people you trust, and read
`main.py` first (it is short). Scrifts asks before it runs a plugin you added yourself for the first time.
