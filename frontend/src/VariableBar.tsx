import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, Loader2, Pause, Play } from 'lucide-react'
import { api, outlines, type FontInfo, type Location } from './api'
import { Button } from '@/components/ui/button'
import { NumField } from './NumField'

export type Keyframe = { name: string; location: Location }

/**
 * The state of a variable font's axes, shared by the bar above the views and the Axes panel: where each axis sits, the
 * places the font was drawn at (its keyframes: the masters "Edit as masters" would make), and the play sweep.
 * `onLocation` hears the position the views should draw at (null = the default), after the sliders rest a moment.
 */
export const FPS = 12  // the sliders and Play move at this rate: each step is a request, and a drawing that only has to be right twelve times a second is enough

export function useVariableState(font: FontInfo | null, onLocation: (l: Location | null) => void) {
  const axes = font?.axes ?? []
  const defaults = useMemo(() => Object.fromEntries(axes.map(a => [a.tag, a.default])) as Location, [font]) // eslint-disable-line react-hooks/exhaustive-deps
  const [values, setValuesRaw] = useState<Location>(defaults)
  const [playing, setPlaying] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [keyframes, setKeyframes] = useState<Keyframe[]>([])
  const instant = useRef(false)
  /** A slider drag: the views follow at FPS. */
  const setValues = (u: Location | ((v: Location) => Location)) => setValuesRaw(u)
  /** Typed, stepped with the buttons or picked from a list: the views follow at once. */
  const setValuesNow = (u: Location | ((v: Location) => Location)) => { instant.current = true; setValuesRaw(u) }
  const cancel = useRef({ cancelled: false })
  const stop = () => { cancel.current.cancelled = true; setPlaying(false); setPreparing(false) }
  useEffect(() => { stop(); instant.current = true; setValuesRaw(defaults) }, [defaults])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setKeyframes([])
    if (font?.axes.length) api<Keyframe[]>('/api/variable/keyframes').then(setKeyframes).catch(() => {})
  }, [font?.path])  // eslint-disable-line react-hooks/exhaustive-deps
  /** What the views draw at: whole numbers on wide axes, so going back and forth reuses what was fetched; null at the default. */
  const toLocation = (v: Location): Location | null => {
    const at = Object.fromEntries(axes.map(a => { const x = v[a.tag] ?? a.default; return [a.tag, a.max - a.min > 20 ? Math.round(x) : Math.round(x * 100) / 100] })) as Location
    return axes.every(a => Math.abs(at[a.tag] - a.default) < 1e-6) ? null : at
  }
  const applied = useRef(0)
  useEffect(() => {
    if (!axes.length) return
    const wait = instant.current || playing ? 0 : Math.max(0, 1000 / FPS - (performance.now() - applied.current))
    const t = window.setTimeout(() => { instant.current = false; applied.current = performance.now(); onLocation(toLocation(values)) }, wait)
    return () => window.clearTimeout(t)
  }, [values, defaults, playing])  // eslint-disable-line react-hooks/exhaustive-deps
  // play: the first axis (weight, when there is one) sweeps from one end to the other and back in 4 seconds at FPS. First every
  // position on the way is fetched for what is on screen, so the sweep itself only reads what is cached.
  const a0 = axes.find(a => a.tag === 'wght') ?? axes[0]
  const lo = a0?.min ?? 0, hi = a0?.max ?? 0
  const frames = useMemo(() => {
    if (!a0 || hi <= lo) return []
    const half = 2 * FPS  // up for two seconds, down for two: even steps, so the ticks under the slider are evenly spaced
    return Array.from({ length: 2 * half }, (_, i) => Math.round(lo + (hi - lo) * (i <= half ? i / half : (2 * half - i) / half)))
  }, [a0, lo, hi])
  const togglePlay = async () => {
    if (playing || preparing) { stop(); return }
    if (!a0 || !frames.length) return
    const token = cancel.current = { cancelled: false }
    setPreparing(true)
    const spots = [...new Set(frames)].map(w => toLocation({ ...values, [a0.tag]: w })).filter((l): l is Location => !!l)
    try { await outlines.prefetch(spots, token) } catch { /* play anyway: it fetches what is missing as it goes */ }
    if (token.cancelled) return
    setPreparing(false); setPlaying(true)
  }
  useEffect(() => {
    if (!playing || !a0 || !frames.length) return
    let i = 0
    const id = window.setInterval(() => {
      if (i >= frames.length) { window.clearInterval(id); setValuesRaw(v => ({ ...v, [a0.tag]: a0.default })); setPlaying(false); return }  // one round trip, then it rests
      const w = frames[i++]
      setValuesRaw(v => ({ ...v, [a0.tag]: w }))
    }, 1000 / FPS)
    return () => window.clearInterval(id)
  }, [playing, a0, frames])
  return { values, setValues, setValuesNow, defaults, playing, preparing, togglePlay, stop, keyframes, canPlay: !!a0 && hi > lo, steps: [...new Set(frames)], stepTag: a0?.tag ?? '' }
}
export type VariableState = ReturnType<typeof useVariableState>

/**
 * Tick marks under an axis slider, kept quiet: a hairline on every round number (every 100 on a wide axis), a taller accent
 * mark where the font was drawn (`drawn`), and while Play runs a faint dot for each position it steps through (`steps`).
 */
export function AxisTicks({ axis, drawn, steps }: { axis: { tag: string; min: number; max: number }; drawn: number[]; steps: number[] }) {
  const span = axis.max - axis.min
  if (span <= 0) return null
  const at = (v: number) => `calc(8px + (100% - 16px) * ${(v - axis.min) / span})`  // the thumb is 16 px wide: its centre never reaches the ends
  const big: number[] = []
  if (span >= 300) for (let v = Math.ceil(axis.min / 100) * 100; v <= axis.max; v += 100) big.push(v)
  const small = steps.filter(v => !big.includes(v) && !drawn.includes(v))
  return (
    <div aria-hidden className="pointer-events-none relative h-2.5 w-full">
      {small.map(v => <span key={'s' + v} className="absolute top-0 h-1 w-px -translate-x-1/2 bg-muted-foreground/35" style={{ left: at(v) }} />)}
      {big.filter(v => !drawn.includes(v)).map(v => <span key={'b' + v} className="absolute top-0 h-1.5 w-px -translate-x-1/2 bg-muted-foreground/50" style={{ left: at(v) }} />)}
      {drawn.map(v => <span key={'d' + v} className="absolute top-0 h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-primary" style={{ left: at(v) }} />)}
    </div>
  )
}

export const atKeyframe = (vv: VariableState, k: Keyframe) => Object.entries(vv.defaults).every(([t, d]) => Math.abs((vv.values[t] ?? d) - (k.location[t] ?? d)) < 0.5)

/** Above the views of a variable font, where a family's masters would be: where the font was drawn, the sliders, play, and the way to edit it. */
export function VariableBar({ font, vv, onSplit, busy }: { font: FontInfo; vv: VariableState; onSplit: () => void; busy: boolean }) {
  const { values, setValues, setValuesNow, defaults, playing, preparing, togglePlay, keyframes, canPlay } = vv
  return (
    <div className="flex flex-wrap items-stretch border-b bg-muted/30 text-xs">
      <div role="tablist" aria-label="Where this variable font was drawn" className="flex min-w-0 max-w-full items-stretch overflow-x-auto border-r">
        <span className="flex h-7 shrink-0 items-center whitespace-nowrap border-r px-3 text-muted-foreground"
          title="One file with every weight inside. You can look at it at any position and export it, but you can't edit each position's shapes: split it into masters for that.">Variable font</span>
        {keyframes.map(k => {
          const on = atKeyframe(vv, k)
          return (
            <button key={k.name + JSON.stringify(k.location)} role="tab" aria-selected={on} onClick={() => setValuesNow({ ...defaults, ...k.location })}
              title={`The font was drawn at ${k.name}. Click to look at it there.`}
              className={`relative flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap border-r px-3 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring ${on ? 'bg-background text-foreground before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary' : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground'}`}>
              {k.name}<span className="font-mono text-[10px] opacity-60">{font.axes.map(a => Math.round(k.location[a.tag] ?? a.default)).join(' ')}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-0.5">
        {font.axes.map((a, i) => (
          <label key={a.tag} className="flex items-center gap-1.5 text-muted-foreground" title={a.name}>{i === 0 ? a.name : a.tag}
            <div className="w-32">
              <input type="range" min={a.min} max={a.max} step={a.max - a.min > 20 ? 1 : (a.max - a.min) / 400} value={values[a.tag] ?? a.default} aria-label={`Preview ${a.name}`}
                onChange={e => setValues(s => ({ ...s, [a.tag]: Number(e.target.value) }))} className="block w-full accent-primary" />
              <AxisTicks axis={a} drawn={keyframes.map(k => k.location[a.tag]).filter((v): v is number => v !== undefined)} steps={vv.stepTag === a.tag && (playing || preparing) ? vv.steps : []} />
            </div>
            <div className="w-36"><NumField hideLabel buttons label={a.name} min={a.min} max={a.max} value={Math.round(values[a.tag] ?? a.default)}
              onCommit={n => setValuesNow(s => ({ ...s, [a.tag]: n }))} /></div>
          </label>
        ))}
        {canPlay && (
          <Button size="icon-xs" variant={playing || preparing ? 'secondary' : 'ghost'} aria-pressed={playing || preparing} aria-label={playing ? 'Stop the animation' : preparing ? 'Getting ready: click to cancel' : 'Play: sweep the weight'}
            title={playing ? 'Stop' : preparing ? 'Getting every position ready first: click to cancel' : 'Play: gets every position ready, then shows the shapes changing from the lightest to the heaviest and back'} onClick={() => void togglePlay()}>{playing ? <Pause /> : preparing ? <Loader2 className="animate-spin" /> : <Play />}</Button>
        )}
        <span className="flex-1" />
        <Button size="xs" variant="outline" onClick={onSplit} disabled={busy}
          title="Make a project folder with an editable font for each place it was drawn, and open it as a family. Your .ttf is not changed."><Layers />Edit as masters…</Button>
      </div>
    </div>
  )
}
