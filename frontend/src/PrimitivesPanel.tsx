import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api, contourPath, outlines, type FontInfo, type Points } from './api'
import { theme } from './canvas'
import { defaults, PRIMITIVES, type Params, type Primitive } from './primitives'
import { useSettings } from './settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** A small drawing of what Insert will add, in the current theme's colours. */
function Preview({ prim, p }: { prim: Primitive; p: Params }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { theme: mode, custom } = useSettings()
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1, S = 56
    c.width = c.height = S * dpr
    const ctx = c.getContext('2d')!
    const shapes = prim.make(p)
    const xs = shapes.flatMap(s => s.points.map(q => q[0])), ys = shapes.flatMap(s => s.points.map(q => q[1]))
    const w = Math.max(...xs) - Math.min(...xs) || 1, h = Math.max(...ys) - Math.min(...ys) || 1
    const k = (S - 12) / Math.max(w, h)
    ctx.setTransform(dpr * k, 0, 0, -dpr * k, dpr * (S / 2 - (Math.min(...xs) + w / 2) * k), dpr * (S / 2 + (Math.min(...ys) + h / 2) * k))
    ctx.fillStyle = theme().ink
    const path = new Path2D()
    for (const s of shapes) path.addPath(contourPath([s.points], [s.closed], false))
    ctx.fill(path, 'nonzero')
  }, [prim, p, mode, custom])
  return <canvas ref={ref} style={{ width: 56, height: 56 }} className="shrink-0 rounded-md border bg-background" aria-hidden />
}

/**
 * Starting shapes for a letter: a stem, a bar, a bowl, a serif. Each is drawn at the size you give (the
 * defaults come from this font's own x-height and weight), then edited like anything else.
 */
export function PrimitivesPanel({ font, sel, editable, onChanged }: { font: FontInfo; sel: string | null; editable: boolean; onChanged: () => void }) {
  const d = defaults(font.em, font.xheight, font.capheight)
  const [id, setId] = useState('stem')
  const [v, setV] = useState({ x: d.x, y: d.y, width: d.width, height: d.height, thickness: d.thickness })
  const [busy, setBusy] = useState(false)
  const prim = PRIMITIVES.find(p => p.id === id)!
  const set = (k: keyof typeof v, n: number) => setV(s => ({ ...s, [k]: Number.isFinite(n) ? n : 0 }))

  const insert = async () => {
    if (!sel) return
    setBusy(true)
    try {
      let last: Points | null = null
      for (const c of prim.make(v)) last = await api<Points>('/api/edit', { name: sel, kind: 'add_contour', args: { points: c.points, closed: c.closed } })
      if (last) { outlines.putPoints(last); outlines.put(last, null); outlines.invalidateUsers(sel) }
      onChanged()
      toast.success(`${prim.name} added to ${sel}`, { description: 'Ctrl Z in the editor takes it back.' })
    } catch (e) {
      toast.error('Could not add the shape', { description: (e as Error).message })
    } finally { setBusy(false) }
  }

  const field = (k: keyof typeof v, label: string) => (
    <label key={k} className="grid gap-0.5">{label}
      <Input type="number" className="h-7 font-mono" value={v[k]} onChange={e => set(k, +e.target.value)} />
    </label>
  )
  const sizes = [['x-height', d.xh], ['cap height', d.cap], ['em', font.em]] as const

  return (
    <div className="h-full overflow-y-auto text-xs">
      <section className="grid grid-cols-2 gap-1.5 border-b p-3">
        {PRIMITIVES.map(p => (
          <button key={p.id} type="button" onClick={() => setId(p.id)} aria-pressed={p.id === id} title={p.hint}
            className={`flex items-center gap-2 rounded-md border p-1.5 text-left hover:bg-accent ${p.id === id ? 'border-primary bg-accent' : ''}`}>
            <Preview prim={p} p={{ ...v, x: 0, y: 0 }} />
            <span className="font-medium">{p.name}</span>
          </button>
        ))}
      </section>
      <section className="space-y-2 p-3">
        <p className="text-muted-foreground">{prim.hint}.</p>
        <div className="grid grid-cols-2 gap-2">
          {field('x', 'From left (x)')}
          {field('y', 'From baseline (y)')}
          {prim.uses.includes('width') && field('width', 'Width')}
          {prim.uses.includes('height') && field('height', 'Height')}
          {prim.uses.includes('thickness') && field('thickness', 'Thickness')}
        </div>
        {prim.uses.includes('height') && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground">Height of</span>
            {sizes.map(([label, n]) => <Button key={label} size="xs" variant="outline" onClick={() => set('height', n)}>{label} {n}</Button>)}
          </div>
        )}
        <Button size="sm" className="w-full" disabled={!sel || !editable || busy} onClick={() => void insert()}>
          {sel ? `Add ${prim.name.toLowerCase()} to ${sel}` : 'Select a glyph first'}
        </Button>
        {!editable && sel && <p className="text-muted-foreground">Move the axes back to their defaults to draw.</p>}
      </section>
    </div>
  )
}
