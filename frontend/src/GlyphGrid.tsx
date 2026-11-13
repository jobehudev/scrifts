import { useEffect, useMemo, useRef, useState } from 'react'
import { api, bench, outlines, type FontInfo, type Location } from './api'
import { blendStore, useBlendVersion } from './blendStore'
import type { Family } from './FamilyBar'
import { theme, useCanvas, useOutlineVersion } from './canvas'
import { getClip, setClip, type GlyphData } from './clip'
import type { MasterOps } from './FamilyBar'
import { toast } from 'sonner'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useCommands } from './commands'
import { useSettings } from './settings'
import { rangesFor, useLanguages } from './gridScripts'
import { LanguageBar } from './LanguageBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const LABEL = 14

type Cat = 'all' | 'letters' | 'accented' | 'accents' | 'numbers' | 'punct' | 'symbols' | 'alts'
const CATS: [Cat, string, string][] = [
  ['all', 'All', 'Every glyph'], ['letters', 'Letters', 'Plain letters, A-Z and other alphabets'], ['accented', 'Accented', 'Letters with an accent: É, ñ, Ů'],
  ['accents', 'Accents', 'The accent marks themselves: grave, acute, tilde, combining marks'], ['numbers', 'Numbers', 'Digits and other number characters'],
  ['punct', 'Punctuation', 'Punctuation and quotes'], ['symbols', 'Symbols', 'Currency, maths and other symbols'],
  ['alts', 'Alternates', 'Glyphs made for the Features page: ligatures (f_i), small capitals (a.sc), stylistic sets (g.ss01), figures (one.onum)'],
]
/** A glyph made for a feature: named with a dot or an underscore after its first letter (a.sc, f_i), or without a character of its own. */
const isAlternate = (g: { name: string | null; unicode: number }) =>
  !!g.name && g.name !== '.notdef' && (/.[._]/.test(g.name) || (g.unicode < 0 && !g.name.startsWith('.')))
function catOf(cp: number): Cat | null {
  if (cp < 0) return null
  const c = String.fromCodePoint(cp)
  if (/\p{Sk}|\p{M}/u.test(c)) return 'accents'
  if (/\p{L}/u.test(c)) return c.normalize('NFD').length > c.length ? 'accented' : 'letters'
  if (/\p{N}/u.test(c)) return 'numbers'
  if (/\p{P}/u.test(c)) return 'punct'
  if (/\p{S}/u.test(c)) return 'symbols'
  return null
}

type Mode = 'font' | 'scripts' | 'unicode'
/** A grid cell: a glyph in the font, or an empty Unicode slot (name null). */
type Slot = { name: string | null; unicode: number }

// The Basic Multilingual Plane minus controls and surrogates.
const BMP: [number, number][] = [[0x20, 0x7e], [0xa0, 0xd7ff], [0xe000, 0xfffd]]

const hex = (cp: number) => cp.toString(16).toUpperCase().padStart(4, '0')

/** "a", "U+0061", "0061", "uni0061", or a name fragment. */
function matcher(q: string, nameCp = -1): (g: Slot) => boolean {
  q = q.trim()
  if (!q) return () => true
  const h = /^(?:u\+|uni|0x)?([0-9a-f]{4,6})$/i.exec(q)
  const cp = h ? parseInt(h[1], 16) : [...q].length === 1 ? q.codePointAt(0)! : -1
  const lower = q.toLowerCase()
  // cp -1 means "not a character query"; unencoded glyphs also carry -1
  // nameCp: the code point FontForge gives this name (dotlessi -> U+0131), so empty slots are found by name too
  return g => (cp >= 0 && g.unicode === cp) || (nameCp >= 0 && g.unicode === nameCp) || (g.name ?? '').toLowerCase().includes(lower)
}

function slots(font: FontInfo, mode: Mode, scriptTags: string): Slot[] {
  if (mode === 'font') return font.glyphs
  const byCp = new Map(font.glyphs.filter(g => g.unicode >= 0).map(g => [g.unicode, g.name]))
  const out: Slot[] = []
  for (const [a, b] of mode === 'scripts' ? rangesFor(scriptTags ? scriptTags.split(',') : []) : BMP)
    for (let cp = a; cp <= b; cp++) out.push({ name: byCp.get(cp) ?? null, unicode: cp })
  if (mode === 'unicode') {  // plus whatever the font has outside the BMP or unencoded
    const seen = new Set(out.map(s => s.unicode))
    for (const g of font.glyphs) if (!seen.has(g.unicode) || g.unicode < 0) out.push(g)
  }
  return out
}

/**
 * Virtualized glyph grid: one canvas the size of the viewport inside a
 * scroller whose height is the full grid. Only rows on screen are drawn or
 * fetched, so the full BMP (63k slots) scrolls as smoothly as 100 glyphs.
 */
export function GlyphGrid({ font, sel, loc, family = null, weight = null, axisVals = {}, blendRev = 0, onSelect, onOpen, onCreate, guides, marks, masterOps, onChanged }: {
  font: FontInfo; sel: string | null; loc: Location | null
  /** The family and the weight its slider previews (null = off): the cells then show the blend of the masters at that weight. */
  family?: Family | null; weight?: number | null; axisVals?: Record<string, number>; blendRev?: number
  onSelect: (n: string) => void; onOpen: (n: string) => void; onCreate: (unicode: number) => void
  guides: number[]
  /** Glyphs to flag with a dot (masters that don't match). */
  marks?: Set<string>
  masterOps?: MasterOps
  /** After a paste or a copy between masters changed glyphs. */
  onChanged?: () => void
}) {
  const [ctxName, setCtxName] = useState<string | null>(null)
  const fail = (e: unknown) => toast.error('Failed', { description: (e as Error).message })
  const copyGlyph = (n: string) => api<Record<string, GlyphData>>('/api/glyphs/data', { names: [n] })
    .then(r => setClip({ kind: 'glyph', name: n, data: r[n], quadratic: font.quadratic, em: font.em })).catch(fail)
  const pasteGlyph = async (n: string) => {
    const c = await getClip()
    if (!c) return
    if (c.quadratic !== font.quadratic) { toast.error("Can't paste between a cubic and a quadratic font"); return }
    try {
      // a whole glyph replaces this one; loose shapes replace its outlines and keep its width
      const data = c.kind === 'glyph' ? c.data
        : { ...(await api<Record<string, GlyphData>>('/api/glyphs/data', { names: [n] }))[n], contours: c.contours, closed: c.closed, refs: [], anchors: [] }
      await api('/api/glyphs/set', { glyphs: { [n]: data } })
      onChanged?.()
    } catch (e) { fail(e) }
  }
  // Clear empties the glyph (one undo step in the editor); Rebuild clears it and builds it again from its parts (é = e + acute)
  type Pts = Parameters<typeof outlines.putPoints>[0]
  const landed = (r: Pts) => { outlines.putPoints(r); outlines.invalidateUsers(r.name); onChanged?.() }
  const clearGlyph = (n: string) => api<Pts>('/api/edit', { name: n, kind: 'clear', args: {} })
    .then(r => { landed(r); toast(`Cleared ${n}`, { description: 'Open it and press Ctrl Z to bring it back.' }) }).catch(fail)
  const rebuildGlyph = (n: string) => api<Pts>('/api/edit', { name: n, kind: 'clear', args: {} })
    .then(() => api<Pts>('/api/build', { name: n }))
    .then(r => { landed(r); toast(`Rebuilt ${n} from its components`) })
    .catch(e => { fail(e); onChanged?.() })
  const copyMasters = (source: string, targets: string[], n: string) =>
    masterOps?.copy(source, targets, [n]).then(() => onChanged?.()).catch(fail)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>(() => {
    const m = localStorage.getItem('forge.grid')
    return m === 'latin' ? 'scripts' : m === 'font' || m === 'scripts' || m === 'unicode' ? m : 'font'  // 'latin' is what the Scripts view used to be called
  })
  // the languages whose slots show: the font's list, the same one the Features page uses
  const { active } = useLanguages(font.familyname, font.glyphs)
  const [empty, setEmpty] = useState<number | null>(null)  // selected empty slot
  const [scroll, setScroll] = useState(0)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const scroller = useRef<HTMLDivElement>(null)
  useOutlineVersion()
  useBlendVersion()
  useEffect(() => { blendStore.clear() }, [blendRev, family?.path])
  const blending = !!family && weight !== null && family.masters.length > 1

  // a typed glyph name that the font does not have yet (dotlessi): ask FontForge which character it is
  const [nameCp, setNameCp] = useState(-1)
  useEffect(() => {
    const q = query.trim()
    if (!/^[a-z][a-z0-9._]{2,}$/i.test(q) || /^(uni|u\+)?[0-9a-f]{4,6}$/i.test(q)) { setNameCp(-1); return }
    let stale = false
    const id = setTimeout(() => {
      api<{ unicode: number }>('/api/unicode-of?name=' + encodeURIComponent(q)).then(r => { if (!stale) setNameCp(r.unicode) }).catch(() => {})
    }, 200)
    return () => { stale = true; clearTimeout(id) }
  }, [query])
  const activeKey = active.join()
  const all = useMemo(() => slots(font, mode, activeKey), [font, mode, activeKey])
  const [cat, setCat] = useState<Cat>(() => (localStorage.getItem('forge.gridCat') as Cat) ?? 'all')
  useEffect(() => { localStorage.setItem('forge.gridCat', cat) }, [cat])
  const list = useMemo(() => all.filter(matcher(query, nameCp)).filter(g => cat === 'all' || (cat === 'alts' ? isAlternate(g) : catOf(g.unicode) === cat)), [all, query, nameCp, cat])
  const missingByName = nameCp >= 0 && !font.glyphs.some(g => g.unicode === nameCp) ? nameCp : null
  const filled = useMemo(() => list.reduce((n, s) => n + (s.name ? 1 : 0), 0), [list])
  const minCell = useSettings().gridCell
  const cols = Math.max(1, Math.floor(size.w / minCell))
  const cell = size.w / cols
  const rows = Math.ceil(list.length / cols)
  const selIdx = empty !== null ? list.findIndex(g => !g.name && g.unicode === empty) : list.findIndex(g => g.name === sel)

  useEffect(() => { localStorage.setItem('forge.grid', mode) }, [mode])
  useCommands(c => { if (c.startsWith('grid:')) setMode(c.slice(5) as Mode) })
  useEffect(() => { setEmpty(null) }, [sel])

  useEffect(() => {
    const el = scroller.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pointerPick = useRef(false)

  // keep the selection on screen
  useEffect(() => {
    if (pointerPick.current) { pointerPick.current = false; return }
    const el = scroller.current
    if (!el || selIdx < 0 || !cell) return
    const top = Math.floor(selIdx / cols) * cell
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + cell > el.scrollTop + el.clientHeight) el.scrollTop = top + cell - el.clientHeight
  }, [selIdx, cols, cell])

  const ref = useCanvas((ctx, w, h) => {
    const t = theme()
    const first = Math.floor(scroll / cell), last = Math.min(rows, Math.ceil((scroll + h) / cell) + 1)
    const s = (cell - LABEL - 10) / (font.ascent + font.descent)
    ctx.textAlign = 'center'
    let missing = 0
    for (let r = first; r < last; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const g = list[i]
      if (!g) break
      const x = c * cell, y = r * cell - scroll
      if (i === selIdx) { ctx.fillStyle = t.sel; ctx.fillRect(x, y, cell, cell) }
      ctx.strokeStyle = t.line
      ctx.strokeRect(x + .5, y + .5, cell, cell)
      ctx.font = '10px ' + t.mono
      ctx.fillStyle = i === selIdx ? t.ink : t.dim
      const name = g.name ?? hex(g.unicode)
      ctx.fillText(name.length > 11 ? name.slice(0, 10) + '…' : name, x + cell / 2, y + cell - 4)
      if (g.name && marks?.has(g.name)) {
        ctx.fillStyle = t.bad
        ctx.beginPath(); ctx.arc(x + cell - 7, y + 7, 3, 0, Math.PI * 2); ctx.fill()
      }
      const drawn = g.name ? outlines.want(g.name, loc) : undefined
      if (!g.name || (drawn?.empty && g.unicode >= 0)) {
        // empty slot, or a glyph that exists but has nothing drawn yet: the character in the system font, faint, like FontForge's crossed cells
        ctx.font = `${Math.round(cell * 0.38)}px system-ui`
        // the muted text colour at half strength: clearly "not drawn yet", still readable in every theme
        ctx.fillStyle = t.dim
        ctx.globalAlpha = 0.5
        ctx.fillText(String.fromCodePoint(g.unicode), x + cell / 2, y + cell * 0.58)
        ctx.globalAlpha = 1
        continue
      }
      const o0 = outlines.want(g.name, loc)
      const bl = blending ? blendStore.get({ family: family!.path, weight: weight!, location: axisVals, quadratic: font.quadratic }, g.name) : undefined
      const o = bl ? { path: bl.path, width: bl.width, box: null } : o0  // blended at the slider's weight, else the open master's own drawing
      if (!o) { missing++; continue }
      if (guides.length) {  // font-wide guides in every cell, to see alignment at a glance
        ctx.strokeStyle = t.guide
        ctx.globalAlpha = 0.5
        for (const gy of guides) {
          const yy = Math.round(y + 5 + (font.ascent - gy) * s) + .5
          ctx.beginPath(); ctx.moveTo(x + 2, yy); ctx.lineTo(x + cell - 2, yy); ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
      // far outside the em box (more than a quarter em past any edge): mark the tile, the stray geometry is usually out of view
      const far = font.em / 4
      if (o.box && (o.box[0] < -far || o.box[2] > o.width + far || o.box[1] < -font.descent - far || o.box[3] > font.ascent + far)) {
        ctx.fillStyle = t.bad
        ctx.fillRect(x + 3, y + 3, 6, 6)
      }
      // clipped to the tile so overflow never bleeds into neighbouring tiles
      ctx.save()
      ctx.beginPath(); ctx.rect(x + 1, y + 1, cell - 1, cell - 1); ctx.clip()
      ctx.translate(x + (cell - o.width * s) / 2, y + 5 + font.ascent * s)
      ctx.scale(s, -s)
      ctx.fillStyle = t.ink
      ctx.fill(o.path)
      ctx.restore()
    }
    void w
    // first frame with every visible cell drawn = "time to first paint"
    if (!missing && list.length && bench.start && !bench.firstPaint) bench.firstPaint = performance.now() - bench.start
  })

  const pick = (g: Slot | undefined, fromPointer = false) => {
    if (!g) return
    pointerPick.current = fromPointer
    if (g.name) { setEmpty(null); onSelect(g.name) } else setEmpty(g.unicode)
  }
  const open = (g: Slot | undefined) => {
    if (!g) return
    if (g.name) onOpen(g.name)
    else onCreate(g.unicode)
  }

  const move = (d: number) => pick(list[Math.min(list.length - 1, Math.max(0, (selIdx < 0 ? 0 : selIdx) + d))])

  const onKey = (e: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor(size.h / cell)) * cols
    const k: Record<string, () => void> = {
      ArrowRight: () => move(1), ArrowLeft: () => move(-1),
      ArrowDown: () => move(cols), ArrowUp: () => move(-cols),
      PageDown: () => move(page), PageUp: () => move(-page),
      Home: () => move(-Infinity), End: () => move(Infinity),
      Enter: () => open(list[selIdx]),
    }
    if (k[e.key]) { e.preventDefault(); k[e.key]() }
  }

  const hit = (e: React.MouseEvent) => {
    const b = (e.target as HTMLElement).getBoundingClientRect()
    return list[Math.floor((e.clientY - b.top + scroll) / cell) * cols + Math.floor((e.clientX - b.left) / cell)]
  }

  return (
    <div className="flex h-full flex-col border-r bg-card">
      <div className="flex flex-col gap-2 border-b p-2">
        <div className="flex items-center gap-2">
          <Input placeholder="Search name, character, U+0041" value={query} className="h-7"
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key !== 'ArrowDown' && e.key !== 'Enter') return
              e.preventDefault()
              scroller.current?.focus()
              if (e.key === 'Enter') pick(list[0])
            }} />
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title="glyphs / slots shown">
            {mode === 'font' ? list.length : `${filled}/${list.length}`}
          </span>
        </div>
        <Tabs value={mode} onValueChange={v => setMode(v as Mode)}>
          <TabsList className="h-7 w-full">
            <TabsTrigger value="font" className="text-xs" title="Only glyphs the font has">Font</TabsTrigger>
            <TabsTrigger value="scripts" className="text-xs" title="The slots of the languages you pick (Latin, Han, Arabic, Hebrew ...), empty ones included. Each is an OpenType script: latn, hani, arab, hebr ...">Languages</TabsTrigger>
            <TabsTrigger value="unicode" className="text-xs" title="Every Basic Multilingual Plane slot, empty ones included">Unicode</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'scripts' && <LanguageBar font={font} />}
        <div className="flex flex-wrap gap-1">
          {CATS.map(([k, label, hint]) => (
            <Button key={k} size="xs" variant={cat === k ? 'secondary' : 'ghost'} title={hint} onClick={() => setCat(k)}>{label}</Button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-ring"
        ref={scroller} tabIndex={0} onKeyDown={onKey}
        onScroll={e => setScroll(e.currentTarget.scrollTop)}>
        <div style={{ height: rows * cell }} className="relative">
          <ContextMenu>
          <ContextMenuTrigger asChild>
          <canvas ref={ref} className="sticky top-0 block w-full" style={{ height: size.h }}
            onMouseDown={e => e.button === 0 && pick(hit(e), true)} onDoubleClick={e => open(hit(e))}
            onContextMenu={e => { const g = hit(e); setCtxName(g?.name ?? null); if (g) pick(g, true) }} />
          </ContextMenuTrigger>
          {ctxName && (
            <ContextMenuContent className="w-56">
              <ContextMenuItem onSelect={() => onOpen(ctxName)}>Open {ctxName}</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => copyGlyph(ctxName)}>Copy Glyph</ContextMenuItem>
              <ContextMenuItem onSelect={() => void pasteGlyph(ctxName)}>Paste Into This Glyph</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => void clearGlyph(ctxName)}>Clear Glyph</ContextMenuItem>
              <ContextMenuItem onSelect={() => void rebuildGlyph(ctxName)}>Rebuild from Components</ContextMenuItem>
              <ContextMenuItem onSelect={() => api('/api/glyphs/restore', { names: [ctxName] })
                .then(() => { onChanged?.(); toast(`Restored ${ctxName} to the last saved version`) }).catch(fail)}>Restore to Last Saved</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => { if (window.confirm(`Remove ${ctxName} from the font? Its slot becomes unused again. Edit, Undo Last Font-Wide Change takes it back.`)) api('/api/glyph-delete', { name: ctxName }).then(() => { onChanged?.(); toast(`Removed ${ctxName}`, { description: 'Ctrl Alt Z takes it back.' }) }).catch(fail) }}>Delete Glyph</ContextMenuItem>
              {masterOps && masterOps.others.length > 0 && <>
                <ContextMenuSeparator />
                <ContextMenuSub>
                  <ContextMenuSubTrigger>Replace with Version From</ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    {masterOps.others.map(m => <ContextMenuItem key={m.path} onSelect={() => copyMasters(m.path, [masterOps.current], ctxName)}>{m.label}</ContextMenuItem>)}
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuItem onSelect={() => copyMasters(masterOps.current, masterOps.others.map(m => m.path), ctxName)}>Copy to All Other Masters</ContextMenuItem>
              </>}
            </ContextMenuContent>
          )}
          </ContextMenu>
        </div>
      </div>
      {(empty ?? missingByName) !== null && (() => {
        const cp = (empty ?? missingByName)!
        const from = cp === 0x131 ? 'i' : cp === 0x237 ? 'j' : null
        return (
          <div className="flex items-center gap-2 border-t px-2 py-1.5 text-xs text-muted-foreground">
            <span className="font-mono">U+{hex(cp)} {String.fromCodePoint(cp)}</span>
            <span className="flex-1">{empty === null ? 'not in this font yet' : 'empty'}</span>
            {from && font.glyphs.some(g => g.name === from) && (
              <Button size="xs" onClick={() => api<{ name: string }>('/api/make-dotless', { unicode: cp })
                .then(r => { onChanged?.(); setEmpty(null); onOpen(r.name); toast(`Made ${r.name} from ${from} without its dot`) }).catch(fail)}
                title={`Copy ${from} without its dot (its highest shape), with the same width and anchors`}>Make from {from} without dot</Button>
            )}
            <Button size="xs" variant="secondary" onClick={() => onCreate(cp)}>Create empty glyph</Button>
          </div>
        )
      })()}
    </div>
  )
}
