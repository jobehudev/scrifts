import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronRight, Plus, RotateCcw, Wand2, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import { api, outlines, type FontInfo } from './api'
import { theme, useCanvas, useOutlineVersion } from './canvas'
import { addLanguageSystem, blockOf, featureTags, generate, languageSystems, ON_BY_DEFAULT, removeLanguageSystem, SUFFIX_FEATURES, syncLanguageSystems, type Generator } from './features'
import { BLOCKS, shortName, useLanguages } from './gridScripts'
import { LanguageBar } from './LanguageBar'
import { LANGUAGES, SCRIPTS, scriptName, scriptOf } from './scripts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CodeEditor } from './CodeEditor'

type Features = { code: string; lookups: { name: string; type: string; features: string[] }[]; gpos_features: string[] }
type Shaped = { name: string; cluster: number; ax: number; dx: number; dy: number }[]
type NewGlyph = { name: string; base?: string; scale?: number; width?: number; parts?: string[]; fill?: boolean }
const SS_SUFFIXES = ['ss01', 'ss02', 'ss03', 'ss04', 'ss05', 'ss06', 'ss07', 'ss08', 'ss09', 'ss10']
const ALT_SUFFIXES = ['onum', 'lnum', 'tnum', 'pnum', 'zero', 'case', 'sups', 'sinf', 'subs', 'salt', 'swsh', 'hist', 'titl']
/** What each kind of alternate is usually made for, so the box starts with something sensible. */
const ALT_DEFAULT: Record<string, string> = { onum: '0123456789', lnum: '0123456789', tnum: '0123456789', pnum: '0123456789', sups: '0123456789', sinf: '0123456789', subs: '0123456789', zero: '0', case: '()[]{}-', salt: 'a', swsh: 'A', hist: 's', titl: 'A' }

/** The kinds of swap a font can do, in plain words. Each one is set up from glyphs named in a convention. */
type Kind = {
  id: 'liga' | 'smcp' | 'ss' | 'alt'
  ids: Exclude<Generator, 'all' | 'aalt'>[]   // the generators behind it (small capitals is two OpenType features)
  title: string; what: string; draw: string; sample: string
  tags: (code: string) => string[]            // the OpenType feature tags of this kind that the code defines
  glyphs: (names: string[]) => string[]       // the glyphs of this kind the font has
}
const KINDS: Kind[] = [
  { id: 'liga', ids: ['liga'], title: 'Ligatures', what: 'Letters that join into one shape when typed together: f then i becomes a single fi.',
    draw: 'Draw a glyph named f_i (or f_f_i, f_l ...) and the font will use it whenever those letters meet.', sample: 'office fifty fluffy',
    tags: c => featureTags(c).filter(t => t === 'liga'), glyphs: ns => ns.filter(n => /^[A-Za-z]+(_[A-Za-z]+)+$/.test(n)) },
  { id: 'smcp', ids: ['smcp', 'c2sc'], title: 'Small capitals', what: 'Lowercase letters shown as small capital shapes. Capitals can become small capitals too, for text typed in capitals.',
    draw: 'Draw a.sc, b.sc, c.sc ... one for each letter.', sample: 'Small Capitals NASA',
    tags: c => featureTags(c).filter(t => t === 'smcp' || t === 'c2sc'), glyphs: ns => ns.filter(n => n.endsWith('.sc')) },
  { id: 'ss', ids: ['ss'], title: 'Stylistic sets', what: 'Alternate letter shapes that people switch on in groups: a second style of a or g, for example, kept next to the usual one.',
    draw: 'Draw g.ss01, a.ss01, y.ss02 ... the number says which set.', sample: 'Quick gray fox',
    tags: c => featureTags(c).filter(t => /^ss\d\d$/.test(t)), glyphs: ns => ns.filter(n => /\.ss\d\d$/.test(n)) },
  { id: 'alt', ids: ['alt'], title: 'Figures and other alternates', what: 'Old-style or tabular numbers, swashes, case-sensitive punctuation, superscripts and more.',
    draw: 'Draw one.onum (old-style), one.tnum (tabular), a.swsh (swash), a.salt (alternate) ...', sample: '0123456789 (A-B)',
    tags: c => SUFFIX_FEATURES.filter(t => featureTags(c).includes(t)), glyphs: ns => ns.filter(n => SUFFIX_FEATURES.includes(n.split('.').pop() ?? '') && n.includes('.')) },
]

/** What to show before the font has the feature: plain text in the interface font, so the idea is clear without any glyphs. */
const GENERIC: Record<Kind['id'], { before: string; after: string; beforeStyle?: React.CSSProperties; afterStyle?: React.CSSProperties; note: string }> = {
  liga: { before: 'fi', after: '\uFB01', note: 'two letters become one joined glyph' },
  smcp: { before: 'Quiet', after: 'Quiet', afterStyle: { fontVariantCaps: 'small-caps' }, note: 'lowercase letters become small capitals' },
  ss: { before: 'a', after: '\u0251', note: 'a letter switches to a second style' },
  alt: { before: '3470', after: '3470', afterStyle: { fontFamily: 'Georgia, serif' }, note: 'figures switch to old-style, tabular and so on' },
}

/** A word drawn from the font's own glyphs, shaped with these features. */
function Sample({ font, shaped, label }: { font: FontInfo; shaped: Shaped | null; label: string }) {
  useOutlineVersion()
  const ref = useCanvas((ctx, w, h) => {
    if (!shaped) return
    const t = theme()
    const size = Math.min(40, h * 0.8), s = size / font.em
    const total = shaped.reduce((n, g) => n + g.ax, 0) * s
    let x = Math.max(6, (w - total) / 2)
    const y = h / 2 + (font.ascent - font.descent) * s / 2
    ctx.fillStyle = t.ink
    for (const g of shaped) {
      const o = outlines.want(g.name, null)
      if (o) { ctx.save(); ctx.translate(x + g.dx * s, y - g.dy * s); ctx.scale(s, -s); ctx.fill(o.path); ctx.restore() }
      x += g.ax * s
    }
  })
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative h-12 w-28 rounded border bg-background"><canvas ref={ref} aria-label={label} className="absolute inset-0 size-full" /></div>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  )
}

/**
 * A picture of what the swap does: the same text without it and with it. Once the font has the feature it is drawn with the font's
 * own glyphs (shaped with the feature off, then on); before that, a generic example, so the idea comes across with nothing drawn yet.
 */
function Demo({ font, kind, tags, glyphs, rev, onOpenGlyph }: { font: FontInfo; kind: Kind; tags: string[]; glyphs: string[]; rev: number; onOpenGlyph: (n: string) => void }) {
  const charOf = (n: string) => { const g = font.glyphs.find(x => x.name === n); return g && g.unicode >= 0 ? String.fromCodePoint(g.unicode) : null }
  // a few letters the font really has an alternate for
  const text = (() => {
    const first = glyphs[0]
    if (!first) return ''
    if (kind.id === 'liga') return first.split('_').map(charOf).join('')
    const bases = [...new Set(glyphs.map(g => g.split('.')[0]))].slice(0, kind.id === 'alt' ? 4 : 3).map(charOf)
    return bases.every(Boolean) ? bases.join('') : ''
  })()
  const [pair, setPair] = useState<{ key: string; off: Shaped; on: Shaped } | null>(null)
  const key = `${text}|${tags.join()}|${rev}`
  useEffect(() => {
    if (!text || !tags.length) return
    let stale = false
    const flags = (v: boolean) => Object.fromEntries(tags.map(t => [t, v]))
    Promise.all([api<Shaped>('/api/shape', { text, features: flags(false) }), api<Shaped>('/api/shape', { text, features: flags(true) })])
      .then(([off, on]) => { if (!stale) setPair({ key, off, on }) }).catch(() => {})
    return () => { stale = true }
  }, [key])  // eslint-disable-line react-hooks/exhaustive-deps
  const live = text && tags.length && pair?.key === key ? pair : null
  const g = GENERIC[kind.id]
  // a glyph the feature swaps in that has nothing drawn yet: the picture would be blank, so say why
  const swapped = live ? [...new Set(live.on.map(x => x.name))].filter(n => !live.off.some(o => o.name === n)) : []
  const empty = swapped.filter(n => outlines.want(n, null)?.empty)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {live ? (
        <>
          <Sample font={font} shaped={live.off} label="Without" />
          <span className="text-muted-foreground" aria-hidden>→</span>
          <Sample font={font} shaped={live.on} label="With" />
          {empty.length > 0 && (
            <span className="max-w-64 text-[11px] leading-tight text-muted-foreground">
              <button type="button" className="font-mono text-foreground underline underline-offset-2" onClick={() => onOpenGlyph(empty[0])}>{empty[0]}</button> has nothing drawn yet, so the swap shows blank.
              Draw it, or start it from its letters.
            </span>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col items-center gap-0.5">
            <span className="flex h-12 w-28 items-center justify-center rounded border bg-background text-2xl" style={g.beforeStyle}>{g.before}</span>
            <span className="text-[10px] text-muted-foreground">Without</span>
          </div>
          <span className="text-muted-foreground" aria-hidden>→</span>
          <div className="flex flex-col items-center gap-0.5">
            <span className="flex h-12 w-28 items-center justify-center rounded border bg-background text-2xl" style={g.afterStyle}>{g.after}</span>
            <span className="text-[10px] text-muted-foreground">With</span>
          </div>
          <span className="min-w-0 max-w-40 text-[11px] leading-tight text-muted-foreground">Example: {g.note}</span>
        </>
      )}
    </div>
  )
}

const subs = (text: string) => (text.match(/^\s*sub\s/gm) ?? []).length
/** How many swaps the code has under these feature tags. */
const swapsIn = (code: string, tags: string[]) => tags.reduce((n, t) => n + subs(blockOf(code, t)), 0)
const SHOWN = 14

/**
 * What a font can do while someone types: swap glyphs (ligatures, small capitals, alternates). Each kind is a row:
 * what it is, the glyphs the font has for it (click one to open it), and one click to make or set them up.
 * The font's languages are the same list the glyph grid uses, and setting a row up registers its swaps for all of them.
 * The code behind it (OpenType feature code, compiled by FontForge) is under Advanced. The preview shapes with HarfBuzz.
 */
export function FeaturesView({ font, onChanged, onOpenGlyph }: { font: FontInfo; onChanged: () => void; onOpenGlyph: (name: string) => void }) {
  const [data, setData] = useState<Features | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState(() => localStorage.getItem('forge.featText') ?? 'office fifty 1/2')
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [shaped, setShaped] = useState<Shaped>([])
  const [rev, setRev] = useState(0)  // bump after apply to reshape
  const [testScript, setTestScript] = useState<string>('auto')  // the script the preview text is shaped as; 'auto' lets HarfBuzz guess
  const [newScript, setNewScript] = useState('arab')
  const [newLang, setNewLang] = useState('dflt')
  const { chosen, active, setChosen } = useLanguages(font.familyname, font.glyphs)

  useEffect(() => {
    api<Features>('/api/features').then(d => { setData(d); setCode(d.code) })
      .catch(e => (e as Error).name !== 'AbortError' && setError((e as Error).message))
  }, [font.path])

  const tags = featureTags(data?.code ?? '', data?.gpos_features)
  const isOn = useCallback((t: string) => toggles[t] ?? ON_BY_DEFAULT.has(t), [toggles])

  useEffect(() => {
    localStorage.setItem('forge.featText', text)
    const feats = Object.fromEntries(tags.map(t => [t, isOn(t)]))
    const id = setTimeout(() => {
      api<Shaped>('/api/shape', { text, features: feats, script: scriptOf(testScript)?.iso }).then(setShaped).catch(() => {})
    }, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, toggles, rev, testScript, tags.join()])

  /** Compile this feature code into the font. All or nothing. */
  const applyCode = async (next: string, done?: string) => {
    setBusy(true)
    try {
      const d = await api<Features>('/api/features', { code: next })
      setData(d); setCode(d.code); setError(null); setRev(r => r + 1)
      toast.success(done ?? 'Features applied', { description: `${d.lookups.length} substitution lookups` })
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }
  const apply = () => applyCode(code)

  const names = font.glyphs.map(g => g.name)
  const withAdded = (base: string, add: string) => (add.startsWith('languagesystem') ? add + '\n\n' + base : base.trimEnd() + '\n\n' + add + '\n')
  /** The feature code for the glyphs of this kind that the code does not use yet. */
  const addFor = (k: Kind) => {
    let acc = ''
    for (const id of k.ids) {
      const a = generate(id, names, code + '\n' + acc, active)
      if (a) acc += (acc ? '\n\n' : '') + a
    }
    return acc
  }
  const gen = (k: Generator) => {
    const add = generate(k, names, code, active)
    if (!add) { toast.info('Nothing to add', { description: 'No glyph names that match, or the code already uses them.' }); return }
    setCode(c => withAdded(c, add))
  }
  /** One click: add the swaps for this kind from the glyph names, register them for all the font's languages, and compile. */
  const setUp = (k: Kind) => {
    const add = addFor(k)
    if (add) void applyCode(syncLanguageSystems(withAdded(code, add), active), `${k.title} set up`)
  }
  const tryIt = (k: Kind, on: string[]) => {
    setText(k.sample)
    setToggles(s => ({ ...s, ...Object.fromEntries(on.map(t => [t, true])) }))
  }

  // glyphs to draw, made from the letters the font has: ligatures empty, small capitals as 80% copies of the capitals
  const glyphByCp = new Map(font.glyphs.filter(g => g.unicode >= 0).map(g => [g.unicode, g]))
  const nameOf = (ch: string) => glyphByCp.get(ch.codePointAt(0)!)?.name
  const haveName = new Set(names)
  const ligaItems: NewGlyph[] = ['fi', 'fl', 'ff', 'ffi', 'ffl'].flatMap(w => {
    const parts = [...w].map(nameOf)
    const name = parts.join('_')
    return parts.every(Boolean) && !haveName.has(name) ? [{ name, parts: parts as string[] }] : []
  })
  /** How wide a ligature's letters are together, for an empty one. */
  const ligaWidth = (i: NewGlyph) => (i.parts ?? []).reduce((n, p) => n + (font.glyphs.find(g => g.name === p)?.width ?? 0), 0)
  // ligatures that exist but have nothing drawn: offered the letters side by side
  const emptyLigs: NewGlyph[] = KINDS[0].glyphs(names).flatMap(n => outlines.want(n, null)?.empty ? [{ name: n, parts: n.split('_'), fill: true }] : [])
  const smcpItems: NewGlyph[] = 'abcdefghijklmnopqrstuvwxyz'.split('').flatMap(c => {
    const lower = nameOf(c), upper = nameOf(c.toUpperCase())
    return lower && upper && !haveName.has(`${lower}.sc`) ? [{ name: `${lower}.sc`, base: upper, scale: 0.8 }] : []
  })
  // stylistic sets and the other alternates each have their own box: letters to copy, and what to call the copies
  const [ssLetters, setSsLetters] = useState('a g y')
  const [ssSuffix, setSsSuffix] = useState('ss01')
  const [altLetters, setAltLetters] = useState(ALT_DEFAULT.onum)
  const [altSuffix, setAltSuffix] = useState('onum')
  const copiesOf = (letters: string, suffix: string): NewGlyph[] => [...letters.replace(/\s+/g, '')].flatMap(c => {
    const base = nameOf(c)
    return base && !haveName.has(`${base}.${suffix}`) ? [{ name: `${base}.${suffix}`, base }] : []
  })
  const forms = {
    ss: { letters: ssLetters, setLetters: setSsLetters, suffix: ssSuffix, setSuffix: (v: string) => setSsSuffix(v), options: SS_SUFFIXES, items: copiesOf(ssLetters, ssSuffix) },
    alt: { letters: altLetters, setLetters: setAltLetters, suffix: altSuffix, setSuffix: (v: string) => { setAltSuffix(v); if (ALT_DEFAULT[v]) setAltLetters(ALT_DEFAULT[v]) }, options: ALT_SUFFIXES, items: copiesOf(altLetters, altSuffix) },
  }
  /** Make glyphs to draw. They are copies or empty slots: then the row finds them and offers Set it up. */
  const make = async (items: NewGlyph[], what: string) => {
    if (!items.length) return
    setBusy(true)
    try {
      const r = await api<{ created: string[] }>('/api/make-glyphs', { items })
      onChanged()
      toast.success(`Made ${r.created.length} glyph${r.created.length === 1 ? '' : 's'} to draw`, {
        description: `${r.created.slice(0, 8).join(', ')}${r.created.length > 8 ? ' ...' : ''}. ${what}${font.axes.length ? ' They are in the open master only: copy them to the other masters from the glyph grid (right-click).' : ''}`,
      })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const dirty = data !== null && code !== data.code
  const systems = languageSystems(code)
  const rtl = !!scriptOf(testScript)?.rtl
  // languages the font has that its compiled features are not registered for
  const registered = languageSystems(data?.code ?? '')
  const unregistered = data && data.lookups.length > 0 ? active.filter(t => !registered.some(r => r.script.toLowerCase() === t.toLowerCase())) : []

  useOutlineVersion()
  const ref = useCanvas((ctx, w, h) => {
    const t = theme()
    const size = Math.min(96, h * 0.55)
    const s = size / font.em
    const base = h / 2 + (font.ascent - font.descent) * s / 2
    let x = 16, y = base
    ctx.fillStyle = t.ink
    for (const g of shaped) {
      const o = outlines.want(g.name, null)
      if (x + g.ax * s > w - 16 && x > 16) { x = 16; y += size * 1.3 }
      if (o) {
        ctx.save(); ctx.translate(x + g.dx * s, y - g.dy * s); ctx.scale(s, -s); ctx.fill(o.path); ctx.restore()
      }
      x += g.ax * s
    }
  })

  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)_auto]">
      <div className="min-h-0 overflow-y-auto">
        <div className="space-y-1 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">What your font can do while someone types</h2>
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            A font can swap one glyph for another on the fly: <span className="text-foreground">f</span> then <span className="text-foreground">i</span> can
            show one joined glyph, a lowercase letter can show as a small capital, numbers can turn old-style. You draw the extra glyphs;
            here you tell the font when to use them. None of this is required: a font without any of it works fine.
          </p>
        </div>

        {/* the same list as the glyph grid's Languages view */}
        <div className="space-y-1.5 border-b px-4 py-2.5">
          <LanguageBar font={font} label="Languages" />
          <p className="text-[11px] text-muted-foreground">The swaps below are registered for these languages. The glyph grid uses the same list.</p>
          {unregistered.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-xs">
              <span>Your features are not registered for {unregistered.map(shortName).join(', ')} yet.</span>
              <Button size="xs" disabled={busy} onClick={() => void applyCode(syncLanguageSystems(code, active), 'Features registered for every language')}>Register them</Button>
            </div>
          )}
        </div>

        <div className="space-y-2 p-4">
          {error && (
            <pre className="max-h-32 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-2 font-mono text-xs whitespace-pre-wrap text-destructive">
              {error}{'\n'}Nothing was changed.
            </pre>
          )}
          {KINDS.map(k => {
            const have = k.tags(data?.code ?? '')
            const add = data ? addFor(k) : ''
            const more = subs(add)
            const n = swapsIn(data?.code ?? '', have.filter(t => t !== 'c2sc'))
            const glyphs = k.glyphs(names)
            return (
              <div key={k.id} className="flex items-start gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-sm font-semibold">{k.title}</h3>
                    {have.length > 0
                      ? <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px]">In your font · {n} swap{n === 1 ? '' : 's'}</span>
                      : more > 0
                        ? <span className="rounded-full bg-accent px-2 py-0.5 text-[11px]">{more} swap{more === 1 ? '' : 's'} ready</span>
                        : <span className="text-[11px] text-muted-foreground">Not yet</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{k.what}</p>
                  <Demo font={font} kind={k} tags={have.filter(t => t !== 'c2sc')} glyphs={glyphs} rev={rev} onOpenGlyph={onOpenGlyph} />
                  {glyphs.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-[11px] text-muted-foreground">Your glyphs:</span>
                      {glyphs.slice(0, SHOWN).map(g => (
                        <button key={g} type="button" title={`Open ${g} in the glyph editor`} onClick={() => onOpenGlyph(g)}
                          className="rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent">{g}</button>
                      ))}
                      {glyphs.length > SHOWN && <span className="text-[11px] text-muted-foreground">+{glyphs.length - SHOWN} more, under Alternates in the glyph grid</span>}
                    </div>
                  )}
                  {glyphs.length === 0 && more === 0 && <p className="mt-1 text-xs"><span className="text-muted-foreground">To start: </span>{k.draw}</p>}
                  {/* the glyphs this kind needs, made for you so there is something to draw */}
                  {more === 0 && (k.id === 'ss' || k.id === 'alt') && (() => {
                    const f = forms[k.id]
                    return (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Make copies to redraw of</span>
                        <Input value={f.letters} onChange={e => f.setLetters(e.target.value)} className="h-7 w-36 font-mono" aria-label={`Letters to make ${k.title} copies of`} />
                        <span className="text-muted-foreground">named</span>
                        <Select value={f.suffix} onChange={e => f.setSuffix(e.target.value)} className="h-7 w-24 font-mono" aria-label={`${k.title} kind`}>
                          {f.options.map(sx => <option key={sx}>{sx}</option>)}
                        </Select>
                        <Button size="xs" variant="outline" disabled={busy || !f.items.length} onClick={() => make(f.items, 'Redraw them, then come back and press Set it up.')}
                          title={f.items.map(i => i.name).join(', ') || 'Nothing to make: the letters are not in the font, or the copies exist'}>
                          <Plus />Make {f.items.length || ''}
                        </Button>
                      </div>
                    )
                  })()}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {have.length > 0 && (
                    <>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Preview
                        <Switch checked={have.every(isOn)} label={`Show ${k.title} in the preview`}
                          onCheckedChange={on => setToggles(s => ({ ...s, ...Object.fromEntries(have.map(t => [t, on])) }))} />
                      </label>
                      <Button size="xs" variant="ghost" onClick={() => tryIt(k, have)} title={`Type "${k.sample}" in the preview and switch it on`}>Try it</Button>
                    </>
                  )}
                  {more === 0 && k.id === 'liga' && ligaItems.length > 0 && (
                    <Button size="xs" variant="outline" disabled={busy} onClick={() => make(ligaItems, 'Each starts as its letters side by side, not linked: move the shapes closer and join them into one glyph, then press Set it up.')}
                      title={`Each starts as its letters side by side, as outlines of their own to pull together: ${ligaItems.map(i => i.name).join(', ')}`}><Plus />Make {ligaItems.length} from the letters</Button>
                  )}
                  {more === 0 && k.id === 'liga' && ligaItems.length > 0 && (
                    <Button size="xs" variant="ghost" disabled={busy} onClick={() => make(ligaItems.map(i => ({ name: i.name, width: ligaWidth(i) })), 'They are empty: draw each one, then press Set it up.')}
                      title="The same ligatures, but empty, as wide as their letters, to draw from scratch">Make empty</Button>
                  )}
                  {k.id === 'liga' && emptyLigs.length > 0 && (
                    <Button size="xs" variant="outline" disabled={busy} onClick={() => make(emptyLigs, 'Each now has its letters as outlines to move together and join.')}
                      title={`Puts the letters side by side as outlines in the empty ligatures: ${emptyLigs.map(i => i.name).join(', ')}`}><Wand2 />Fill {emptyLigs.length} empty from the letters</Button>
                  )}
                  {more === 0 && k.id === 'smcp' && smcpItems.length > 0 && (
                    <Button size="xs" variant="outline" disabled={busy} onClick={() => make(smcpItems, 'They start as the capitals at 80%: reshape them, then press Set it up.')}
                      title="Copies of the capitals at 80% size, named a.sc, b.sc ..."><Plus />Make {smcpItems.length} from the capitals</Button>
                  )}
                  {more > 0 && (
                    <Button size="xs" variant={have.length ? 'outline' : 'default'} disabled={busy} onClick={() => setUp(k)}
                      title="Adds these swaps to the font, for all its languages, and compiles it">
                      <Wand2 />{have.length ? `Add ${more} more` : 'Set it up'}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Every glyph made for a swap is in the glyph grid under <span className="text-foreground">Alternates</span>. To see them in text, use Spacing's <span className="text-foreground">Features</span> button, or type <code>/</code> and a glyph name there (for example <code>/f_i</code>).</p>
            <p>Kerning (space between letter pairs) is in Spacing, and where accents sit is in Accents.</p>
          </div>
        </div>

        <details className="border-t px-4 py-2 text-xs">
          <summary className="flex cursor-pointer select-none items-center gap-1 font-medium">
            <ChevronRight className="size-3.5 transition-transform [details[open]_&]:rotate-90" />Advanced: feature code and exact script and language tags
          </summary>
          <div className="mt-3 space-y-3">
            <p className="max-w-3xl leading-relaxed text-muted-foreground">
              Everything above is written as OpenType feature code, which you can edit directly for anything the rows don't cover. Each feature is
              registered for the language systems below (<code>DFLT{'{'}dflt{'}'}</code> any script, <code>arab{'{'}dflt{'}'}</code> Arabic,
              <code> latn{'{'}TRK{'}'}</code> Latin as written in Turkish). Adding a script here also adds it to the font's languages above.
            </p>

            <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1.5">
              <span className="font-medium" title="Every feature is registered for each script and language listed here. Apply to make it part of the font.">Language systems</span>
              {systems.map(sys => (
                <span key={`${sys.script}-${sys.lang}`} title={`${scriptName(sys.script)}${sys.lang === 'dflt' ? ', every language' : `, language ${sys.lang}`}`}
                  className="flex items-center gap-0.5 rounded border bg-background py-0.5 pl-1.5 pr-0.5 font-mono">
                  {sys.script}{'{'}{sys.lang}{'}'}
                  <button type="button" aria-label={`Remove ${sys.script}{${sys.lang}}`} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => setCode(c => removeLanguageSystem(c, sys))}><X className="size-3" /></button>
                </span>
              ))}
              <Popover.Root>
                <Popover.Trigger asChild><Button size="xs" variant="outline"><Plus />Add</Button></Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content align="start" sideOffset={6} className="z-50 w-80 space-y-2 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md">
                    <p className="text-muted-foreground">Add one, then Apply: the features you have are registered under it too.</p>
                    <label className="flex items-center gap-2"><span className="w-14 shrink-0">Script</span>
                      <Select value={newScript} onChange={e => setNewScript(e.target.value)} className="h-7">
                        {SCRIPTS.map(sc => <option key={sc.tag} value={sc.tag}>{sc.tag} · {sc.name}</option>)}
                      </Select></label>
                    <label className="flex items-center gap-2"><span className="w-14 shrink-0">Language</span>
                      <Input list="forge-langs" value={newLang} onChange={e => setNewLang(e.target.value.trim())} className="h-7 font-mono" aria-label="Language tag" />
                      <datalist id="forge-langs">{LANGUAGES.map(([t, nm]) => <option key={t} value={t}>{nm}</option>)}</datalist></label>
                    <div className="flex items-center gap-2">
                      <span className="flex-1 font-mono text-muted-foreground">{newScript}{'{'}{newLang || 'dflt'}{'}'}</span>
                      <Popover.Close asChild>
                        <Button size="xs" disabled={!/^\w{3,4}$/.test(newLang || 'dflt')} onClick={() => {
                          setCode(c => addLanguageSystem(c, { script: newScript, lang: newLang || 'dflt' }))
                          if (BLOCKS[newScript] && !active.includes(newScript)) setChosen([...chosen, newScript])  // the font's languages follow
                        }}>Add</Button>
                      </Popover.Close>
                    </div>
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
              {!systems.length && <span className="text-muted-foreground">None declared yet: setting up a row adds one for each of the font's languages.</span>}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Wand2 className="size-3.5 text-muted-foreground" />
              <Button size="xs" variant="secondary" title="Everything from the rows at once, plus aalt. Only adds glyphs the code does not use yet." onClick={() => gen('all')}>Generate all from glyph names</Button>
              <Button size="xs" variant="outline" title="Access All Alternates: lists the alternate features the code defines" onClick={() => gen('aalt')}>aalt</Button>
              <span className="flex-1" />
              <span className="text-muted-foreground">{data ? `${data.lookups.length} lookups` : 'Loading…'}</span>
              <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => { setCode(data!.code); setError(null) }}><RotateCcw />Revert</Button>
              <Button size="sm" onClick={apply} disabled={busy || !dirty}><Check />Apply <Kbd>Ctrl ↵</Kbd></Button>
            </div>
            <CodeEditor value={code} onChange={setCode} onRun={() => { if (dirty) void apply() }} indent={2} label="Feature code" className="h-72 rounded-md" />
            {tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Switch features on and off in the preview:</span>
                {tags.map(tag => (
                  <button key={tag} onClick={() => setToggles(s => ({ ...s, [tag]: !isOn(tag) }))} aria-pressed={isOn(tag)}
                    className={`rounded border px-1.5 py-0.5 font-mono ${isOn(tag) ? 'border-primary bg-primary/15 text-foreground' : 'text-muted-foreground'}`}>
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        </details>
      </div>

      <div className="border-t">
        <div className="flex flex-wrap items-center gap-2 p-2 text-xs">
          <span className="font-medium">Try it</span>
          <Input value={text} onChange={e => setText(e.target.value)} className="h-7 w-64" aria-label="Preview text" dir={rtl ? 'rtl' : 'auto'} />
          <Select value={testScript} onChange={e => { const v = e.target.value; setTestScript(v); const sm = scriptOf(v)?.sample; if (sm) setText(sm) }}
            className="h-7 w-44" aria-label="Preview script" title="Type any text. Pick a script to try its sample text, shaped as that script (Arabic joins and runs right to left)">
            <option value="auto">Script: guess from text</option>
            {SCRIPTS.filter(sc => sc.sample).map(sc => <option key={sc.tag} value={sc.tag}>{sc.name}</option>)}
          </Select>
          {dirty && <span className="ml-auto text-muted-foreground">Preview shows the applied features</span>}
        </div>
        <div className="relative h-36"><canvas ref={ref} className="absolute inset-0 size-full" /></div>
      </div>
    </div>
  )
}
