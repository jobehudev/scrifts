import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clean, stepOf, useScrub } from './numeric'
import { latestOnly } from './latestOnly'
import { Check, ChevronDown, Undo2 } from 'lucide-react'
import { Popover } from 'radix-ui'
import { toast } from 'sonner'
import { api, contourPath, outlines, type FontInfo, type Location, type RawOutline, type Reference } from './api'
import { samePath, type BlendGlyph, type Family } from './FamilyBar'
import { LABELS_MIN_SIZE, PRESETS, WATERFALL, contrast, grade, readSwatches, strikeoutBand, underlineBand, withAlpha, type Band, type Pair } from './proof'
import { theme, useCanvas, useOutlineVersion } from './canvas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { getSettings } from './settings'
import { featureTags, ON_BY_DEFAULT } from './features'
import { CHUNK, dirOf, isComplex, isRtl, literalChunks, type Dir } from './shapedText'
import { SCRIPTS } from './scripts'
import { Switch } from '@/components/ui/switch'
import { ColorPicker } from './ColorPicker'
import { KernGroupsPanel } from './KernGroupsPanel'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'

type Metrics = { lsb: number; rsb: number }
type KernSource = { kind: 'pair' | 'class'; subtable: string; lookup: string; value: number; left_class?: string[]; right_class?: string[] }
type Kern = { left: string; right: string; value: number; sources: KernSource[] }
type UndoStep = { kind: 'metrics'; name: string; m: Metrics } | { kind: 'batch'; items: { name: string; m: Metrics }[] } | { kind: 'key'; name: string; side: 'lsb' | 'rsb'; key: string; num: number } | { kind: 'kern'; l: string; r: string; value: number; mode: 'auto' | 'pair'; existed: boolean }
  | { kind: 'autokern'; subtable: string; pairs: { left: string; right: string; value: number | null }[] }
const pk = (l: string, r: string) => `${l}|${r}`
type Box = { i: number; x: number; y: number; w: number; h: number; s: number }  // s: px per font unit of its row

/** A toolbar button that opens a small panel; highlighted while something inside it is on. */
function Pop({ label, active, width, children, strong }: { label: string; active: boolean; width: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="xs" variant={strong ? 'outline' : active ? 'secondary' : 'ghost'} className={strong ? 'border-primary/60 text-foreground' : undefined}>{label}<ChevronDown /></Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={`z-50 ${width} space-y-1 rounded-lg border bg-popover p-2 text-xs text-popover-foreground shadow-md`}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function ToggleRow({ on, label, hint, onClick, disabled }: { on: boolean; label: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="sm" variant="ghost" className="h-auto w-full justify-start gap-2 py-1" disabled={disabled} aria-pressed={on} onClick={onClick}>
      <span className={`grid size-3.5 shrink-0 place-items-center rounded-sm border ${on ? 'border-primary bg-primary text-primary-foreground' : ''}`}>{on && <Check className="size-3" />}</span>
      <span className="flex flex-col items-start text-left"><span>{label}</span><span className="text-[10px] font-normal text-muted-foreground">{hint}</span></span>
    </Button>
  )
}

const READABLE = { Fail: 'hard to read', 'AA large': 'fine for large text', AA: 'good', AAA: 'great' } as const

/** How well the letters stand out from the background in the colours chosen under Colours (a small sample shows them). */
function Contrast({ ratio, fg, bg }: { ratio: number; fg: string; bg: string }) {
  const g = grade(ratio)
  return (
    <span className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 ${g === 'Fail' ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-foreground'}`}
      title={`Contrast between the text colour and the background colour you picked under Colours, from 1:1 (identical) to 21:1. It is only about these colours, not your font. WCAG levels: 3:1 for large text, 4.5:1 (AA) for normal text, 7:1 (AAA) for the strictest. Now: ${g}.`}>
      <span className="rounded-sm px-1 font-semibold" style={{ color: fg, background: bg }}>Aa</span>
      <span>Colour contrast <span className="font-mono">{ratio.toFixed(2)}:1</span> · {READABLE[g]}</span>
    </span>
  )
}

/**
 * A sidebearing: a number, or a metrics key (=H, =|n, =H+10) that follows another
 * glyph. Enter or leaving the field applies it; emptying a keyed field frees it.
 */
function BearingField({ label, num, keyText, disabled, onNumber, onKey }: {
  label: string; num: number; keyText?: string; disabled: boolean
  onNumber: (n: number) => void; onKey: (k: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const scrub = useScrub(num, onNumber, { disabled: disabled || !!keyText, onClick: () => input.current?.focus() })  // a followed side (=H) is changed by its key, not by dragging
  const shown = scrub.preview !== null ? String(scrub.preview) : draft ?? keyText ?? String(num)
  const commit = () => {
    if (draft === null) return
    const t = draft.trim()
    setDraft(null)
    if (t === (keyText ?? String(num))) return
    if (t.startsWith('=')) onKey(t)
    else if (t === '' && keyText) onKey('')
    else if (t !== '' && !isNaN(+t)) onNumber(+t)
  }
  return (
    <div className="flex items-center gap-1" title="A number, or a key that follows another glyph: =H (same side), =|n (opposite side), =H+10. Arrow keys nudge it; drag the letter to change it.">
      <span onPointerDown={scrub.bind.onPointerDown} onPointerMove={scrub.bind.onPointerMove} onPointerUp={scrub.bind.onPointerUp} className={scrub.bind.className}>{label}</span>
      <Input ref={input} className={`h-6 w-24 font-mono ${keyText ? 'text-(--reference)' : ''}`} value={shown} disabled={disabled} spellCheck={false}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
          else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !keyText) {
            e.preventDefault()
            const typed = draft !== null && draft.trim() !== '' && !isNaN(+draft) ? +draft : num
            setDraft(null)
            onNumber(clean(typed + (e.key === 'ArrowUp' ? 1 : -1) * stepOf(e)))
          }
        }} />
      {keyText && <span className="font-mono">{Math.round(num)}</span>}
    </div>
  )
}

/** Positioning features: this view shows and edits kerning itself, so the shaper is told to leave these out. */
const POSITIONING = new Set(['kern', 'mark', 'mkmk', 'dist', 'curs', 'abvm', 'blwm'])

/** Characters, plus Glyphs-style "/glyphname" (ends at space or the next slash).
 *  `shaped`: what the font's features make of a plain stretch of text (ligatures, small capitals ...), when that is switched on. */
function parse(text: string, font: FontInfo, variants?: Map<number, string[]>, shaped?: Map<string, string[]>, shapeAll = false): { run: string[]; breaks: Set<number> } {
  const byCp = new Map(font.glyphs.filter(g => g.unicode >= 0).map(g => [g.unicode, g.name]))
  const names = new Set(font.glyphs.map(g => g.name))
  const out: string[] = [], breaks = new Set<number>()  // breaks: indices of glyphs that start a new paragraph line
  let lit = '', litDir: Dir | null = null  // the plain characters since the last glyph name, line break or change of direction
  const flush = () => {
    // what the shaper made of it: always for scripts that cannot be set one glyph per character (Arabic, Hebrew, Indic ...), with Features on for the rest
    const swapped = lit && (shapeAll || [...lit].some(isComplex)) ? shaped?.get(lit) : undefined
    if (swapped) out.push(...swapped)
    else {
      const chars = [...lit]
      if (chars.some(isRtl)) chars.reverse()  // right to left: the last letter sits leftmost
      for (const ch of chars) {
        const cp = ch.codePointAt(0)!, n = byCp.get(cp)
        if (n) { out.push(n); if (variants) out.push(...(variants.get(cp) ?? [])) }
      }
    }
    lit = ''; litDir = null
  }
  for (let i = 0; i < text.length;) {
    if (text[i] === '\n') { flush(); if (out.length) breaks.add(out.length); i++; continue }
    if (text[i] === '/') {
      const m = /^\/([^\s/]+) ?/.exec(text.slice(i))
      if (m && names.has(m[1])) { flush(); out.push(m[1]); i += m[0].length; continue }
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    const d = dirOf(ch)
    if (d !== 'neutral') { if (litDir && d !== litDir) flush(); litDir = d }
    lit += ch
    i += ch.length
    if (lit.length >= CHUNK) {  // long text, cut where literalChunks cuts it
      const cut = lit.lastIndexOf(' ')
      if (cut > 0) { const tail = lit.slice(cut + 1), keep: Dir | null = litDir; lit = lit.slice(0, cut + 1); flush(); lit = tail; litDir = keep } else flush()
    }
  }
  flush()
  return { run: out, breaks }
}

/** Base letter -> the glyph names of its accented forms in this font (À Á Â for A), found by Unicode decomposition. */
function variantMap(font: FontInfo): Map<number, string[]> {
  const m = new Map<number, string[]>()
  for (const g of [...font.glyphs].filter(g => g.unicode >= 0).sort((a, b) => a.unicode - b.unicode)) {
    const d = String.fromCodePoint(g.unicode).normalize('NFD')
    if (d.length < 2) continue
    const base = d.codePointAt(0)!
    if (base !== g.unicode) m.set(base, [...(m.get(base) ?? []), g.name])
  }
  return m
}

/**
 * Spacing view: a run of glyphs, sidebearings under each, editable inline.
 * Edits show immediately (optimistic shift of the cached outline), go to
 * FontForge, and are replaced by the core's real result when it answers.
 */
export function SpacingView({ font, loc, sel, onSelect, guides, reference, family = null, weight = null, location = {}, blendRev = 0, onStopPreview }: {
  font: FontInfo; loc: Location | null; sel: string | null; onSelect: (n: string) => void
  guides: number[]; reference: Reference | null
  /** With a family and the master bar's weight, the text is shown blended at that weight (read-only). */
  family?: Family | null; weight?: number | null; location?: Record<string, number>; blendRev?: number
  /** turns the master bar's weight preview off */
  onStopPreview?: () => void
}) {
  const [text, setText] = useState(() => localStorage.getItem('forge.spacing.' + font.familyname) ?? localStorage.getItem('forge.spacing') ?? 'HHOHOO nnonoo Hamburgefontsiv /a/b/c')
  const [size, setSize] = useState(140)
  // proofing: colours, sizes, paragraph, lines. All local to this view, remembered between sessions.
  const stored = <T,>(key: string, init: T) => { try { const v = localStorage.getItem('forge.proof.' + key); return v === null ? init : JSON.parse(v) as T } catch { return init } }
  const keep = (key: string, v: unknown) => localStorage.setItem('forge.proof.' + key, JSON.stringify(v))
  const [colors, setColors] = useState<Pair | null>(() => stored<Pair | null>('colors', null))
  const [badge, setBadge] = useState(() => stored('badge', true))
  const [texts, setTexts] = useState<string[]>(() => stored<string[]>('texts', []))
  const saveTexts = (v: string[]) => { keep('texts', v); setTexts(v) }
  const [swatches, setSwatches] = useState<Pair[]>(() => readSwatches(localStorage.getItem('forge.proof.swatches')))
  const [waterfall, setWaterfall] = useState(() => stored('waterfall', false))
  const [para, setPara] = useState(() => stored('para', false))
  const [lineHeight, setLineHeight] = useState(() => stored('lh', 1.3))
  const [underline, setUnderline] = useState(() => stored('underline', false))
  const [strike, setStrike] = useState(() => stored('strike', false))
  const [skipInk, setSkipInk] = useState(() => stored('skip', true))
  const [lineBands, setLineBands] = useState<{ ul: Band; st: Band } | null>(null)
  const blendCache = useRef(new Map<string, Map<string, { path: Path2D; width: number } | null>>())
  // the newest blended shape of each glyph at any weight: drawn until the one for the current weight arrives, so the text keeps moving while the weight is swept
  const lastBlend = useRef(new Map<string, { path: Path2D; width: number }>())
  const [, setBlendTick] = useState(0)
  // the slider sitting exactly on the master that is open is not a preview: that master is what is on screen, and it can be edited
  const openMaster = family?.masters.find(m => samePath(m.path, font.path))
  const atOpenMaster = !!family && weight !== null && !!openMaster && openMaster.weight === weight
    && family.axes.slice(1).every(a => (location[a.name] ?? a.default) === (openMaster.location[a.name] ?? a.default))
  const blending = !!family && weight !== null && family.masters.length >= 2 && !atOpenMaster
  const posKey = `${weight}|${JSON.stringify(location)}`  // where on the axes the blend is taken
  const [cursor, setCursor] = useState(0)
  const [, force] = useState(0)
  const [keys, setKeys] = useState<Record<string, { lsb?: string; rsb?: string }>>({})
  const [keyRev, setKeyRev] = useState(0)
  const pending = useRef(new Map<string, Metrics>())  // target metrics not yet confirmed
  const inflight = useRef(new Set<string>())
  const undo = useRef<UndoStep[]>([])
  const [kernOn, setKernOn] = useState(() => localStorage.getItem('forge.kern') !== '0')
  const [kerns, setKerns] = useState<Map<string, Kern>>(new Map())
  const kernPending = useRef(new Map<string, { value: number | null; mode: 'auto' | 'pair' }>())
  const kernInflight = useRef(new Set<string>())
  const [kernMode, setKernMode] = useState<'auto' | 'pair'>('auto')
  const [groupsOpen, setGroupsOpen] = useState(() => localStorage.getItem('forge.groups') === '1')
  const [kernRev, setKernRev] = useState(0)  // bump after group changes: every pair may have moved
  const kernDrag = useRef<{ l: string; r: string; px: number; v0: number; recorded: boolean; s: number } | null>(null)
  const boxes = useRef<Box[]>([])
  const canvasWrap = useRef<HTMLDivElement>(null)
  useOutlineVersion(reference?.store)
  const [showRef, setShowRef] = useState(true)
  const [shadows, setShadows] = useState(() => localStorage.getItem('forge.shadows') === '1')
  const [edgeHover, setEdgeHover] = useState<{ i: number; side: 'L' | 'R' } | null>(null)  // the edge a click would grab, highlighted
  const edgeDrag = useRef<{ name: string; side: 'L' | 'R'; px: number; m: Metrics; s: number } | null>(null)
  /** Base letter of an accented one (É -> E), for shadow comparison. */
  const baseOf = useMemo(() => {
    const byCp = new Map(font.glyphs.filter(g => g.unicode >= 0).map(g => [g.unicode, g.name]))
    return (name: string) => {
      const cp = font.glyphs.find(g => g.name === name)?.unicode ?? -1
      if (cp < 0) return null
      const b = String.fromCodePoint(cp).normalize('NFD').codePointAt(0)!
      return b !== cp ? byCp.get(b) ?? null : null
    }
  }, [font])
  const refByCp = useMemo(() => new Map((reference?.info.glyphs ?? []).filter(g => g.unicode >= 0).map(g => [g.unicode, g.name])), [reference])
  const cpOf = useMemo(() => new Map(font.glyphs.map(g => [g.name, g.unicode])), [font])

  const [variantsOn, setVariantsOn] = useState(() => localStorage.getItem('forge.variants') === '1')
  const variantsOf = useMemo(() => variantMap(font), [font])
  // lit up only when the text has a letter that has accented forms in this font
  const hasVariants = useMemo(() => [...text].some(c => variantsOf.has(c.codePointAt(0)!)), [text, variantsOf])
  // Features: show the text the way the font sets it (ligatures join, small capitals swap in) by asking the shaper the Features page
  // uses. Only substitutions: kerning and spacing stay as this view shows and edits them.
  const [featOn, setFeatOn] = useState(() => stored('features', false))
  const [featChoice, setFeatChoice] = useState<Record<string, boolean>>(() => stored('featChoice', {}))  // tag -> on/off; absent = the usual default
  const [featTags, setFeatTags] = useState<string[]>([])
  const [shaped, setShaped] = useState<Map<string, string[]>>(() => new Map())
  const glyphNames = useMemo(() => new Set(font.glyphs.map(g => g.name)), [font])
  const chunks = useMemo(() => [...new Set(literalChunks(text, glyphNames, !featOn))], [featOn, text, glyphNames])  // with Features off: only what cannot be set without the shaper
  // glyphs made for features, or with no character of their own: placed in the text by name
  const altGlyphs = useMemo(() => font.glyphs.map(g => g.name).filter(n => n !== '.notdef' && !n.startsWith('.') && /.[._]/.test(n)).slice(0, 200), [font])
  // The Features page sends an example: its text, with Features on and the swaps of that row switched on
  useEffect(() => {
    const f = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; on: string[] }>).detail
      setText(d.text)
      keep('features', true); setFeatOn(true)
      setFeatChoice(c => { const next = { ...c, ...Object.fromEntries(d.on.map(t => [t, true])) }; keep('featChoice', next); return next })
    }
    window.addEventListener('forge:spacing-example', f)
    return () => window.removeEventListener('forge:spacing-example', f)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const featOnFor = (t: string) => featChoice[t] ?? ON_BY_DEFAULT.has(t)
  const featKey = featTags.map(t => t + (featOnFor(t) ? 1 : 0)).join()
  useEffect(() => {
    if (!featOn) return
    let stale = false
    api<{ code: string; gpos_features: string[] }>('/api/features')
      .then(d => { if (!stale) setFeatTags(featureTags(d.code, d.gpos_features).filter(t => !POSITIONING.has(t))) }).catch(() => {})
    return () => { stale = true }
  }, [featOn, font])
  useEffect(() => {
    if (!chunks.length) return
    let stale = false
    const feats: Record<string, boolean> = { ...Object.fromEntries(featTags.map(t => [t, featOnFor(t)])), kern: false, mark: false, mkmk: false, dist: false, curs: false }
    const id = setTimeout(async () => {
      const next = new Map<string, string[]>()
      for (const c of chunks) {
        try { next.set(c, (await api<{ name: string }[]>('/api/shape', { text: c, features: feats })).map(g => g.name).filter(n => n !== '.notdef')) } catch { /* shown as typed */ }
      }
      if (!stale) setShaped(next)
    }, 250)
    return () => { stale = true; clearTimeout(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunks, featKey, font])
  const { run, breaks } = useMemo(() => parse(text, font, variantsOn && hasVariants ? variantsOf : undefined, shaped, featOn), [text, font, variantsOn, hasVariants, variantsOf, featOn, shaped])
  const editable = !loc && !blending
  const current = run[cursor]

  useEffect(() => { localStorage.setItem('forge.spacing.' + font.familyname, text); localStorage.setItem('forge.spacing', text) }, [text, font.familyname])
  useEffect(() => { api<typeof keys>('/api/metrics-keys').then(setKeys).catch(() => {}) }, [font, keyRev])
  // underline and strikeout come from the font itself
  useEffect(() => {
    if (!underline && !strike) return
    api<{ fields: Record<string, number> }>('/api/font-info').then(i => setLineBands({
      ul: underlineBand(i.fields.upos, i.fields.uwidth), st: strikeoutBand(i.fields.os2_strikeypos, i.fields.os2_strikeysize),
    })).catch(() => {})
  }, [underline, strike, font])

  // effective kerning for every adjacent pair in the text, from FontForge
  const pairs = useMemo(() => {
    const seen = new Set<string>(), out: [string, string][] = []
    for (let i = 1; i < run.length; i++) {
      const k = pk(run[i - 1], run[i])
      if (!seen.has(k)) { seen.add(k); out.push([run[i - 1], run[i]]) }
    }
    return out
  }, [run])
  const pairsRef = useRef(pairs)
  pairsRef.current = pairs
  const pairsKey = JSON.stringify(pairs)
  // blended outlines for the glyphs on screen, one request per weight and missing set
  useEffect(() => { blendCache.current.clear(); lastBlend.current.clear(); blendKern.current.clear(); lastBlendKern.current.clear() }, [blendRev, family?.path])
  // One request at a time, always for the newest weight: a sweep sends a new weight every few milliseconds, and a
  // request per step queued up behind the server and arrived too late (the text lagged, stuck, then jumped).
  // kerning blended the same way, per position: the open master's kerning at every weight made the spacing jump when the slider reached another master
  const blendKern = useRef(new Map<string, Map<string, number>>())
  const lastBlendKern = useRef(new Map<string, number>())
  const wanted = useRef({ blending, family, weight, location, posKey, names: [] as string[], pairs: [] as [string, string][], quadratic: font.quadratic })
  const pump = useRef(latestOnly(async () => {
    const w = wanted.current
    if (!w.blending || !w.family || w.weight === null) return
    const have = blendCache.current.get(w.posKey) ?? blendCache.current.set(w.posKey, new Map()).get(w.posKey)!
    const haveK = blendKern.current.get(w.posKey) ?? blendKern.current.set(w.posKey, new Map()).get(w.posKey)!
    const need = w.names.filter(n => !have.has(n))
    const needK = w.pairs.filter(([l, r]) => !haveK.has(`${l} ${r}`))
    if (!need.length && !needK.length) return
    const [r, kr] = await Promise.all([
      need.length ? api<Record<string, BlendGlyph | null>>('/api/family/blend', { path: w.family.path, weight: w.weight, location: w.location, names: need }) : Promise.resolve({} as Record<string, BlendGlyph | null>),
      needK.length ? api<Record<string, number>>('/api/family/blend-kerning', { path: w.family.path, weight: w.weight, location: w.location, pairs: needK }).catch(() => ({} as Record<string, number>)) : Promise.resolve({} as Record<string, number>),
    ])
    for (const [k, v] of Object.entries(kr)) { haveK.set(k, v); lastBlendKern.current.set(k, v) }
    for (const n of need) {
      const g = r[n]
      const shape = g ? { path: contourPath(g.contours, g.closed, w.quadratic), width: g.width } : null
      have.set(n, shape)
      if (shape) lastBlend.current.set(n, shape); else lastBlend.current.delete(n)
    }
    setBlendTick(x => x + 1)
  }))
  useEffect(() => {
    wanted.current = { blending, family, weight, location, posKey, names: [...new Set(run)], pairs: pairsRef.current, quadratic: font.quadratic }
    pump.current()
  }, [blending, family, weight, posKey, run, blendRev, font.quadratic, pairsKey])  // eslint-disable-line react-hooks/exhaustive-deps
  const blendMiss = blending ? [...new Set(run)].filter(n => blendCache.current.get(posKey)?.get(n) === null) : []

  // effective kerning for every adjacent pair in the text, from FontForge
  useEffect(() => {
    if (!pairs.length) return
    api<Kern[]>('/api/kerning', { pairs })
      .then(list => setKerns(m => { const n = new Map(m); for (const k of list) n.set(pk(k.left, k.right), k); return n }))
      .catch(() => {})
  }, [pairs, font, kernRev])
  const kernVal = (l: string, r: string) => {
    const p = kernPending.current.get(pk(l, r))
    if (!p && blending) {  // a blend: kerning blended from the masters (the last one known while the new one is on its way)
      const b = blendKern.current.get(posKey)?.get(`${l} ${r}`) ?? lastBlendKern.current.get(`${l} ${r}`)
      if (b !== undefined) return b
    }
    return p ? p.value ?? 0 : kerns.get(pk(l, r))?.value ?? 0
  }
  useEffect(() => { if (cursor >= run.length) setCursor(Math.max(0, run.length - 1)) }, [run, cursor])
  useEffect(() => { if (current && current !== sel) onSelect(current) }, [current]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Metrics as shown: the pending target if there is one, else the core's. */
  const metrics = (name: string): (Metrics & { width: number; shift: number }) | null => {
    const o = outlines.want(name, loc)
    if (!o) return null
    const p = pending.current.get(name)
    if (!p) return { lsb: o.lsb, rsb: o.rsb, width: o.width, shift: 0 }
    return { ...p, width: o.width + (p.lsb - o.lsb) + (p.rsb - o.rsb), shift: p.lsb - o.lsb }
  }

  const send = useCallback(async (name: string) => {
    if (inflight.current.has(name)) return
    const target = pending.current.get(name)
    if (!target) return
    inflight.current.add(name)
    try {
      const o = await api<RawOutline>('/api/bearings', { name, lsb: target.lsb, rsb: target.rsb })
      outlines.put(o, null)
      for (const c of (o as RawOutline & { changed?: RawOutline[] }).changed ?? []) outlines.put(c, null)  // glyphs that follow it
      outlines.invalidateUsers(name)  // composites built from it moved too
      setKeyRev(v => v + 1)           // a typed number frees a followed side
    } finally {
      inflight.current.delete(name)
      const now = pending.current.get(name)
      if (now === target) pending.current.delete(name)
      else void send(name)  // edited again while in flight: send the latest
      force(x => x + 1)
    }
  }, [])

  const edit = useCallback((name: string, m: Partial<Metrics>, record = true) => {
    const cur = metrics(name)
    if (!cur || !editable) return
    if (record) undo.current.push({ kind: 'metrics', name, m: { lsb: cur.lsb, rsb: cur.rsb } })
    pending.current.set(name, { lsb: Math.round(m.lsb ?? cur.lsb), rsb: Math.round(m.rsb ?? cur.rsb) })
    force(x => x + 1)
    void send(name)
  }, [editable, send]) // eslint-disable-line react-hooks/exhaustive-deps

  const sendKern = useCallback(async (l: string, r: string) => {
    const key = pk(l, r)
    if (kernInflight.current.has(key)) return
    const target = kernPending.current.get(key)
    if (!target) return
    kernInflight.current.add(key)
    try {
      const k = await api<Kern>('/api/kern', { left: l, right: r, value: target.value, mode: target.mode })
      setKerns(m => new Map(m).set(key, k))
      // a group (class) cell moves every pair of its two groups: re-read them all
      if (k.sources.some(src => src.kind === 'class')) setKernRev(v => v + 1)
    } finally {
      kernInflight.current.delete(key)
      if (kernPending.current.get(key) === target) kernPending.current.delete(key)
      else void sendKern(l, r)
      force(x => x + 1)
    }
  }, [])

  const editKern = useCallback((l: string, r: string, value: number | null, record = true, mode = kernMode) => {
    if (!editable) return
    const key = pk(l, r)
    if (record) undo.current.push({ kind: 'kern', l, r, value: kernVal(l, r), mode, existed: !!kerns.get(key)?.sources.length })
    kernPending.current.set(key, { value: value === null ? null : Math.round(value), mode })
    force(x => x + 1)
    void sendKern(l, r)
  }, [editable, kerns, kernMode, sendKern]) // eslint-disable-line react-hooks/exhaustive-deps

  /** A key set or freed: the glyph and everything that follows it have new outlines. `num` in the undo step is the number the side had before. */
  const setKey = async (name: string, side: 'lsb' | 'rsb', key: string, record = true) => {
    const prev = keys[name]?.[side] ?? '', before = metrics(name)
    try {
      const r = await api<RawOutline & { changed: RawOutline[] }>('/api/metrics-key', { name, side, key })
      if (record && before) undo.current.push({ kind: 'key', name, side, key: prev, num: before[side] })
      outlines.put(r, null)
      for (const c of r.changed) outlines.put(c, null)
      setKeyRev(v => v + 1)
    } catch (e) { toast.error('Metrics key not set', { description: (e as Error).message }) }
  }

  /** A number typed into a followed side frees it; undo gives the key back. */
  const typeNumber = (name: string, side: 'lsb' | 'rsb', n: number) => {
    const key = keys[name]?.[side], m = metrics(name)
    if (key && m) undo.current.push({ kind: 'key', name, side, key, num: m[side] })
    edit(name, { [side]: n }, !key)
  }

  // Auto-space: FontForge spaces the letters evenly from their shapes; one undo step puts them all back
  const [autoSep, setAutoSep] = useState(Math.round(font.em * 0.1))
  const [autoMin, setAutoMin] = useState(Math.round(font.em * 0.02))
  const [autoBusy, setAutoBusy] = useState(false)
  const autoSpace = async (wholeFont: boolean) => {
    if (!editable || autoBusy) return
    setAutoBusy(true)
    try {
      if (wholeFont) await api('/api/snapshots', { path: font.path, label: 'Before auto-spacing' }).then(() => window.dispatchEvent(new Event('forge-snapshots'))).catch(() => {})
      const r = await api<{ changed: { name: string; before: { lsb: number; rsb: number } }[]; skipped: string[]; outlines: RawOutline[]; followers: RawOutline[] }>(
        '/api/autospace', { ...(wholeFont ? {} : { names: [...new Set(run)] }), separation: autoSep, min_bearing: autoMin })
      for (const o of [...r.outlines, ...r.followers]) { outlines.put(o, null); outlines.invalidateUsers(o.name) }
      if (r.changed.length) undo.current.push({ kind: 'batch', items: r.changed.map(c => ({ name: c.name, m: { lsb: c.before.lsb, rsb: c.before.rsb } })) })
      setKeyRev(v => v + 1)
      force(x => x + 1)
      toast.success(r.changed.length ? `Spaced ${r.changed.length} letter${r.changed.length === 1 ? '' : 's'}` : 'Already evenly spaced', {
        description: [r.changed.length ? 'Undo (Ctrl Z) puts them back.' : '', r.skipped.length ? `${r.skipped.length} follow another letter's spacing and were left to that.` : ''].filter(Boolean).join(' ') || undefined,
      })
    } catch (e) { toast.error('Could not space the letters', { description: (e as Error).message }) } finally { setAutoBusy(false) }
  }

  // Auto-kern: FontForge kerns every pair of the letters from their shapes, as pair kerns; one undo step takes them all back
  const [kernSep, setKernSep] = useState(Math.round(font.em * 0.1))
  const [kernMin, setKernMin] = useState(5)
  const [kernGap, setKernGap] = useState(Math.round(font.em * 0.03))
  const autoKern = async (wholeFont: boolean) => {
    if (!editable || autoBusy) return
    setAutoBusy(true)
    try {
      await api('/api/snapshots', { path: font.path, label: 'Before auto-kerning' }).then(() => window.dispatchEvent(new Event('forge-snapshots'))).catch(() => {})
      const r = await api<{ subtable: string | null; changed: { left: string; right: string; before: number | null }[] }>(
        '/api/autokern', { ...(wholeFont ? {} : { names: [...new Set(run)] }), separation: kernSep, min_kern: kernMin, min_gap: kernGap })
      if (r.subtable && r.changed.length) undo.current.push({ kind: 'autokern', subtable: r.subtable, pairs: r.changed.map(c => ({ left: c.left, right: c.right, value: c.before })) })
      setKernRev(v => v + 1)
      toast.success(r.changed.length ? `Kerned ${r.changed.length} pair${r.changed.length === 1 ? '' : 's'}` : 'No pairs needed kerning',
        { description: r.changed.length ? 'Undo (Ctrl Z) takes them all back. A snapshot was made first.' : undefined })
    } catch (e) { toast.error('Could not kern the letters', { description: (e as Error).message }) } finally { setAutoBusy(false) }
  }

  const doUndo = () => {
    const u = undo.current.pop()
    if (!u) return
    if (u.kind === 'autokern') {
      void api('/api/kern/pairs', { subtable: u.subtable, pairs: u.pairs }).then(() => setKernRev(v => v + 1)).catch(e => toast.error('Could not undo the kerning', { description: (e as Error).message }))
      return
    }
    if (u.kind === 'key') {
      void (async () => {
        if (u.key) await setKey(u.name, u.side, u.key, false)
        else { await setKey(u.name, u.side, '', false); edit(u.name, { [u.side]: u.num }, false) }
      })()
    } else if (u.kind === 'batch') for (const it of u.items) edit(it.name, it.m, false)
    else if (u.kind === 'metrics') edit(u.name, u.m, false)
    else editKern(u.l, u.r, u.existed ? u.value : null, false, u.mode)
  }

  /** What to draw for a glyph: the blend at the master bar's weight if there is one, else the open font's outline. */
  const shapeOf = (name: string): { path: Path2D; width: number; shift: number; lsb?: number; rsb?: number } | null => {
    const here = blending ? blendCache.current.get(posKey) : undefined
    const b = here?.has(name) ? here.get(name) : blending ? lastBlend.current.get(name) : undefined
    if (b) return { path: b.path, width: b.width, shift: 0 }
    const m = metrics(name), o = outlines.get(name, loc)
    return m && o ? { path: o.path, width: m.width, shift: m.shift, lsb: m.lsb, rsb: m.rsb } : null
  }

  const ref = useCanvas((ctx, w, h) => {
    const t = theme()
    const ink = colors?.fg ?? t.ink
    const dim = colors ? withAlpha(colors.fg, 0.55) : t.dim
    const selFill = colors ? withAlpha(colors.fg, 0.12) : t.sel
    const guideC = colors ? withAlpha(colors.fg, 0.3) : t.guide
    const refC = colors ? withAlpha(colors.fg, 0.7) : t.reference
    if (colors) { ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, w, h) }
    const pad = 32
    const out: Box[] = []
    ctx.font = '10px ' + t.mono
    ctx.textAlign = 'center'
    let top = pad
    for (const sz of waterfall ? WATERFALL : [size]) {
      const s = sz / font.em
      const labels = !para && sz >= LABELS_MIN_SIZE  // below this the numbers would only clutter
      const withRef = !!reference && showRef && !para && !waterfall
      const band = (font.ascent + font.descent) * s
      const lineH = para ? sz * lineHeight : band + (labels ? 34 : 8) + (withRef ? band + 8 : 0)  // reference line sits under each line
      const adv = (i: number) => (shapeOf(run[i])?.width ?? font.em / 2) * s
      const kern = (i: number) => kernOn && i > 0 ? kernVal(run[i - 1], run[i]) * s : 0
      const isSpace = (i: number) => cpOf.get(run[i]) === 32

      // line breaks: hard ones from the text, then wrap at the edge (at a space in paragraph mode)
      const starts = [0]
      let x = pad, lastSpace = -1
      for (let i = 0; i < run.length; i++) {
        if (i > 0 && breaks.has(i) && para) { starts.push(i); x = pad; lastSpace = -1 }
        const first = starts[starts.length - 1] === i
        if (!first && x + kern(i) + adv(i) > w - pad) {
          let from = para && lastSpace >= starts[starts.length - 1] ? lastSpace + 1 : i
          if (from <= starts[starts.length - 1]) from = i
          starts.push(from)
          x = pad
          for (let k = from; k < i; k++) x += (k > from ? kern(k) : 0) + adv(k)
          x += i > from ? kern(i) : 0
        } else if (!first) x += kern(i)
        if (isSpace(i)) lastSpace = i
        x += adv(i)
      }

      const base0 = top + font.ascent * s
      const placed: { path: Path2D; x: number; y: number }[][] = starts.map(() => [])
      const extent: [number, number][] = starts.map(() => [pad, pad])
      starts.forEach((from, li) => {
        const to = starts[li + 1] ?? run.length
        const y = base0 + li * lineH
        let x = pad
        for (let i = from; i < to; i++) {
          const sh = shapeOf(run[i])
          const a = adv(i)
          const kv = i > from && kernOn ? kernVal(run[i - 1], run[i]) : 0
          x += kv * s
          if (labels && kernOn && i > from && (kv || i === cursor)) {
            // the kern before this glyph, at the boundary, under the metrics row
            ctx.fillStyle = kv ? refC : dim
            ctx.textAlign = 'center'
            ctx.fillText(kv ? String(Math.round(kv)) : '0', x, y + font.descent * s + 27)
            if (i === cursor) {
              ctx.strokeStyle = refC
              ctx.beginPath(); ctx.moveTo(x - 6, y + font.descent * s + 31); ctx.lineTo(x + 6, y + font.descent * s + 31); ctx.stroke()
            }
          }
          const on = i === cursor
          if (on) {
            ctx.fillStyle = selFill
            ctx.fillRect(x, y - font.ascent * s, a, band)
            if (!para) {
              ctx.strokeStyle = t.start
              ctx.lineWidth = 1
              for (const gx of [x, x + a]) {
                ctx.beginPath(); ctx.moveTo(Math.round(gx) + .5, y - font.ascent * s); ctx.lineTo(Math.round(gx) + .5, y + font.descent * s); ctx.stroke()
              }
            }
          }
          const bn = shadows && !para ? baseOf(run[i]) : null
          const bo = bn ? outlines.want(bn, loc) : undefined
          if (bo && sh) {
            // shadow: the base letter from the same origin, and where its advance ends
            ctx.save(); ctx.translate(x, y); ctx.scale(s, -s)
            ctx.globalAlpha = 0.35; ctx.fillStyle = t.shadow; ctx.fill(bo.path); ctx.globalAlpha = 1
            ctx.restore()
            if (labels) {
              ctx.setLineDash([2, 3]); ctx.strokeStyle = t.shadow; ctx.lineWidth = 1
              const bx = Math.round(x + bo.width * s) + .5
              ctx.beginPath(); ctx.moveTo(bx, y - font.ascent * s); ctx.lineTo(bx, y + font.descent * s); ctx.stroke()
              ctx.setLineDash([])
              const dw = Math.round(sh.width - bo.width)
              if (dw) { ctx.fillStyle = t.shadow; ctx.fillText(`${dw > 0 ? '+' : ''}${dw}`, x + a / 2, y - font.ascent * s - 4) }
            }
          }
          if (sh) {
            ctx.save()
            ctx.translate(x + sh.shift * s, y)
            ctx.scale(s, -s)
            ctx.fillStyle = ink
            ctx.fill(sh.path)
            ctx.restore()
            placed[li].push({ path: sh.path, x: x + sh.shift * s, y })
            if (labels) {
              ctx.fillStyle = on ? ink : dim
              const ly = y + font.descent * s + 14
              ctx.textAlign = 'center'
              if (sh.lsb !== undefined && sh.rsb !== undefined && (a > 44 || on)) {
                ctx.textAlign = 'left'; ctx.fillText(String(Math.round(sh.lsb)), x + 2, ly)
                ctx.textAlign = 'right'; ctx.fillText(String(Math.round(sh.rsb)), x + a - 2, ly)
                ctx.textAlign = 'center'
              }
              if (on) { ctx.fillStyle = ink; ctx.fillText(String(Math.round(sh.width)), x + a / 2, ly + 13) }
            }
          }
          out.push({ i, x, y: y - font.ascent * s, w: a, h: lineH, s })
          x += a
        }
        extent[li] = [pad, x]
      })

      // font-wide guides across every line
      if (!para) {
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = guideC
        ctx.lineWidth = 1
        for (let li = 0; li < starts.length; li++) for (const g of guides) {
          const gy = Math.round(base0 + li * lineH - g * s) + .5
          ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke()
        }
        ctx.setLineDash([])
      }

      // underline / strikethrough from the font's own values; the underline can skip the ink it touches
      if (lineBands && (underline || strike)) {
        starts.forEach((_, li) => {
          const [x0, x1] = extent[li]
          const y = base0 + li * lineH
          const bar = (b: Band, c: CanvasRenderingContext2D) => c.fillRect(x0, y - b.top * s, x1 - x0, Math.max(1, b.height * s))
          if (strike) { ctx.fillStyle = ink; bar(lineBands.st, ctx) }
          if (!underline) return
          if (!skipInk) { ctx.fillStyle = ink; bar(lineBands.ul, ctx); return }
          const off = document.createElement('canvas')
          off.width = ctx.canvas.width; off.height = ctx.canvas.height
          const o = off.getContext('2d')!
          o.setTransform(ctx.getTransform())
          o.fillStyle = ink; bar(lineBands.ul, o)
          o.globalCompositeOperation = 'destination-out'
          const clearance = Math.max(1.5, lineBands.ul.height * s)  // px either side of a descender
          for (const g of placed[li]) {
            o.save(); o.translate(g.x, g.y); o.scale(s, -s); o.lineWidth = 2 * clearance / s
            o.fill(g.path); o.stroke(g.path); o.restore()
          }
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, 0, 0); ctx.restore()
        })
      }

      // the same text in the reference font, its own advances, under each line
      if (withRef && reference) {
        const rs = sz / reference.info.em  // same size per em, so the comparison is fair
        starts.forEach((from, li) => {
          const to = starts[li + 1] ?? run.length
          let rx = pad
          const ry = base0 + li * lineH + font.descent * s + 34 + reference.info.ascent * rs
          ctx.fillStyle = refC
          ctx.textAlign = 'left'
          if (li === 0) ctx.fillText(reference.info.familyname, pad, ry - reference.info.ascent * rs - 4)
          for (let i = from; i < to; i++) {
            const cp = cpOf.get(run[i]) ?? -1
            const rn = refByCp.get(cp) ?? (reference.info.glyphs.some(g => g.name === run[i]) ? run[i] : undefined)
            const ro = rn ? reference.store.want(rn, null) : undefined
            if (ro) {
              ctx.save(); ctx.translate(rx, ry); ctx.scale(rs, -rs); ctx.fillStyle = ink; ctx.fill(ro.path); ctx.restore()
              rx += ro.width * rs
            } else rx += (reference.info.em / 2) * rs
          }
        })
      }
      if (waterfall) { ctx.fillStyle = dim; ctx.textAlign = 'right'; ctx.fillText(`${sz}px`, w - 8, base0 - font.ascent * s + 10); ctx.textAlign = 'center' }
      top = base0 + (starts.length - 1) * lineH + lineH + (waterfall ? 10 : 0) - font.ascent * s
    }
    boxes.current = out
    if (edgeHover) {  // the edge a click would grab
      const r = out.find(b => b.i === edgeHover.i)
      if (r) { ctx.fillStyle = 'rgb(80,140,255)'; ctx.fillRect((edgeHover.side === 'L' ? r.x : r.x + r.w) - 1.5, r.y, 3, r.h) }
    }
  })

  /** A glyph's left or right edge within 5px. Two neighbours share the line between them (the left one's right
   *  edge is the right one's left edge): the selected glyph wins, else the one the pointer is over. */
  const edgeAt = (px: number, py: number): { i: number; side: 'L' | 'R'; s: number } | null => {
    const hits: { i: number; side: 'L' | 'R'; s: number; inside: boolean }[] = []
    for (const r of boxes.current) {
      if (py < r.y || py >= r.y + r.h) continue
      if (Math.abs(px - r.x) < 5) hits.push({ i: r.i, side: 'L', s: r.s, inside: px >= r.x })
      if (Math.abs(px - (r.x + r.w)) < 5) hits.push({ i: r.i, side: 'R', s: r.s, inside: px < r.x + r.w })
    }
    return hits.find(h => h.i === cursor) ?? hits.find(h => h.inside) ?? hits[0] ?? null
  }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); doUndo(); return }
    const step = e.shiftKey ? getSettings().nudgeBig : getSettings().nudge
    if ((e.key === ',' || e.key === '.' || e.key === '<' || e.key === '>') && cursor > 0 && kernOn) {
      e.preventDefault()
      const l = run[cursor - 1]
      editKern(l, current, kernVal(l, current) + (e.key === ',' || e.key === '<' ? -step : step))
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const d = (e.key === 'ArrowRight' ? 1 : -1) * step
    const m = current && metrics(current)
    if (e.altKey && m) edit(current, { rsb: m.rsb + d })
    else if ((e.ctrlKey || e.metaKey) && m) edit(current, { lsb: m.lsb + d })
    else setCursor(c => Math.min(run.length - 1, Math.max(0, c + Math.sign(d))))
  }

  const m = current ? metrics(current) : null
  const cur = colors ?? PRESETS[1].pair  // what the pickers show while the app theme is in use
  const ratio = colors ? contrast(colors.fg, colors.bg) : null
  const setPair = (p: Pair | null) => { keep('colors', p); setColors(p) }
  const saveSwatches = (v: Pair[]) => { localStorage.setItem('forge.proof.swatches', JSON.stringify(v)); setSwatches(v) }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 overflow-x-auto border-b p-2">
        {para
          ? <Textarea value={text} onChange={e => setText(e.target.value)} rows={2} spellCheck={false} className="h-14 max-h-14 min-h-0 min-w-48 flex-1 resize-none overflow-y-auto py-1 font-mono leading-normal"
              placeholder="Type a paragraph, or /glyphname to place any glyph (/f_i)" />
          : <Input value={text} onChange={e => setText(e.target.value)} className="h-7 min-w-48 flex-1 font-mono"
              placeholder="Type text, or /glyphname to place any glyph (/f_i)" />}
        <span className="shrink-0 text-xs text-muted-foreground">{waterfall ? 'waterfall' : `${size}px`}</span>
        <Slider className="w-28" min={8} max={480} step={1} value={[size]} disabled={waterfall} onValueChange={v => setSize(v[0])} />
        <Button size="xs" variant={kernOn ? 'secondary' : 'ghost'} aria-pressed={kernOn}
          title="Show the text with its kerning (on) or without (off), to compare. Off only changes what you see here: the kerning stays in the font."
          onClick={() => { localStorage.setItem('forge.kern', kernOn ? '0' : '1'); setKernOn(!kernOn) }}>
          Kerning {kernOn ? 'on' : 'off'}
        </Button>
        <Button size="xs" variant={groupsOpen ? 'secondary' : 'ghost'} title="Kerning groups"
          onClick={() => { localStorage.setItem('forge.groups', groupsOpen ? '0' : '1'); setGroupsOpen(!groupsOpen) }}>
          Groups
        </Button>
        <Button size="xs" variant={shadows ? 'secondary' : 'ghost'}
          title="Draw each accented letter's base behind it (É over E) with the base's advance, and the width difference"
          onClick={() => { localStorage.setItem('forge.shadows', shadows ? '0' : '1'); setShadows(!shadows) }}>
          Shadow bases
        </Button>
        <Button size="xs" variant={variantsOn && hasVariants ? 'secondary' : 'ghost'} disabled={!hasVariants}
          title={hasVariants ? 'After each letter that has accented forms (A), also show them (À Á Â Ã Ä Å ...), side by side' : 'Type a letter that has accented forms, like A or e, to use this'}
          onClick={() => { localStorage.setItem('forge.variants', variantsOn ? '0' : '1'); setVariantsOn(!variantsOn) }}>
          Accented variants
        </Button>
        {reference && (
          <Button size="xs" variant={showRef ? 'secondary' : 'ghost'} onClick={() => setShowRef(v => !v)}
            title="Show the same text in the reference font under each line">
            {showRef ? 'Hide' : 'Show'} {reference.info.familyname}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b px-2 py-1.5 text-xs text-muted-foreground">
        <Pop label="Layout" active={waterfall || para} width="w-56">
          <ToggleRow on={waterfall} label="Waterfall" hint={`The same line at ${WATERFALL.join(', ')} px`}
            onClick={() => { keep('waterfall', !waterfall); setWaterfall(!waterfall) }} />
          <ToggleRow on={para} label="Paragraph" hint="Several lines, wrapped at word breaks"
            onClick={() => { keep('para', !para); setPara(!para) }} />
          {para && (
            <div className="flex items-center gap-2 px-1 pt-1">
              <span className="w-20 shrink-0">Leading {lineHeight.toFixed(2)}</span>
              <Slider min={0.9} max={2.2} step={0.05} value={[lineHeight]} onValueChange={v => { setLineHeight(v[0]); keep('lh', v[0]) }} />
            </div>
          )}
        </Pop>
        <Pop label="Colours" active={!!colors} width="w-72">
          <div className="flex items-center gap-3 px-1">
            <label className="flex items-center gap-1.5">Text <ColorPicker label="Text colour" value={cur.fg} onChange={fg => setPair({ ...cur, fg })} /></label>
            <label className="flex items-center gap-1.5">Background <ColorPicker label="Background colour" value={cur.bg} onChange={bg => setPair({ ...cur, bg })} /></label>
          </div>
          <div className="flex flex-wrap gap-1 pt-2">
            <Button size="xs" variant={colors ? 'ghost' : 'secondary'} title="Use the app theme's colours" onClick={() => setPair(null)}>Theme</Button>
            {PRESETS.map(p => (
              <Button key={p.name} size="xs" variant="ghost" title={`${p.pair.fg} on ${p.pair.bg}`} onClick={() => setPair(p.pair)}>
                <span className="inline-block size-3 rounded-full border" style={{ background: p.pair.bg, boxShadow: `inset 0 0 0 3px ${p.pair.fg}` }} />{p.name}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1 pt-2">
            <span className="px-1">Saved</span>
            {swatches.map((p, i) => (
              <span key={i} className="flex items-center">
                <Button size="xs" variant="ghost" title={`${p.fg} on ${p.bg}`} aria-label={`Saved colours ${p.fg} on ${p.bg}`} onClick={() => setPair(p)}>
                  <span className="inline-block size-3 rounded-full border" style={{ background: p.bg, boxShadow: `inset 0 0 0 3px ${p.fg}` }} />
                </Button>
                <Button size="xs" variant="ghost" className="-ml-1 px-1" title="Forget this swatch" aria-label="Forget this swatch"
                  onClick={() => saveSwatches(swatches.filter((_, j) => j !== i))}>×</Button>
              </span>
            ))}
            <Button size="xs" variant="ghost" title="Save these colours as a swatch" disabled={!colors || swatches.some(p => p.fg === colors.fg && p.bg === colors.bg)}
              onClick={() => colors && saveSwatches([...swatches, colors])}>Save these</Button>
          </div>
          <ToggleRow on={badge} label="Show the contrast badge" hint="The ratio and its WCAG level"
            onClick={() => { keep('badge', !badge); setBadge(!badge) }} />
          {ratio !== null && badge && (
            <div className="pt-2"><Contrast ratio={ratio} fg={colors!.fg} bg={colors!.bg} /></div>
          )}
        </Pop>
        <Pop label="Texts" active={false} width="w-64">
          <p className="text-muted-foreground">Sample texts you keep for proofing.</p>
          {texts.map((t, i) => (
            <span key={i} className="flex items-center gap-1">
              <Button size="xs" variant="ghost" className="min-w-0 flex-1 justify-start truncate font-mono" title={t} onClick={() => setText(t)}>{t}</Button>
              <Button size="xs" variant="ghost" aria-label="Forget this text" onClick={() => saveTexts(texts.filter((_, j) => j !== i))}>×</Button>
            </span>
          ))}
          <Button size="xs" variant="secondary" disabled={!text.trim() || texts.includes(text)} onClick={() => saveTexts([...texts, text])}>Save the current text</Button>
          <p className="pt-2 text-muted-foreground">A sample in a writing system. Arabic, Hebrew and the Indic scripts are set the way they are written (joined, right to left).</p>
          <div className="flex flex-wrap gap-1">
            {SCRIPTS.filter(sc => sc.sample).map(sc => (
              <Button key={sc.tag} size="xs" variant="outline" title={sc.sample} onClick={() => setText(sc.sample)}>{sc.name.split(' (')[0]}</Button>
            ))}
          </div>
        </Pop>
        <Pop label="Features" active={featOn} width="w-72">
          <p className="text-muted-foreground">Show the text the way the font will set it: ligatures join, small capitals and other alternates swap in. Kerning and spacing stay yours to edit here.</p>
          <label className="flex items-center gap-2">
            <Switch checked={featOn} label="Apply the font's features" onCheckedChange={on => { keep('features', on); setFeatOn(on) }} />Apply the font's features
          </label>
          {featOn && (featTags.length === 0
            ? <p className="text-muted-foreground">This font has no features yet. Set them up in the Features tab.</p>
            : (
              <div className="flex flex-wrap gap-1 pt-1">
                {featTags.map(t => (
                  <button key={t} type="button" aria-pressed={featOnFor(t)} title={featOnFor(t) ? `${t} is on` : `${t} is off`}
                    onClick={() => { const next = { ...featChoice, [t]: !featOnFor(t) }; keep('featChoice', next); setFeatChoice(next) }}
                    className={`rounded border px-1.5 py-0.5 font-mono ${featOnFor(t) ? 'border-primary bg-primary/15 text-foreground' : 'text-muted-foreground'}`}>{t}</button>
                ))}
              </div>
            ))}
        </Pop>
        <Pop label="Glyphs" active={false} width="w-80">
          <p className="text-muted-foreground">Glyphs without a letter of their own (ligatures, small capitals, alternates) are placed by name: type <code>/</code> and the name, like <code>/f_i</code>. Click one to add it to the text.</p>
          {altGlyphs.length === 0
            ? <p>None yet. Make them on the Features tab.</p>
            : (
              <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto pt-1">
                {altGlyphs.map(n => (
                  <button key={n} type="button" title={`Add /${n} to the text`}
                    onClick={() => setText(t => `${t}${t && !/[\s]$/.test(t) ? ' ' : ''}/${n} `)}
                    className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent">{n}</button>
                ))}
              </div>
            )}
        </Pop>
        <Pop label="Auto-space" active={false} width="w-64" strong>
          <p className="text-muted-foreground">FontForge spaces the letters evenly from their shapes. A good first pass: fine-tune by hand after.</p>
          <label className="flex items-center gap-2">Distance between letters
            <Input type="number" min={0} value={autoSep} onChange={e => setAutoSep(Math.max(0, Number(e.target.value) || 0))} className="h-7 w-20 font-mono" /></label>
          <label className="flex items-center gap-2">Never closer than
            <Input type="number" min={0} value={autoMin} onChange={e => setAutoMin(Math.max(0, Number(e.target.value) || 0))} className="h-7 w-20 font-mono" /></label>
          <Button size="sm" variant="secondary" className="w-full" disabled={!editable || autoBusy || !run.length} onClick={() => void autoSpace(false)}>Space the letters shown</Button>
          <Button size="sm" variant="ghost" className="w-full" disabled={!editable || autoBusy} onClick={() => void autoSpace(true)}>Space the whole font</Button>
          <p className="text-[10px] text-muted-foreground">Letters whose spacing follows another letter (=H) are left to that. Font units. Ctrl Z undoes it.</p>
        </Pop>
        <Pop label="Auto-kern" active={false} width="w-64" strong>
          <p className="text-muted-foreground">FontForge kerns every pair from the shapes, so the gaps look even (AV, To, LT). A first pass: check the pairs after.</p>
          <label className="flex items-center gap-2">Distance between letters
            <Input type="number" min={0} value={kernSep} onChange={e => setKernSep(Math.max(0, Number(e.target.value) || 0))} className="h-7 w-20 font-mono" /></label>
          <label className="flex items-center gap-2">Never closer than
            <Input type="number" min={0} value={kernGap} onChange={e => setKernGap(Math.max(0, Number(e.target.value) || 0))} className="h-7 w-20 font-mono" /></label>
          <label className="flex items-center gap-2">Skip kerns smaller than
            <Input type="number" min={0} value={kernMin} onChange={e => setKernMin(Math.max(0, Number(e.target.value) || 0))} className="h-7 w-20 font-mono" /></label>
          <Button size="sm" variant="secondary" className="w-full" disabled={!editable || autoBusy || !run.length} onClick={() => void autoKern(false)}>Kern the letters shown</Button>
          <Button size="sm" variant="ghost" className="w-full" disabled={!editable || autoBusy} onClick={() => void autoKern(true)}>Kern the whole font</Button>
          <p className="text-[10px] text-muted-foreground">Written as pair kerns, ahead of your groups. The whole font can take a while. Ctrl Z undoes it.</p>
        </Pop>
        <Pop label="Lines" active={underline || strike} width="w-56">
          <ToggleRow on={underline} label="Underline" hint="From the font's own position and thickness"
            onClick={() => { keep('underline', !underline); setUnderline(!underline) }} />
          <ToggleRow on={skipInk} label="Skip ink" hint="The underline breaks where letters cross it" disabled={!underline}
            onClick={() => { keep('skip', !skipInk); setSkipInk(!skipInk) }} />
          <ToggleRow on={strike} label="Strikethrough" hint="From the font's OS/2 strikeout values"
            onClick={() => { keep('strike', !strike); setStrike(!strike) }} />
        </Pop>
        {ratio !== null && badge && <Contrast ratio={ratio} fg={colors!.fg} bg={colors!.bg} />}
        {blending && <span className="font-mono text-foreground">weight {weight}</span>}
        {blendMiss.length > 0 && family && openMaster && (
          <Button size="xs" variant="outline" title={`Copy ${blendMiss.length > 6 ? 'these glyphs' : blendMiss.join(' ')} from the open master (${openMaster.name}) into every other master, so their points match again. The other masters' drawings of them are replaced: reshape afterwards, bolder and lighter keep the points. Take a snapshot first if unsure.`}
            onClick={() => {
              if (!window.confirm(`Replace ${blendMiss.length} glyph${blendMiss.length > 1 ? 's' : ''} (${blendMiss.slice(0, 8).join(' ')}) in the other masters with copies of ${openMaster.name}'s, so all masters have the same points?

Their current drawings in the other masters are lost; reshape them afterwards (Bolder/Lighter keep the points).`)) return
              void api('/api/family/copy-glyph', { source: openMaster.path, targets: family.masters.filter(m => !samePath(m.path, openMaster.path)).map(m => m.path), names: blendMiss })
                .then(() => { blendCache.current.clear(); lastBlend.current.clear(); setBlendTick(x => x + 1); pump.current(); toast.success('Masters match again', { description: 'The glyphs in the other masters are copies of this one: reshape them (Bolder / Lighter keep the points).' }) })
                .catch(e => toast.error('Could not match the masters', { description: (e as Error).message }))
            }}>Make them match</Button>
        )}
        {blendMiss.length > 0 && (
          <span className="text-destructive" title={blendMiss.join(' ')}>
            {blendMiss.length} glyph{blendMiss.length > 1 ? 's' : ''} can't blend (masters differ), shown from this master: {blendMiss.slice(0, 6).join(' ')}{blendMiss.length > 6 ? '…' : ''}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
      <div ref={canvasWrap} className="relative min-h-0 flex-1 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        tabIndex={0} onKeyDown={onKey}>
        <canvas ref={ref} className="absolute inset-0 size-full"
          onMouseDown={e => {
            const b = e.currentTarget.getBoundingClientRect()
            const px = e.clientX - b.left, py = e.clientY - b.top
            canvasWrap.current?.focus()
            const edge = editable ? edgeAt(px, py) : null
            if (edge) {
              const m = metrics(run[edge.i])
              if (m) {
                setCursor(edge.i)
                setEdgeHover({ i: edge.i, side: edge.side })
                undo.current.push({ kind: 'metrics', name: run[edge.i], m: { lsb: m.lsb, rsb: m.rsb } })
                edgeDrag.current = { name: run[edge.i], side: edge.side, px, m: { lsb: m.lsb, rsb: m.rsb }, s: edge.s }
                return
              }
            }
            const hit = boxes.current.find(r => px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h)
            if (hit) {
              setCursor(hit.i)
              if (editable && kernOn && hit.i > 0) {
                const l = run[hit.i - 1], r = run[hit.i]
                kernDrag.current = { l, r, px, v0: kernVal(l, r), recorded: false, s: hit.s }
              }
            }
          }}
          onMouseMove={e => {
            const b = e.currentTarget.getBoundingClientRect()
            const px = e.clientX - b.left, py = e.clientY - b.top
            const kd = kernDrag.current
            if (kd) {
              // the glyph follows the pointer: right = looser, left = tighter
              const v = Math.round(kd.v0 + (px - kd.px) / kd.s)
              if (v !== kernVal(kd.l, kd.r)) {
                editKern(kd.l, kd.r, v, !kd.recorded)  // one undo step per drag
                kd.recorded = true
              }
              return
            }
            const d = edgeDrag.current
            if (!d) {
              const e = editable ? edgeAt(px, py) : null
              if (e?.i !== edgeHover?.i || e?.side !== edgeHover?.side) setEdgeHover(e ? { i: e.i, side: e.side } : null)
              return
            }
            // the space follows the pointer: right edge out = more right space,
            // left edge dragged right = more left space (the outline moves with it)
            const du = Math.round((px - d.px) / d.s)
            edit(d.name, d.side === 'L' ? { lsb: d.m.lsb + du } : { rsb: d.m.rsb + du }, false)
          }}
          onMouseUp={() => { edgeDrag.current = null; kernDrag.current = null; setEdgeHover(null) }}
          onMouseLeave={() => { edgeDrag.current = null; kernDrag.current = null; setEdgeHover(null) }}
          style={{ cursor: edgeHover || edgeDrag.current ? 'ew-resize' : undefined }} />
      </div>
      {groupsOpen && <KernGroupsPanel font={font} current={current ?? null}
        onChanged={() => { kernPending.current.clear(); setKerns(new Map()); setKernRev(r => r + 1) }} />}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t px-3 py-1.5 text-xs text-muted-foreground">
        {current && m ? <>
          <span className="font-mono text-foreground">{current}</span>
          <BearingField key={current + "L"} label="L" num={m.lsb} keyText={keys[current]?.lsb} disabled={!editable}
            onNumber={n => typeNumber(current, 'lsb', n)} onKey={k => setKey(current, 'lsb', k)} />
          <BearingField key={current + "R"} label="R" num={m.rsb} keyText={keys[current]?.rsb} disabled={!editable}
            onNumber={n => typeNumber(current, 'rsb', n)} onKey={k => setKey(current, 'rsb', k)} />
          <span className="font-mono">w {Math.round(m.width)}</span>
          {kernOn && cursor > 0 && (() => {
            const l = run[cursor - 1], k = kerns.get(pk(l, current)), src = k?.sources[0]
            return <>
              <label className="flex items-center gap-1" title={`Kerning between ${l} and ${current}`}>K
                <Input type="number" className="h-7 w-20 font-mono" value={Math.round(kernVal(l, current))} disabled={!editable}
                  onChange={e => e.target.value !== '' && editKern(l, current, +e.target.value)} />
              </label>
              {src?.kind === 'class' ? (
                <span className="flex items-center gap-1" title={`Group ${src.left_class?.join(' ')} | ${src.right_class?.join(' ') || '(any)'}`}>
                  <Button size="xs" variant={kernMode === 'auto' ? 'secondary' : 'ghost'} onClick={() => setKernMode('auto')}>Edit group</Button>
                  <Button size="xs" variant={kernMode === 'pair' ? 'secondary' : 'ghost'} onClick={() => setKernMode('pair')}>Only this pair</Button>
                </span>
              ) : <span>{src ? 'pair' : ''}</span>}
            </>
          })()}
          <Button size="xs" variant="ghost" onClick={doUndo} disabled={!undo.current.length}><Undo2 />Undo</Button>
          {pending.current.size > 0 && <span>syncing…</span>}
        </> : <span>Type some text</span>}
        <span className="flex-1" />
        {editable
          ? <span className="flex items-center gap-1"><Kbd>←</Kbd><Kbd>→</Kbd> glyph · <Kbd>Ctrl</Kbd> left · <Kbd>Alt</Kbd> right · <Kbd>,</Kbd><Kbd>.</Kbd> kern · drag glyph = kern, edges = spacing · <Kbd>Ctrl Z</Kbd></span>
          : blending
            ? <span className="flex items-center gap-2">Previewing weight {weight}: spacing is edited on a master, not on a blend.
                {onStopPreview && <Button size="xs" variant="outline" onClick={onStopPreview}>Stop previewing</Button>}</span>
            : <span>Sidebearings edit the default master: move the axes back to default to edit</span>}
      </div>
    </div>
  )
}
