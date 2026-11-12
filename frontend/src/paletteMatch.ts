export type PaletteItem = {
  id: string
  group: string          // File, Edit, View, Glyph, Font, Plugins, Window, Help, Open recent
  label: string
  hint?: string          // a shortcut, shown at the right
  keywords?: string      // extra words that find it
  enabled?: boolean
  run: () => void
}

/** Every word you type has to appear somewhere in the item's name, group or keywords. */
export function matches(item: PaletteItem, query: string): boolean {
  const hay = `${item.group} ${item.label} ${item.keywords ?? ''}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}
