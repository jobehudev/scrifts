import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, RotateCcw, Wand2 } from 'lucide-react'
import { api, outlines, type FontInfo } from './api'
import { theme, useCanvas, useOutlineVersion } from './canvas'
import { featureTags, generate, ON_BY_DEFAULT, type Generator } from './features'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'

type Features = { code: string; lookups: { name: string; type: string; features: string[] }[]; gpos_features: string[] }
type Shaped = { name: string; cluster: number; ax: number; dx: number; dy: number }[]

const GENERATORS: [Generator, string, string][] = [
  ['all', 'Generate all from glyph names', 'Everything below at once, plus aalt. Only adds glyphs the code does not use yet.'],
  ['liga', 'Ligatures', 'f_f_i, f_i ... from the parts that exist'],
  ['smcp', 'Small caps', 'a -> a.sc'],
  ['c2sc', 'Caps to small caps', 'A -> a.sc'],
  ['ss', 'Stylistic sets', 'g.ss01 ... g.ss20'],
  ['alt', 'Alternates', '.onum .lnum .tnum .pnum .case .zero .sups .sinf .subs .swsh .salt .hist .titl'],
  ['aalt', 'aalt', 'Access All Alternates: lists the alternate features the code defines'],
]

/**
 * OpenType substitutions as feature code, compiled by FontForge. Apply is all
 * or nothing; the preview shapes with HarfBuzz using the font as applied.
 * Positioning (kerning, marks) is edited in Spacing and Anchors.
 */
export function FeaturesView({ font }: { font: FontInfo }) {
  const [data, setData] = useState<Features | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState(() => localStorage.getItem('forge.featText') ?? 'office fifty 1/2')
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [shaped, setShaped] = useState<Shaped>([])
  const [rev, setRev] = useState(0)  // bump after apply to reshape

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
      api<Shaped>('/api/shape', { text, features: feats }).then(setShaped).catch(() => {})
    }, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, toggles, rev, tags.join()])

  const apply = async () => {
    setBusy(true)
    try {
      const d = await api<Features>('/api/features', { code })
      setData(d); setCode(d.code); setError(null); setRev(r => r + 1)
      toast.success('Features applied', { description: `${d.lookups.length} substitution lookups` })
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  const gen = (k: Generator) => {
    const add = generate(k, font.glyphs.map(g => g.name), code)
    if (!add) { toast.info('Nothing to add', { description: 'No glyph names that match, or the code already uses them.' }); return }
    setCode(c => (add.startsWith('languagesystem') ? add + '\n\n' + c : c.trimEnd() + '\n\n' + add + '\n'))
  }

  const dirty = data !== null && code !== data.code

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
      <div className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-1.5 border-b p-2 text-xs">
          <Wand2 className="size-3.5 text-muted-foreground" />
          {GENERATORS.map(([k, label, hint]) => (
            <Button key={k} size="xs" variant={k === 'all' ? 'secondary' : 'outline'} title={hint} onClick={() => gen(k)}>{label}</Button>
          ))}
          <span className="flex-1" />
          <span className="text-muted-foreground">{data ? `${data.lookups.length} lookups` : 'Loading…'}</span>
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => { setCode(data!.code); setError(null) }}><RotateCcw />Revert</Button>
          <Button size="sm" onClick={apply} disabled={busy || !dirty}><Check />Apply <Kbd>Ctrl ↵</Kbd></Button>
        </div>
        <details className="border-b px-3 py-1.5 text-[11px] leading-snug text-muted-foreground" open={localStorage.getItem('forge.featuresHelp') !== 'seen'}
          onToggle={e => { if (!e.currentTarget.open) localStorage.setItem('forge.featuresHelp', 'seen') }}>
          <summary className="cursor-pointer font-medium text-foreground">What are features? (click to fold)</summary>
          <p className="mt-1">
            A font can swap one glyph for another while someone types. Those swaps are <b>features</b>. Drawing the extra glyphs is your job;
            this page tells the font <i>when</i> to use them.
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li><b>Ligatures</b>: draw a glyph called <code>f_i</code>; the rule <code>sub f i by f_i;</code> makes typing f then i show it.</li>
            <li><b>Small caps</b>: draw <code>a.sc</code>, and a becomes a small capital when the user turns small caps on.</li>
            <li><b>Alternates</b>: a dot and a code in the name says what a glyph is for: <code>.onum</code> old-style figures, <code>.tnum</code> tabular figures, <code>.ss01</code> stylistic set 1, <code>.salt</code> a plain alternate.</li>
          </ul>
          <p className="mt-1">
            Easiest path: draw the glyphs with those names, press <b>Generate all from glyph names</b>, then <b>Apply</b>. Type in the preview box
            at the bottom and switch features on and off to see them work. Kerning is in Spacing, accent placement in Accents.
          </p>
        </details>
        <Textarea value={code} onChange={e => setCode(e.target.value)} spellCheck={false}
          aria-label="Feature code"
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (dirty) apply() }
            if (e.key === 'Tab') {
              e.preventDefault()
              const el = e.currentTarget, a = el.selectionStart
              setCode(c => c.slice(0, a) + '  ' + c.slice(el.selectionEnd))
              requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2 })
            }
          }}
          className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-xs leading-relaxed focus-visible:ring-0" />
        {error && (
          <pre className="max-h-32 overflow-auto border-t bg-destructive/10 p-2 font-mono text-xs whitespace-pre-wrap text-destructive">
            {error}{'\n'}Nothing was changed.
          </pre>
        )}
      </div>

      <div className="border-t">
        <div className="flex flex-wrap items-center gap-1 p-2 text-xs">
          <Input value={text} onChange={e => setText(e.target.value)} className="h-7 w-64" aria-label="Preview text" />
          {tags.map(tag => (
            <button key={tag} onClick={() => setToggles(s => ({ ...s, [tag]: !isOn(tag) }))}
              aria-pressed={isOn(tag)}
              className={`rounded border px-1.5 py-0.5 font-mono ${isOn(tag) ? 'border-primary bg-primary/15 text-foreground' : 'text-muted-foreground'}`}>
              {tag}
            </button>
          ))}
          {dirty && <span className="ml-auto text-muted-foreground">Preview shows the applied features</span>}
        </div>
        <div className="relative h-36"><canvas ref={ref} className="absolute inset-0 size-full" /></div>
        <div className="truncate px-2 pb-2 font-mono text-[11px] text-muted-foreground" title={shaped.map(g => g.name).join(' ')}>
          {shaped.map(g => g.name).join(' ')}
        </div>
      </div>
    </div>
  )
}
