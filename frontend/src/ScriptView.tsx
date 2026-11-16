import { useState } from 'react'
import { Play } from 'lucide-react'
import { api } from './api'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { CodeEditor } from './CodeEditor'

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
  const [code, setCode] = useState(() => localStorage.getItem('scrifts.script') ?? EXAMPLES['Ligature from two glyphs'])
  const [out, setOut] = useState<{ output: string; error: string | null; ms: number } | null>(null)
  const [running, setRunning] = useState(false)
  // the last 'line N' Python names in an error is, for a script run as one block, the line of the script itself
  const errorLine = out?.error ? [...out.error.matchAll(/line (\d+)/g)].map(m => +m[1]).at(-1) ?? null : null

  const runScript = async () => {
    localStorage.setItem('scrifts.script', code)
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
      <CodeEditor value={code} onChange={setCode} onRun={runScript} label="Python script" className="flex-1 rounded-none border-0 border-b" errorLine={errorLine} />
      {/* the console: what print() wrote, one numbered line each, then how it went */}
      <div className="max-h-[40%] min-h-24 overflow-auto bg-card py-1 font-mono text-[11px] leading-5">
        {!out && <p className="px-3 text-muted-foreground">
          <span className="select-none">{'>'} </span>`font`, `fontforge` and `psMat` are predefined; print() shows here. Scripts can't be undone: Save when happy.
        </p>}
        {out && <>
          <p className="px-3 text-muted-foreground"><span className="select-none">{'>'} </span>{running ? 'running' : out.error ? 'failed' : 'done'} in {out.ms} ms</p>
          {(out.output ? out.output.replace(/\n$/, '').split('\n') : []).map((l, i) => (
            <div key={i} className="flex whitespace-pre-wrap px-3 hover:bg-accent/30">
              <span className="w-8 shrink-0 select-none pr-3 text-right text-muted-foreground">{i + 1}</span><span>{l}</span>
            </div>
          ))}
          {out.error && <pre className="whitespace-pre-wrap px-3 text-destructive">{out.error}</pre>}
        </>}
      </div>
    </div>
  )
}
