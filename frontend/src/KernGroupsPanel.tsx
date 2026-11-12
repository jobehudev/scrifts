import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2, X } from 'lucide-react'
import { api, type FontInfo } from './api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Group = { index: number; members: string[] }
type Table = { subtable: string; lookup: string; first: Group[]; second: Group[] }
type Side = 'first' | 'second'

const SIDES: { side: Side; title: string; hint: string }[] = [
  { side: 'first', title: 'Left of a pair', hint: 'Letters whose right edge kerns alike, e.g. A À Á' },
  { side: 'second', title: 'Right of a pair', hint: 'Letters whose left edge kerns alike, e.g. V W' },
]

/**
 * Kerning groups (FontForge kerning classes). Kerning a pair from two
 * groups sets it for every combination; a single pair kern stays an
 * exception that wins over the group value.
 */
export function KernGroupsPanel({ font, current, onChanged }: {
  font: FontInfo; current: string | null; onChanged: () => void
}) {
  const [tables, setTables] = useState<Table[]>([])
  const load = useCallback(() => { api<Table[]>('/api/kern-groups').then(setTables).catch(() => {}) }, [])
  useEffect(load, [load, font])

  const label = (name: string) => {
    const g = font.glyphs.find(x => x.name === name)
    return g && g.unicode > 32 ? String.fromCodePoint(g.unicode) : `/${name}`
  }
  /** "A À Á", "/Agrave", "U+00C1" or names, space-separated -> glyph names */
  const resolve = (text: string) => text.split(/\s+/).filter(Boolean).flatMap(tok => {
    const t = tok.replace(/^\//, '')
    const hex = /^(?:u\+|uni)([0-9a-f]{4,6})$/i.exec(t)
    const cp = hex ? parseInt(hex[1], 16) : [...t].length === 1 ? t.codePointAt(0)! : -1
    const g = font.glyphs.find(x => x.name === t) ?? font.glyphs.find(x => cp >= 0 && x.unicode === cp)
    if (!g) toast.error(`No glyph "${tok}" in this font`)
    return g ? [g.name] : []
  })

  const save = async (side: Side, members: string[], index?: number, subtable?: string) => {
    try {
      setTables(await api<Table[]>('/api/kern-groups', { side, members, index, subtable }))
      onChanged()
    } catch (e) { toast.error('Group change failed', { description: (e as Error).message }) }
  }

  const table = tables[0]  // new groups go into the first class table; fonts with several show them all

  return (
    <aside className="flex w-72 min-h-0 shrink-0 flex-col overflow-y-auto border-l bg-card text-xs">
      <div className="border-b px-3 py-2">
        <div className="font-medium text-muted-foreground">Kerning groups</div>
        <p className="mt-1 text-muted-foreground">Kern one pair from two groups and every combination follows. A single-pair kern stays an exception.</p>
      </div>
      {SIDES.map(({ side, title, hint }) => {
        const groups = tables.flatMap(t => t[side].map(g => ({ ...g, subtable: t.subtable })))
        return (
          <section key={side} className="border-b px-3 py-2">
            <div className="font-medium">{title}</div>
            <p className="mb-2 text-muted-foreground">{hint}</p>
            <div className="flex flex-col gap-2">
              {groups.map(g => {
                const mine = !!current && g.members.includes(current)
                return (
                  <div key={g.subtable + g.index} className={`rounded-md border p-1.5 ${mine ? 'border-(--point-start)' : ''}`}>
                    <div className="mb-1 flex items-center gap-1">
                      <span className="flex-1 font-mono text-muted-foreground">@{g.members[0]}</span>
                      {current && !mine && (
                        <Button size="xs" variant="ghost" title={`Move ${current} into this group`}
                          onClick={() => save(side, [...g.members, current], g.index, g.subtable)}><Plus />{label(current)}</Button>
                      )}
                      <Button size="icon-xs" variant="ghost" aria-label="Delete group" title="Delete group (its members keep their pair kerning)"
                        onClick={() => save(side, [], g.index, g.subtable)}><Trash2 /></Button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {g.members.map(m => (
                        <span key={m} className={`flex items-center gap-0.5 rounded-sm bg-secondary px-1 py-0.5 ${m === current ? 'ring-1 ring-(--point-start)' : ''}`} title={m}>
                          {label(m)}
                          <button type="button" aria-label={`Remove ${m}`} className="text-muted-foreground hover:text-foreground"
                            onClick={() => save(side, g.members.filter(x => x !== m), g.index, g.subtable)}><X className="size-3" /></button>
                        </span>
                      ))}
                      <form onSubmit={e => {
                        e.preventDefault()
                        const input = e.currentTarget.elements.namedItem('add') as HTMLInputElement
                        const add = resolve(input.value).filter(n => !g.members.includes(n))
                        if (add.length) save(side, [...g.members, ...add], g.index, g.subtable)
                        input.value = ''
                      }}>
                        <Input name="add" placeholder="+ add" className="h-5 w-16 px-1 text-xs" title="Letters or /names, space-separated" />
                      </form>
                    </div>
                  </div>
                )
              })}
              {current && (
                <Button size="xs" variant="secondary" onClick={() => save(side, [current], undefined, table?.subtable)}>
                  <Plus />New group with {label(current)}
                </Button>
              )}
            </div>
          </section>
        )
      })}
    </aside>
  )
}
