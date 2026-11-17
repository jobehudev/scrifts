import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type FontInfo } from './api'
import { ask } from './confirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Info = {
  unicode: number; name: string; category: string; category_name: string; script: string; block: string
  decomposition: number[]; uppercase: number | null; lowercase: number | null
}
type Hints = {
  outlined: number; hinted: number; instructed: number; quadratic: boolean; zones: Record<string, number[] | number>
  glyph?: { h: [number, number][]; v: [number, number][]; instructions: number }
}
type Block = { id: string; name: string; group: string; total: number; have: number }

const hex = (cp: number) => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')
const PRESETS: [string, string[]][] = [
  ['Latin', ['basic-latin', 'latin-1', 'latin-ext-a']],
  ['Cyrillic', ['cyrillic']],
  ['Greek', ['greek']],
]

/**
 * What the selected character is (name, category, script, block, the letters
 * it is made of), and a way to add whole blocks of characters the font
 * does not have yet, as empty glyphs with the standard names.
 */
export function GlyphInfoPanel({ font, sel, onSelect, onChanged }: { font: FontInfo; sel: string | null; onSelect: (name: string) => void; onChanged: () => void }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [busy, setBusy] = useState(false)
  const glyph = font.glyphs.find(g => g.name === sel)
  const cp = glyph?.unicode ?? -1

  useEffect(() => {
    let stale = false
    if (cp < 0) { Promise.resolve().then(() => { if (!stale) setInfo(null) }); return () => { stale = true } }
    api<Info>(`/api/glyphdb/info?unicode=${cp}`).then(i => { if (!stale) setInfo(i) }).catch(() => {})
    return () => { stale = true }
  }, [cp])

  const loadBlocks = useCallback(() => api<Block[]>('/api/glyphdb/blocks').then(setBlocks).catch(() => {}), [])
  useEffect(() => { void loadBlocks() }, [loadBlocks, font])

  // hinting: what the font holds now, so "keep the font's own hints" in Generate is not a guess
  const [hints, setHints] = useState<Hints | null>(null)
  useEffect(() => {
    let stale = false
    api<Hints>(`/api/hints${sel ? `?name=${encodeURIComponent(sel)}` : ''}`).then(h => { if (!stale) setHints(h) }).catch(() => {})
    return () => { stale = true }
  }, [sel, font])
  const hint = async (all: boolean, clear: boolean) => {
    if (!all && !sel) return
    setBusy(true)
    try {
      const h = await api<Hints & { glyphs: number }>('/api/hints', { names: all ? null : [sel], clear })
      setHints(all && sel ? await api<Hints>(`/api/hints?name=${encodeURIComponent(sel)}`) : h)
      toast.success(`${clear ? 'Cleared the hints of' : 'Hinted'} ${h.glyphs} glyph${h.glyphs === 1 ? '' : 's'}`, { description: 'Edit, Undo Last Font-Wide Change (Ctrl Alt Z) takes it back.' })
    } catch (e) {
      toast.error('Hinting failed', { description: (e as Error).message })
    } finally { setBusy(false) }
  }
  // a negative width is a hint on one edge only
  const stems = (s: [number, number][]) => s.length ? s.map(([at, w]) => w < 0 ? `${Math.round(at)} (edge)` : `${Math.round(at)} (${Math.round(w)} wide)`).join(', ') : 'none'

  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  if (renaming !== sel) { setRenaming(sel); setNewName(sel ?? '') }  // a new glyph: start the field from its name
  const rename = async () => {
    if (!sel || !newName.trim() || newName === sel) return
    try {
      const r = await api<{ name: string }>('/api/glyph-rename', { old: sel, new: newName })
      onChanged(); onSelect(r.name)
      toast.success(`Renamed ${sel} to ${r.name}`, { description: 'Components, kerning and features follow the new name.' })
    } catch (e) { toast.error('Could not rename', { description: (e as Error).message }) }
  }
  const remove = async () => {
    if (!sel || !await ask('Its slot becomes unused again. Ctrl Alt Z takes it back.', { title: `Remove ${sel}?`, ok: 'Remove', skip: 'delete-glyph' })) return
    try {
      await api('/api/glyph-delete', { name: sel })
      onChanged()
      toast.success(`Removed ${sel}`, { description: 'Edit, Undo Last Font-Wide Change (Ctrl Alt Z) takes it back.' })
    } catch (e) { toast.error('Could not remove', { description: (e as Error).message }) }
  }
  const nameOf = (c: number) => font.glyphs.find(g => g.unicode === c)?.name
  const add = async (ids: string[], label: string) => {
    setBusy(true)
    try {
      const r = await api<{ created: string[] }>('/api/glyphdb/add', { blocks: ids })
      toast.success(r.created.length ? `Added ${r.created.length} ${label} glyphs` : `Nothing to add: the font has all of ${label}`,
        { description: r.created.length ? 'Empty, with standard names: draw them or build them from components.' : undefined })
      await loadBlocks()
      onChanged()
    } catch (e) {
      toast.error('Could not add glyphs', { description: (e as Error).message })
    } finally { setBusy(false) }
  }
  const missing = (ids: string[]) => blocks.filter(b => ids.includes(b.id)).reduce((n, b) => n + b.total - b.have, 0)
  const chip = (c: number | null) => c === null ? null : (
    <Button key={c} size="xs" variant="outline" disabled={!nameOf(c)} title={nameOf(c) ? `Go to ${nameOf(c)}` : 'Not in this font'}
      onClick={() => { const n = nameOf(c); if (n) onSelect(n) }}>
      <span className="font-mono">{String.fromCodePoint(c)}</span><span className="text-muted-foreground">{hex(c)}</span>
    </Button>
  )

  return (
    <div className="h-full overflow-y-auto text-xs">
      <section className="space-y-1 border-b p-3">
        <h3 className="font-medium text-muted-foreground">Selected glyph</h3>
        {glyph && (
          <form className="flex gap-1" onSubmit={e => { e.preventDefault(); void rename() }}>
            <Input className="h-7 font-mono" value={newName} onChange={e => setNewName(e.target.value)} aria-label="Glyph name" />
            <Button size="xs" type="submit" variant="secondary" disabled={!newName.trim() || newName === sel}>Rename</Button>
            <Button size="xs" type="button" variant="outline" onClick={() => void remove()} title="Remove this glyph from the font">Delete</Button>
          </form>
        )}
        {!glyph ? <p className="text-muted-foreground">Select a glyph.</p>
          : !info ? <p className="text-muted-foreground"><span className="font-mono text-foreground">{glyph.name}</span> has no Unicode value (an alternate or component glyph).</p>
            : <>
              <p className="flex items-baseline gap-2"><span className="font-mono text-2xl text-foreground">{String.fromCodePoint(info.unicode)}</span>
                <span className="font-mono">{hex(info.unicode)}</span><span className="font-mono text-muted-foreground">{glyph.name}</span></p>
              <p className="text-foreground">{info.name || 'No Unicode name'}</p>
              <dl className="grid grid-cols-[70px_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
                <dt>Category</dt><dd className="text-foreground">{info.category_name} <span className="font-mono text-muted-foreground">{info.category}</span></dd>
                <dt>Script</dt><dd className="text-foreground">{info.script}</dd>
                <dt>Block</dt><dd className="text-foreground">{info.block}</dd>
              </dl>
              {(info.decomposition.length > 0 || info.uppercase !== null || info.lowercase !== null) && (
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  {info.decomposition.length > 0 && <><span className="text-muted-foreground">made of</span>{info.decomposition.map(chip)}</>}
                  {info.uppercase !== null && <><span className="text-muted-foreground">capital</span>{chip(info.uppercase)}</>}
                  {info.lowercase !== null && <><span className="text-muted-foreground">small</span>{chip(info.lowercase)}</>}
                </div>
              )}
            </>}
      </section>
      {hints && (
        <section className="space-y-1.5 border-b p-3">
          <h3 className="font-medium text-muted-foreground">Hinting</h3>
          <p>{hints.hinted} of {hints.outlined} drawn glyphs have stem hints{hints.quadratic ? `, ${hints.instructed} have TrueType instructions` : ''}.</p>
          <dl className="grid grid-cols-[70px_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
            <dt title="Heights the hinter lines letters up on (baseline, x-height, cap height…), as pairs">Zones</dt>
            <dd className="font-mono text-foreground">{Array.isArray(hints.zones.BlueValues) && hints.zones.BlueValues.length ? hints.zones.BlueValues.join(' ') : 'not set'}</dd>
            <dt title="The usual stem thickness: horizontal / vertical">Stems</dt>
            <dd className="font-mono text-foreground">{[hints.zones.StdHW, hints.zones.StdVW].map(v => (Array.isArray(v) ? v[0] : v) ?? '–').join(' / ')}</dd>
            {hints.glyph && sel && <>
              <dt>{sel}, horiz.</dt><dd className="font-mono text-foreground">{stems(hints.glyph.h)}</dd>
              <dt>{sel}, vert.</dt><dd className="font-mono text-foreground">{stems(hints.glyph.v)}</dd>
              {hints.quadratic && <><dt>Instructions</dt><dd className="font-mono text-foreground">{hints.glyph.instructions ? `${hints.glyph.instructions} bytes` : 'none'}</dd></>}
            </>}
          </dl>
          <div className="flex flex-wrap gap-1 pt-1">
            <Button size="xs" variant="secondary" disabled={busy || !sel} onClick={() => void hint(false, false)} title="FontForge finds this glyph's stems">Autohint {sel ?? 'glyph'}</Button>
            <Button size="xs" variant="secondary" disabled={busy} onClick={() => void hint(true, false)} title="Every drawn glyph">Autohint all</Button>
            <Button size="xs" variant="ghost" disabled={busy || !sel} onClick={() => void hint(false, true)}>Clear</Button>
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => void hint(true, true)}>Clear all</Button>
          </div>
          <p className="text-[10px] text-muted-foreground">Generate with “keep the font's own hints” writes exactly these. Stems are where they start and how thick they are, in font units.</p>
        </section>
      )}
      <section className="space-y-2 p-3">
        <h3 className="font-medium text-muted-foreground">Add glyphs</h3>
        {blocks.length === 0 && <p className="text-muted-foreground">Loading…</p>}
        <div className="flex flex-wrap gap-1">
          {blocks.length > 0 && PRESETS.map(([label, ids]) => (
            <Button key={label} size="xs" variant="secondary" disabled={busy || missing(ids) === 0} onClick={() => void add(ids, label)}
              title={`Every ${label} character the font lacks`}>{label}{missing(ids) > 0 ? ` (${missing(ids)})` : ' ✓'}</Button>
          ))}
        </div>
        <ul className="space-y-1">
          {blocks.map(b => (
            <li key={b.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate" title={b.name}>{b.name}</span>
              <span className="font-mono text-muted-foreground">{b.have}/{b.total}</span>
              <Button size="xs" variant="ghost" disabled={busy || b.have === b.total} onClick={() => void add([b.id], b.name)}>
                {b.have === b.total ? '✓' : `Add ${b.total - b.have}`}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
