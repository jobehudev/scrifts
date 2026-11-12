import { useState } from 'react'
import { Play } from 'lucide-react'
import { api } from './api'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'

const EXAMPLES: Record<string, string> = {
  'Ligature from two glyphs': `# Combine f + f into an f_f ligature made of references.
a, b = font['f'], font['f']
g = font.createChar(-1, 'f_f')
g.clear()
g.addReference(a.glyphname)
g.addReference(b.glyphname, psMat.translate(a.width, 0))
g.width = a.width + b.width
print('built', g.glyphname, 'width', g.width)`,
  'Build accented Latin-1': `# FontForge's Build Accented for À..ÿ: composites from Unicode decomposition.
built = []
for cp in range(0xC0, 0x100):
    g = font.createChar(cp)
    if not len(g.foreground) and not g.references:
        g.build()
        if g.references:
            built.append(g.glyphname)
print(len(built), 'built:', ' '.join(built))`,
  'Slant every glyph': `# Oblique: skew all glyphs 12 degrees (undo with a -12 run).
import math
m = psMat.skew(math.radians(12))
for g in font.glyphs():
    g.transform(m)
print('skewed', sum(1 for _ in font.glyphs()), 'glyphs')`,
  'Bolder / lighter every glyph': `# Thicker (positive) or thinner (negative) stems for the whole open master, no point added or removed,
# so it still interpolates with the other masters. DELTA is the total change of a stem in font units.
import weight
DELTA = 20
n = 0
for g in font.glyphs():
    layer = g.foreground
    for ci in range(len(layer)):
        c = layer[ci]
        pts = [[p.x, p.y, 1 if p.on_curve else 0] for p in c]
        moved = False
        for pi, (dx, dy) in enumerate(weight.offsets(pts, bool(c.closed), DELTA)):
            if dx or dy:
                p = c[pi]
                p.x = round(p.x + dx)
                p.y = round(p.y + dy)
                c[pi] = p
                moved = True
        if moved:
            layer[ci] = c
    g.foreground = layer
    n += 1
print('changed', n, 'glyphs by', DELTA)`,
  'Report empty glyphs': `# Glyphs with no outline and no components.
empty = [g.glyphname for g in font.glyphs()
         if not len(g.foreground) and not g.references and g.glyphname not in ('space', '.notdef')]
print(len(empty), 'empty:', ' '.join(empty[:200]))`,
}

/**
 * Python against the open font, as FontForge's Execute Script does:
 * `font`, `fontforge` and `psMat` are predefined. Runs in the FontForge
 * worker; scripts are not undoable, so Save only when happy.
 */
export function ScriptView({ onChanged }: { onChanged: () => void }) {
  const [code, setCode] = useState(() => localStorage.getItem('forge.script') ?? EXAMPLES['Ligature from two glyphs'])
  const [out, setOut] = useState<{ output: string; error: string | null; ms: number } | null>(null)
  const [running, setRunning] = useState(false)

  const runScript = async () => {
    localStorage.setItem('forge.script', code)
    setRunning(true)
    const t0 = performance.now()
    try {
      const r = await api<{ output: string; error: string | null }>('/api/script', { code })
      setOut({ ...r, ms: Math.round(performance.now() - t0) })
      onChanged()  // scripts can add, remove or reshape any glyph
    } catch (e) {
      setOut({ output: '', error: (e as Error).message, ms: Math.round(performance.now() - t0) })
    } finally { setRunning(false) }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b p-2 text-xs">
        <span className="text-muted-foreground">Examples</span>
        {Object.keys(EXAMPLES).map(k => (
          <Button key={k} size="xs" variant="outline" onClick={() => setCode(EXAMPLES[k])}>{k}</Button>
        ))}
        <span className="flex-1" />
        <Button size="sm" onClick={runScript} disabled={running}><Play />Run <Kbd>Ctrl ↵</Kbd></Button>
      </div>
      <Textarea value={code} onChange={e => setCode(e.target.value)} spellCheck={false}
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runScript() }
          if (e.key === 'Tab') {  // indent instead of leaving the editor
            e.preventDefault()
            const el = e.currentTarget, a = el.selectionStart
            setCode(c => c.slice(0, a) + '    ' + c.slice(el.selectionEnd))
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 4 })
          }
        }}
        className="min-h-0 flex-1 resize-none rounded-none border-0 font-mono text-xs leading-relaxed focus-visible:ring-0" />
      <div className="max-h-[40%] min-h-24 overflow-auto border-t bg-card p-2 font-mono text-[11px] whitespace-pre-wrap">
        {!out && <span className="text-muted-foreground">
          `font`, `fontforge` and `psMat` are predefined; print() shows here. Scripts can't be undone: Save when happy.
        </span>}
        {out && <>
          <span className="text-muted-foreground">{out.error ? 'failed' : 'done'} in {out.ms} ms{'\n'}</span>
          {out.output}
          {out.error && <span className="text-destructive">{out.error}</span>}
        </>}
      </div>
    </div>
  )
}
