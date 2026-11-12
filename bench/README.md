# Benchmarks: Scrifts vs FontForge

Same machine (Windows 11), same FontForge core (FontForgeBuilds, 2025-10-09),
same fonts. Median of 3 runs. Measured 2026-11-04.

| | DejaVu Serif `.sfd` (940 glyphs) | Noto Sans VF `.ttf` (4,503 glyphs, 2 axes) |
|---|---|---|
| **FontForge** launch → font window visible | 1,666 ms | 3,042 ms |
| **Scrifts** open, cold worker (spawn FontForge's Python + open) | 130 ms | 460 ms |
| **Scrifts** open, warm worker | 38 ms | 388 ms |
| **Scrifts** first grid screen of outlines (60 glyphs) | 5 ms | 6 ms |
| **FontForge** private memory | 72 MB | 107 MB |
| **Scrifts backend** private memory (API + worker) | 77 MB (47 + 29) | 128 MB (59 + 68) |
| **Scrifts browser tab** JS heap | 31 MB | not measured |

## What these numbers do and don't say

- **Not apples to apples on open.** FontForge's number includes starting the
  whole GUI app (GTK/GDK, Python, prefs) and creating the window. Scrifts'
  includes spawning FontForge's Python and opening the font, but the API
  server and browser are already running. A fair cold-start comparison
  needs desktop packaging (out of scope for v0).
- **Time to first paint is not measured yet.** The grid records it
  (`window.__forgeBench.firstPaint`, open click → first frame with every
  visible cell drawn), but the in-app browser pane was hidden during the
  run, and a hidden page gets no animation frames. Re-run with the pane
  visible.
- **Memory: Scrifts uses more, not less.** The backend alone is about the same
  as FontForge for the .sfd and ~20 MB more for Noto, because fontTools
  also holds the variable font. Add the browser renderer on top. The gain
  is responsiveness (virtualized grid, async calls, per-location glyph-set
  cache), not footprint.
- Noto opens slower in Scrifts warm (388 ms) than DejaVu because FontForge
  itself parses 4.5k glyphs plus `fvar`/`gvar`; Scrifts' own overhead is
  the 6 ms outline fetch.

## Re-running

```bash
powershell -File bench/fontforge_gui.ps1 "C:\path\font.sfd" 3
```
```bash
.venv/Scripts/python bench/backend.py "C:\path\font.sfd"
```

Start the API without `--reload` for memory numbers (the reloader adds a
process), and restart it between fonts.
