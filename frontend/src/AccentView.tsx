import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Plus, RefreshCw } from 'lucide-react'
import { api, outlines, type FontInfo, type Reference } from './api'
import { stored } from '@/lib/utils'
import { theme, useCanvas, useOutlineVersion } from './canvas'
import { GlyphView } from './GlyphView'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'

type Item = {
  unicode: number; name: string | null; base: string | null; base_unicode: number
  uses_accent: boolean; offset: [number, number] | null; refs: string[]; has_outline: boolean
  anchor_offset: [number, number] | null  // where the shared anchors put the accent, if both have one
}
type Composites = { accent: string; marks: number[]; items: Item[]; stray?: string[] }

const ACCENT_NAMES = /^(acute|grave|circumflex|tilde|dieresis|macron|breve|dotaccent|ring|cedilla|ogonek|caron|hungarumlaut|commaaccent|hook|horn|dotbelow)/i
const SPACING = new Set([0x5e, 0x60, 0xa8, 0xaf, 0xb4, 0xb8, 0x2c6, 0x2c7, 0x2d8, 0x2d9, 0x2da, 0x2db, 0x2dc, 0x2dd])
const isAccent = (g: { name: string; unicode: number }) =>
  (g.unicode >= 0x300 && g.unicode <= 0x36f) || SPACING.has(g.unicode) || /comb(\.|$)/.test(g.name) || ACCENT_NAMES.test(g.name)
/** The standard accents: the ones the font lacks are listed greyed out and made on click. */
const CATALOG: [number, string][] = [
  [0x60, 'grave'], [0xb4, 'acute'], [0x5e, 'asciicircum'], [0x2c6, 'circumflex'], [0x2dc, 'tilde'], [0xaf, 'macron'], [0x2d8, 'breve'],
  [0x2d9, 'dotaccent'], [0xa8, 'dieresis'], [0x2da, 'ring'], [0x2dd, 'hungarumlaut'], [0x2c7, 'caron'], [0xb8, 'cedilla'], [0x2db, 'ogonek'],
  [0x300, 'gravecomb'], [0x301, 'acutecomb'], [0x302, 'circumflexcomb'], [0x303, 'tildecomb'], [0x304, 'macroncomb'], [0x306, 'brevecomb'],
  [0x307, 'dotaccentcomb'], [0x308, 'dieresiscomb'], [0x30a, 'ringcomb'], [0x30b, 'hungarumlautcomb'], [0x30c, 'caroncomb'], [0x327, 'cedillacomb'], [0x328, 'ogonekcomb'],
]
const ch = (cp: number) => cp >= 0 ? String.fromCodePoint(cp) : ''

/**
 * Accent workspace: edit an accent with a base letter drawn underneath
 * where a composite places it, and build or adjust every composite that
 * uses it. Composites are references, so editing the accent updates all of
 * them; each placement is just that reference's offset.
 */
export function AccentView({ font, sel, onSelect, onEditGlyph, guides, onGuides, reference, onFontChanged }: {
  font: FontInfo; sel: string | null; onSelect: (n: string) => void; onEditGlyph: (n: string) => void
  guides: number[]; onGuides: (ys: number[]) => void; reference: Reference | null
  onFontChanged: () => Promise<void> | void
}) {
  const accents = useMemo(() => font.glyphs.filter(isAccent), [font])
  const [query, setQuery] = useState('')
  // accents you don't use: greyed out in the list (right-click to toggle), remembered
  const [muted, setMuted] = useState<Set<string>>(() => new Set(stored<string[]>('scrifts.accentMuted', [])))
  const toggleMuted = (n: string) => setMuted(m => {
    const next = new Set(m)
    if (!next.delete(n)) next.add(n)
    localStorage.setItem('scrifts.accentMuted', JSON.stringify([...next]))
    return next
  })
  const absent = useMemo(() => {
    const have = new Set(font.glyphs.map(g => g.unicode))
    return CATALOG.filter(([u]) => !have.has(u))
  }, [font])
  const makeAccent = async (unicode: number) => {
    try {
      const g = await api<{ name: string }>('/api/create', { unicode })
      await onFontChanged()
      onSelect(g.name)
    } catch (e) { toast.error('Could not create the accent', { description: (e as Error).message }) }
  }
  // the selected glyph if it is an accent, else the last accent worked on (kept across view switches and restarts), else acute
  const last = localStorage.getItem('scrifts.lastAccent')
  const accent = sel && accents.some(a => a.name === sel) ? sel
    : last && accents.some(a => a.name === last) ? last
    : accents.find(a => a.name === 'acute')?.name ?? accents[0]?.name ?? null
  useEffect(() => { if (accent) localStorage.setItem('scrifts.lastAccent', accent) }, [accent])
  const [data, setData] = useState<Composites | null>(null)
  const [pick, setPick] = useState<number | null>(null)  // index into data.items
  const [off, setOff] = useState<[number, number]>([0, 0])
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState('')
  // a letter + this accent that Unicode has no character for (A + dieresistonos): an unencoded glyph named after both
  const addCustom = async () => {
    const b = font.glyphs.find(g => g.name === custom.trim() || (custom.trim().length > 0 && g.unicode === custom.trim().codePointAt(0) && [...custom.trim()].length === 1))
    if (!b || !accent) { toast.error('No such letter in the font', { description: 'Type a letter like A, or a glyph name.' }); return }
    setBusy(true)
    try {
      const name = b.name + accent
      await api('/api/compose', { unicode: -1, base: b.name, accent, name })
      await after()
      await onFontChanged()
      setCustom('')
      toast.success(`Made ${name}`, { description: 'Placed by the anchors. It is its own glyph: find it in the Glyphs panel.' })
    } catch (e) { toast.error('Could not make it', { description: (e as Error).message }) } finally { setBusy(false) }
  }
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem('scrifts.accentWidth'))
    return Number.isFinite(saved) && saved >= 120 ? saved : 180
  })
  const outlineVersion = useOutlineVersion()

  const load = useCallback(async () => {
    if (!accent) return
    const d = await api<Composites>(`/api/composites/${encodeURIComponent(accent)}`)
    setData(d)
    return d
  }, [accent])

  useEffect(() => {
    setPick(null)
    load().then(d => {
      if (!d) return
      // default guide: the dotless i composite if there is one, else the first existing one
      const i = d.items.findIndex(x => x.uses_accent && x.base === 'dotlessi')
      const j = i >= 0 ? i : d.items.findIndex(x => x.uses_accent)
      // nothing built yet: still show the accent on a letter, where the anchors put it
      const k = j >= 0 ? j : d.items.findIndex(x => x.base)
      if (k >= 0) choose(k, d)
    }).catch(() => {})
  }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  // an edit anywhere (an anchor moved on a letter in the Glyph view, say) can move accents: read the placements again
  const pickRef = useRef(pick)
  pickRef.current = pick
  // at most every 80 ms, also while something is being dragged elsewhere (a throttle, not a debounce)
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (reloadTimer.current) return
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null
      void load().then(d => { if (d && pickRef.current !== null) choose(pickRef.current, d) }).catch(() => {})
    }, 80)
  }, [outlineVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (i: number, d = data) => {
    setPick(i)
    const it = d?.items[i]
    // a letter that is not built from the accent yet shows where the anchors would put it
    setOff(it?.offset ?? it?.anchor_offset ?? [0, 0])
  }

  const item = data && pick !== null ? data.items[pick] : null
  const underlay = item?.base ? { name: item.base, dx: off[0], dy: off[1] } : null

  const after = async () => {
    await load()
    await onFontChanged()
  }

  const apply = async (o: [number, number] = off) => {
    if (!item || !accent) return
    const off = o
    setBusy(true)
    try {
      if (item.uses_accent && item.name) {
        const r = await api<{ name: string } & Parameters<typeof outlines.put>[0]>('/api/place', { name: item.name, ref: accent, dx: off[0], dy: off[1] })
        outlines.put(r, null)
        await load()
      } else if (item.base) {
        await api('/api/compose', { unicode: item.unicode, base: item.base, accent, dx: off[0], dy: off[1] })
        await after()
      }
    } catch (e) { toast.error('Placement failed', { description: (e as Error).message }) } finally { setBusy(false) }
  }

  // One action: every letter of this accent, existing or missing, built as base + accent (linked by anchors where both have one)
  const buildable = data?.items.filter(i => i.base && i.unicode >= 0) ?? []
  const buildAll = async () => {
    if (!accent || !buildable.length) return
    setBusy(true)
    try {
      await api('/api/snapshots', { path: font.path, label: `Before building the ${accent} letters` }).then(() => window.dispatchEvent(new Event('forge-snapshots'))).catch(() => {})
      const failed: string[] = []
      let linked = 0
      for (const i of buildable) {
        const r = await api<{ placed_by: string }>('/api/compose', { unicode: i.unicode, base: i.base, accent }).catch((e: Error) => { failed.push(`${ch(i.unicode)} (${e.message})`); return null })
        if (r?.placed_by.startsWith('anchor')) linked++
      }
      const made = buildable.length - failed.length
      toast.success(`Built ${made} letters with ${accent}`, {
        description: [
          linked === made ? 'All linked by anchors.' : `${linked} linked by anchors; ${made - linked} centred because the letter has no top anchor (or the accent no _top).`,
          failed.length ? `Not built: ${failed.slice(0, 4).join(', ')}${failed.length > 4 ? '…' : ''}` : '',
        ].filter(Boolean).join(' '),
      })
      await after()
    } catch (e) { toast.error('Build failed', { description: (e as Error).message }) } finally { setBusy(false) }
  }

  const missing = data?.items.filter(i => !i.name && i.base).length ?? 0
  const list = accents.filter(a => !query || a.name.toLowerCase().includes(query.toLowerCase()) || ch(a.unicode) === query)

  return (
    <div
      className="grid h-full grid-rows-[minmax(0,1fr)_auto]"
      style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
    >
      <div className="relative row-span-2 flex min-h-0 flex-col border-r">
        <div className="border-b p-2">
          <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find accent" className="h-7" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1 text-xs">
          {list.map(a => (
            <ContextMenu key={a.name}>
              <ContextMenuTrigger asChild>
                <button type="button" onClick={() => onSelect(a.name)}
                  className={`flex w-full items-center gap-2 px-2 py-1 text-left ${a.name === accent ? 'bg-accent' : 'hover:bg-accent/50'} ${muted.has(a.name) ? 'opacity-40' : ''}`}>
                  <span className="w-5 text-center text-base leading-none">{a.unicode >= 0x300 && a.unicode <= 0x36f ? '◌' + ch(a.unicode) : ch(a.unicode)}</span>
                  <span className="truncate font-mono">{a.name}</span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => toggleMuted(a.name)}>{muted.has(a.name) ? 'Stop greying out' : 'Grey out (not used)'}</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {absent.filter(([u, n]) => !query || n.includes(query.toLowerCase()) || ch(u) === query).map(([u, n]) => (
            <button type="button" key={n} onClick={() => void makeAccent(u)} title="Not in the font yet: click to add it"
              className="flex w-full items-center gap-2 px-2 py-1 text-left opacity-40 hover:bg-accent/50 hover:opacity-70">
              <span className="w-5 text-center text-base leading-none">{u >= 0x300 && u <= 0x36f ? '◌' + ch(u) : ch(u)}</span>
              <span className="truncate font-mono">{n}</span>
            </button>
          ))}
          {!list.length && !absent.length && <div className="px-2 py-1 text-muted-foreground">No accent glyphs</div>}
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize accents list"
          tabIndex={0}
          title="Drag left or right to resize (double-click to reset)"
          onMouseDown={e => {
            if (e.button !== 0) return
            e.preventDefault()
            const sx = e.clientX, startW = sidebarWidth
            let cur = startW
            const prevCursor = document.body.style.cursor
            const prevSelect = document.body.style.userSelect
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
            const onMove = (ev: MouseEvent) => {
              cur = Math.round(Math.min(420, Math.max(120, startW + (ev.clientX - sx))))
              setSidebarWidth(cur)
            }
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
              document.body.style.cursor = prevCursor
              document.body.style.userSelect = prevSelect
              localStorage.setItem('scrifts.accentWidth', String(cur))
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
          onDoubleClick={() => { setSidebarWidth(180); localStorage.setItem('scrifts.accentWidth', '180') }}
          onKeyDown={e => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            const step = e.shiftKey ? 40 : 16
            const next = Math.min(420, Math.max(120, sidebarWidth + (e.key === 'ArrowRight' ? step : -step)))
            setSidebarWidth(next)
            localStorage.setItem('scrifts.accentWidth', String(next))
          }}
          className="group absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize outline-none"
        >
          <div className="mx-auto h-full w-0.5 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary group-active:bg-primary" />
        </div>
      </div>

      <div className="min-h-0">
        {accent
          ? <GlyphView font={font} name={accent} loc={null} guides={guides} onGuides={onGuides} reference={reference}
              underlay={underlay} onEdited={() => { void load().then(d => { if (d && pick !== null) choose(pick, d) }) }}
              onMoveWhole={item?.base ? (dx, dy) => { const o: [number, number] = [off[0] + dx, off[1] + dy]; setOff(o); void apply(o) } : undefined} />
          : <div className="grid h-full place-items-center text-muted-foreground">This font has no accent glyphs</div>}
      </div>

      <div className="flex min-w-0 flex-col border-t">
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs">
          <span className="font-medium">Composites using {accent}</span>
          <span className="text-muted-foreground">{data ? `${data.items.length} characters · ${missing} missing` : '…'}</span>
          <span className="flex-1" />
          {item && <>
            <span className="text-muted-foreground">{ch(item.unicode)} {item.name ?? '(new)'} · offset</span>
            <Input type="number" value={off[0]} onChange={e => setOff([+e.target.value, off[1]])} className="h-7 w-20 font-mono text-xs" aria-label="Horizontal offset" />
            <Input type="number" value={off[1]} onChange={e => setOff([off[0], +e.target.value])} className="h-7 w-20 font-mono text-xs" aria-label="Vertical offset" />
            <Button size="xs" onClick={() => void apply()} disabled={busy || !item.base}>
              {item.uses_accent ? 'Apply placement' : item.name ? `Rebuild with ${accent}` : 'Create'}
            </Button>
          </>}
          {item?.base && (
            <Button size="xs" variant="ghost" title={`Open ${item.base} in the Glyph view, e.g. to move its anchors`} onClick={() => onEditGlyph(item.base!)}>Edit {item.base}</Button>
          )}
          {item?.anchor_offset && (
            <Button size="xs" variant="ghost" title="Use the offset the anchors give" onClick={() => setOff(item.anchor_offset!)}>Anchors</Button>
          )}
          {(['i', 'j'] as const).filter(b => data?.items.some(x => x.base === b)).map(b => (
            <Button key={b} size="xs" variant="outline" disabled={busy}
              title={`Accented ${b}'s should sit on ${b} without its dot. This copies ${b} without its highest shape (the dot), keeping width and anchors; the accented letters then use it.`}
              onClick={() => { setBusy(true); void api('/api/make-dotless', { unicode: b === 'i' ? 0x131 : 0x237 }).then(after)
                .then(() => toast.success(`Made dotless ${b === 'i' ? 'ı' : 'ȷ'} from ${b}`, { description: 'Accented letters on it are built when you click Build all letters.' }))
                .catch(e => toast.error('Could not make it', { description: (e as Error).message })).finally(() => setBusy(false)) }}>
              Make dotless {b === 'i' ? 'ı' : 'ȷ'} from {b}
            </Button>
          ))}
          <Input value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addCustom() }}
            placeholder="Letter" className="h-6 w-16 text-xs" title={`Put ${accent ?? 'this accent'} on a letter Unicode has no character for, e.g. A: makes a glyph called A${accent ?? ''}`} />
          <Button size="xs" variant="outline" disabled={busy || !custom.trim()} onClick={() => void addCustom()}>Add on letter</Button>
          <Button size="xs" onClick={() => void buildAll()} disabled={busy || !buildable.length}
            title="Make every letter with this accent from its base letter plus this accent (existing ones are replaced). Where the letter has top and the accent _top, they are linked: move either anchor later and the letters follow. A snapshot is made first.">
            <Plus />Build all {buildable.length} letters
          </Button>
          {!!data?.stray?.length && (
            <Button size="xs" variant="destructive" disabled={busy}
              title={`${data.stray.join(', ')} carry an accent they should not (from an old bug). This rebuilds them from their Unicode parts. A snapshot is made first.`}
              onClick={() => { setBusy(true); void api('/api/repair-stray', {}).then(after)
                .then(() => toast.success('Rebuilt the letters with a wrong accent'))
                .catch(e => toast.error('Repair failed', { description: (e as Error).message })).finally(() => setBusy(false)) }}>
              Repair {data.stray.length} wrong letters
            </Button>
          )}
          <Button size="icon-xs" variant="ghost" aria-label="Reload" onClick={() => load()}><RefreshCw /></Button>
        </div>
        <Strip font={font} items={data?.items ?? []} pick={pick} accent={accent} off={off}
          onPick={i => choose(i)} onDrag={(dx, dy) => setOff([dx, dy])} onDrop={() => void apply()} />
      </div>
    </div>
  )
}

/**
 * One row of composite previews. The picked one shows the live offset and
 * can be dragged to place the accent; release applies it.
 */
function Strip({ font, items, pick, accent, off, onPick, onDrag, onDrop }: {
  font: FontInfo; items: Item[]; pick: number | null; accent: string | null; off: [number, number]
  onPick: (i: number) => void; onDrag: (dx: number, dy: number) => void; onDrop: () => void
}) {
  const CELL = 128
  const drag = useRef<{ x: number; y: number; off: [number, number] } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState(0)
  const s = (CELL - 22) / (font.ascent + font.descent)
  useOutlineVersion()

  const ref = useCanvas((ctx, w) => {
    const t = theme()
    const first = Math.floor(scroll / CELL), last = Math.min(items.length, Math.ceil((scroll + w) / CELL) + 1)
    ctx.font = '10px ' + t.mono
    ctx.textAlign = 'center'
    for (let i = first; i < last; i++) {
      const it = items[i], x = i * CELL - scroll
      if (i === pick) { ctx.fillStyle = t.sel; ctx.fillRect(x, 0, CELL, CELL + 16) }
      ctx.strokeStyle = t.line
      ctx.strokeRect(x + .5, .5, CELL, CELL + 16)
      const base = it.base ? outlines.want(it.base, null) : undefined
      const acc = accent ? outlines.want(accent, null) : undefined
      const own = it.name ? outlines.want(it.name, null) : undefined
      const width = own?.width ?? base?.width ?? font.em / 2
      const gx = x + (CELL - width * s) / 2, gy = 6 + font.ascent * s
      ctx.save(); ctx.translate(gx, gy); ctx.scale(s, -s)
      if (i === pick && it.base && base && acc) {
        // live: base plus accent at the offset being edited
        ctx.fillStyle = t.ink; ctx.fill(base.path)
        ctx.translate(off[0], off[1]); ctx.fillStyle = t.start; ctx.fill(acc.path)
      } else if (own && (it.uses_accent || it.has_outline || it.refs.length)) {
        ctx.fillStyle = it.uses_accent ? t.ink : t.dim; ctx.fill(own.path)
      } else if (base) {
        // missing, or there but empty: a faint preview of what Build would make (accent on the anchors, if any)
        ctx.fillStyle = t.dim; ctx.fill(base.path)
        if (acc && it.anchor_offset) { ctx.translate(it.anchor_offset[0], it.anchor_offset[1]); ctx.fill(acc.path) }
      }
      ctx.restore()
      ctx.fillStyle = !it.name ? t.dim : it.uses_accent ? t.ink : t.reference
      const label = it.name ?? (it.base ? `+ ${ch(it.unicode)}` : `no ${ch(it.base_unicode)}`)
      ctx.fillText(label.length > 13 ? label.slice(0, 12) + '…' : label, x + CELL / 2, CELL + 11)
    }
  })

  const hit = (e: React.MouseEvent) => Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left + scroll) / CELL)

  return (
    <div ref={scroller} className="h-[152px] overflow-x-auto overflow-y-hidden" onScroll={e => setScroll(e.currentTarget.scrollLeft)}>
      <div style={{ width: items.length * CELL, height: CELL + 17 }} className="relative">
        <canvas ref={ref} className="sticky left-0 block h-full" style={{ width: scroller.current?.clientWidth ?? 600 }}
          onMouseDown={e => {
            const i = hit(e)
            if (i !== pick) { if (items[i]) onPick(i); return }
            drag.current = { x: e.clientX, y: e.clientY, off }
          }}
          onMouseMove={e => {
            const d = drag.current
            // Fixed units per pixel, not the preview's scale: at strip size one
            // pixel is ~28 units, far too coarse to place an accent by hand.
            const k = e.shiftKey ? 10 : 2
            if (d) onDrag(Math.round(d.off[0] + (e.clientX - d.x) * k), Math.round(d.off[1] - (e.clientY - d.y) * k))
          }}
          onMouseUp={() => { if (drag.current) { drag.current = null; onDrop() } }}
          onMouseLeave={() => { if (drag.current) { drag.current = null; onDrop() } }}
          title="Click to use as the guide; drag the picked one to move its accent (2 units per pixel, Shift: 10)" />
      </div>
    </div>
  )
}
