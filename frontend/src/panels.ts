// Which views and tool panels exist. Kept apart from the dock so the menu can list them without loading it.

/** Views that edit or proof the font: what a split opens. */
export const VIEWS: [string, string][] = [['glyph', 'Glyph Editor'], ['spacing', 'Spacing'], ['accents', 'Accents'], ['features', 'Features'], ['script', 'Script']]
/** Tool panels, docked like views. */
export const TOOLS: [string, string][] = [['grid', 'Glyphs'], ['layers', 'Layers'], ['properties', 'Properties'], ['info', 'Glyph info'], ['history', 'Snapshots'], ['shapes', 'Shapes'], ['smart', 'Smart parts'], ['variable', 'Axes'], ['compare', 'Compare masters']]
