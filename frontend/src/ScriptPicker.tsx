import { GRID_SCRIPTS, shortName, slotCount } from './gridScripts'

/** The languages to show slots for in the glyph grid, as checkboxes: the name and the OpenType script tag the font uses for it.
 *  `locked` ones have glyphs in the font and stay on. */
export function ScriptPicker({ value, onChange, locked = [], cols = 2 }: {
  value: string[]; onChange: (v: string[]) => void; locked?: string[]; cols?: 1 | 2
}) {
  return (
    <div className={`grid gap-x-3 gap-y-0.5 text-xs ${cols === 2 ? 'grid-cols-2' : ''}`}>
      {GRID_SCRIPTS.map(s => {
        const stay = locked.includes(s.tag)
        const on = value.includes(s.tag) || stay
        return (
          <label key={s.tag} title={stay ? `${s.name}: the font has glyphs in this script, so it stays in the grid` : `${s.name} · OpenType script ${s.tag} · ${slotCount(s.tag).toLocaleString()} slots`}
            className={`flex items-center gap-2 rounded px-1.5 py-1 hover:bg-accent ${stay ? 'opacity-70' : 'cursor-pointer'}`}>
            <input type="checkbox" checked={on} disabled={stay}
              onChange={() => onChange(on ? value.filter(t => t !== s.tag) : [...value, s.tag])} />
            <span className="min-w-0 flex-1 truncate">{shortName(s.tag)}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{s.tag}</span>
          </label>
        )
      })}
    </div>
  )
}
