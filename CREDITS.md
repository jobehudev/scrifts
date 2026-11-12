# Credits

Scrifts is a new interface. The font work underneath is done by other people's projects, used as libraries, not forked:

- **FontForge** (GPL-3.0-or-later) reads and writes every font format, edits outlines, builds OpenType features and hints. https://fontforge.org
- **fontTools** (MIT) builds variable fonts (varLib, designspace) and subsets. https://github.com/fonttools/fonttools
- **glyphsLib** (Apache-2.0) reads Glyphs files. https://github.com/googlefonts/glyphsLib
- **potracer** / **Pillow** / **NumPy** trace and process scanned handwriting.
- Interface: React, Vite, Tailwind, shadcn/ui, dockview, Tauri, FastAPI.

Thanks to all of their authors and contributors.

Scrifts itself is licensed GPL-3.0-or-later, like FontForge.

The Windows installer ships FontForge's own Windows build unchanged (GPL-3.0-or-later; its licence is in `forge-backend/_internal/FontForgeBuilds/LICENSE.txt` after install). Its source: https://github.com/fontforge/fontforge
