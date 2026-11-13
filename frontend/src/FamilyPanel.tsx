import { useEffect, useMemo, useState } from 'react'
import { Layers, Loader2, Pause, Play, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { AxisTicks, FPS } from './VariableBar'
import { NumField } from './NumField'
import { samePath, type Check, type Family, type Master } from './FamilyBar'

/**
 * The Axes panel of a family of masters (the counterpart of the variable-font panel): the same sliders, ticks and Play, with the
 * masters as the places the family was drawn. Sharing its state with the family bar above the views.
 */
export function FamilyPanel({ family, current, weight, onWeight, axisVals, onAxis, onSwitch, onAddHere, onAddAxis, onAddMaster, check, onCheck, busy }: {
  family: Family; current: string
  weight: number | null; onWeight: (w: number | null) => void
  axisVals: Record<string, number>; onAxis: (name: string, v: number) => void
  onSwitch: (m: Master) => void; onAddHere: () => void; onAddAxis: () => void; onAddMaster: () => void
  check: Check | null; onCheck: () => void; busy: boolean
}) {
  const ax = family.axes[0]
  const extra = family.axes.slice(1)
  const at = (name: string) => axisVals[name] ?? family.axes.find(a => a.name === name)!.default
  const here = weight ?? ax?.default ?? 0
  const between = weight !== null && !family.masters.some(m => family.axes.every(a => (m.location[a.name] ?? a.default) === (a.name === ax.name ? here : at(a.name))))
  // play: the weight sweeps from end to end and back in 4 seconds, FPS steps a second
  const [playing, setPlaying] = useState(false)
  const frames = useMemo(() => {
    if (!ax || ax.max <= ax.min) return []
    const half = 2 * FPS
    return Array.from({ length: 2 * half }, (_, i) => Math.round(ax.min + (ax.max - ax.min) * (i <= half ? i / half : (2 * half - i) / half)))
  }, [ax])
  useEffect(() => {
    if (!playing || !frames.length) return
    let i = 0
    const id = window.setInterval(() => {
      if (i >= frames.length) { window.clearInterval(id); onWeight(null); setPlaying(false); return }
      onWeight(frames[i++])
    }, 1000 / FPS)
    return () => window.clearInterval(id)
  }, [playing, frames, onWeight])
  const slider = (name: string, label: string, min: number, max: number, value: number, set: (n: number) => void, drawn: number[], steps: number[]) => (
    <div key={name} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span>{label}</span>
        <div className="w-36"><NumField hideLabel buttons label={label} min={min} max={max} value={Math.round(value)} onCommit={n => set(Math.round(n))} /></div>
      </div>
      <Slider min={min} max={max} step={1} value={[value]} onValueChange={v => set(v[0])} />
      <AxisTicks axis={{ tag: name, min, max }} drawn={drawn} steps={steps} />
    </div>
  )
  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto border-l bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Axes</span>
        <div className="flex items-center gap-1">
          {family.masters.length > 1 && <Button size="icon-xs" variant={playing ? 'secondary' : 'ghost'} aria-pressed={playing} aria-label={playing ? 'Stop the animation' : 'Play: sweep the weight'}
            title={playing ? 'Stop' : 'Play: watch the shapes change from the lightest to the heaviest and back'} onClick={() => setPlaying(p => !p)}>{playing ? <Pause /> : <Play />}</Button>}
          <Button size="xs" variant="ghost" onClick={() => { setPlaying(false); onWeight(null) }}><RotateCcw />Default</Button>
        </div>
      </div>
      {ax && family.masters.length > 1 ? (
        <div className="flex flex-col gap-4 p-3">
          {slider(ax.name, ax.name, ax.min, ax.max, here, n => onWeight(n), family.masters.map(m => m.location[ax.name] ?? ax.default), playing ? frames : [])}
          {extra.map(a => slider(a.name, a.name, a.min, a.max, at(a.name), n => { if (weight === null) onWeight(ax.default); onAxis(a.name, n) }, family.masters.map(m => m.location[a.name] ?? a.default), []))}
        </div>
      ) : <p className="p-3 text-[11px] leading-snug text-muted-foreground">With a second master, the weight between the two can be previewed here.</p>}
      <div className="flex flex-col gap-1.5 border-t p-3">
        <span className="text-xs font-medium text-muted-foreground">Masters</span>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Every master is an editable font of its own. Scrifts blends them for every weight in between, so a change to a master
          shows up across the whole range.
        </p>
        <div className="flex flex-wrap gap-1">
          {family.masters.map(m => (
            <Button key={m.path} size="xs" variant={samePath(m.path, current) ? 'secondary' : 'outline'} disabled={busy}
              onClick={() => !samePath(m.path, current) && onSwitch(m)} title={samePath(m.path, current) ? 'The master you are editing' : 'Edit this master'}>
              {m.name} <span className="font-mono opacity-60">{m.weight}</span>
            </Button>
          ))}
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-1.5 border-t p-3">
        <span className="mb-1 text-xs font-medium text-muted-foreground">Add</span>
        <Button size="sm" variant="secondary" onClick={onAddMaster} disabled={busy}><Plus />Add a master…</Button>
        <Button size="sm" variant="secondary" onClick={onAddHere} disabled={busy || !between}
          title={between ? 'Make a master from the blend at this weight, to adjust by hand' : 'Move the slider to a weight that has no master'}><Layers />Add master here</Button>
        <Button size="sm" variant="ghost" onClick={onAddAxis} disabled={busy}>+ Axis (width, optical size…)</Button>
        <button onClick={onCheck} className="flex items-center gap-1.5 self-start text-[11px] text-muted-foreground hover:text-foreground"
          title="Can the masters be blended? Every glyph needs the same contours and points in every master.">
          {!check ? <><Loader2 className="size-3 animate-spin" />Checking the masters</>
            : check.glyphs.length ? <span className="text-destructive">{check.glyphs.length} glyph{check.glyphs.length > 1 ? 's' : ''} don&apos;t match: see which</span> : 'The masters blend'}
        </button>
        <span className="text-[11px] leading-snug text-muted-foreground">Make the variable font or static fonts from these masters with File → Generate Fonts…</span>
      </div>
    </aside>
  )
}
