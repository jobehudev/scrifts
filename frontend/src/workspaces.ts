// Named panel layouts: built-in presets plus the ones you saved (kept in localStorage).

type Row = [view: string, beside?: string, direction?: 'within' | 'right' | 'below' | 'left', width?: number]

/** Each preset lists panels in order; the first is the root, the rest dock beside a view already placed. */
export const PRESETS: Record<string, Row[]> = {
  Drawing: [['glyph'], ['grid', 'glyph', 'left', 320], ['layers', 'glyph', 'right', 250], ['properties', 'layers', 'within']],
  Spacing: [['spacing'], ['grid', 'spacing', 'left', 260], ['properties', 'spacing', 'right', 250]],
  Proofing: [['spacing'], ['glyph', 'spacing', 'below'], ['grid', 'spacing', 'left', 260]],
  Accents: [['accents'], ['grid', 'accents', 'left', 300], ['layers', 'accents', 'right', 250]],
  Focus: [['glyph']],
  Masters: [['glyph'], ['grid', 'glyph', 'left', 240], ['compare', 'glyph', 'right', 460], ['layers', 'compare', 'within']],
  Variable: [['glyph'], ['grid', 'glyph', 'left', 240], ['variable', 'glyph', 'right', 280], ['spacing', 'glyph', 'below']],
  Features: [['features'], ['grid', 'features', 'left', 260], ['script', 'features', 'below']],
  Scripting: [['script'], ['grid', 'script', 'left', 260], ['glyph', 'script', 'below']],
  Review: [['compare'], ['grid', 'compare', 'left', 240], ['glyph', 'compare', 'right'], ['history', 'compare', 'below']],
}

const KEY = 'scrifts.workspaces'
export const readSaved = (): Record<string, unknown> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } }
export const writeSaved = (v: Record<string, unknown>) => localStorage.setItem(KEY, JSON.stringify(v))
