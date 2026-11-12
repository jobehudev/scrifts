import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Info, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, outlines, type Points } from './api'
import { useNarrow } from './narrow'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Placement = { part: string; t: number; dx: number; dy: number }
type State = { glyphs: Record<string, Placement[]>; parts: string[] }

/**
 * Smart components: the glyph is built from parts that slide between two
 * extremes (a stem from thin to thick, a serif from short to long). A part is
 * a pair of matching glyphs, `_stem` and `_stem.max`; each placement picks a
 * part, how far along it is (0 to 1) and where it sits.
 */
export function SmartPanel({ name, onChanged, docked = false }: { name: string; onChanged: () => void; docked?: boolean }) {
  const [state, setState] = useState<State | null>(null)
  const [storedOpen, setOpen] = useState(() => localStorage.getItem('forge.smart') === 'open')
  const root = useRef<HTMLDivElement>(null)
  const narrow = useNarrow(root)  // a narrow pane starts it folded; opening it there is temporary
  const [narrowOpen, setNarrowOpen] = useState(false)
  const open = docked || (narrow ? narrowOpen : storedOpen)
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<Placement[] | null>(null)  // while a slider is being dragged

  const load = useCallback(() => api<State>('/api/smart').then(setState).catch(() => {}), [])
  useEffect(() => { void load(); setLocal(null) }, [load, name])

  const parts = local ?? state?.glyphs[name] ?? []

  const send = async (next: Placement[]) => {
    setBusy(true)
    try {
      const res = await api<Points>('/api/smart/set', { name, parts: next })
      outlines.putPoints(res)
      outlines.put(res, null)
      outlines.invalidateUsers(name)
      setLocal(null)
      await load()
      onChanged()
    } catch (e) {
      setLocal(null)
      toast.error('Smart parts not applied', { description: (e as Error).message })
    } finally { setBusy(false) }
  }
  const change = (i: number, p: Partial<Placement>, now = true) => {
    const next = parts.map((x, j) => (j === i ? { ...x, ...p } : x))
    setLocal(next)
    if (now) void send(next)
  }
  const rebuildAll = async () => {
    setBusy(true)
    try {
      const r = await api<{ rebuilt: string[] }>('/api/smart/apply', {})
      outlines.clear()
      await load()
      onChanged()
      toast.success(r.rebuilt.length ? `Rebuilt ${r.rebuilt.join(' ')}` : 'Nothing is built from parts yet')
    } catch (e) {
      toast.error('Could not rebuild', { description: (e as Error).message })
    } finally { setBusy(false) }
  }

  const available = state?.parts ?? []
  const body = (
        <div className={docked ? 'space-y-2 p-2' : 'space-y-2 border-t p-2'}>
          {parts.map((p, i) => (
            <div key={i} className="space-y-1 rounded border p-1.5">
              <div className="flex items-center gap-1">
                <Select className="h-7 min-w-0 flex-1 px-1.5 font-mono text-xs" value={p.part} aria-label="Part" disabled={busy}
                  onChange={e => change(i, { part: e.target.value })}>
                  {!available.includes(p.part) && <option value={p.part}>{p.part} (missing)</option>}
                  {available.map(a => <option key={a} value={a}>{a}</option>)}
                </Select>
                <Button size="icon-xs" variant="ghost" aria-label="Remove part" disabled={busy} onClick={() => void send(parts.filter((_, j) => j !== i))}><X /></Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-muted-foreground">min–max</span>
                <Slider min={0} max={1} step={0.01} value={[p.t]} disabled={busy}
                  onValueChange={v => change(i, { t: v[0] }, false)} onValueCommit={v => void send(parts.map((x, j) => (j === i ? { ...x, t: v[0] } : x)))} />
                <span className="w-9 text-right font-mono">{p.t.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1">x <Input type="number" className="h-7 w-16 font-mono" value={p.dx} disabled={busy}
                  onChange={e => change(i, { dx: +e.target.value }, false)} onBlur={() => void send(parts)} /></label>
                <label className="flex items-center gap-1">y <Input type="number" className="h-7 w-16 font-mono" value={p.dy} disabled={busy}
                  onChange={e => change(i, { dy: +e.target.value }, false)} onBlur={() => void send(parts)} /></label>
              </div>
            </div>
          ))}
          {available.length === 0
            ? <p className="text-muted-foreground">No parts yet. Make two glyphs with the same contours and points, one called <span className="font-mono">_stem</span> and one <span className="font-mono">_stem.max</span>, and they appear here.</p>
            : <Button size="xs" variant="outline" disabled={busy} onClick={() => void send([...parts, { part: available[0], t: 0, dx: 0, dy: 0 }])}><Plus />Add part</Button>}
          <Button size="xs" variant="ghost" disabled={busy} onClick={() => void rebuildAll()} title="After editing a part, rebuild every glyph that uses parts">Rebuild all</Button>
        </div>
  )
  if (docked) return <div className="h-full overflow-y-auto text-xs">{name ? body : <p className="p-2 text-muted-foreground">Select a glyph.</p>}</div>
  return (
    <div ref={root} className="absolute bottom-3 left-14 z-10 w-72 max-w-[calc(100%-4.5rem)] overflow-hidden rounded-md border bg-card/95 text-xs shadow-sm backdrop-blur">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button type="button" className="flex items-center gap-1" aria-expanded={open}
          onClick={() => { if (narrow) { setNarrowOpen(!narrowOpen); return } localStorage.setItem('forge.smart', open ? 'closed' : 'open'); setOpen(!open) }}>
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <span className="font-medium text-muted-foreground">Smart parts</span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild><Info className="size-3 text-muted-foreground" /></TooltipTrigger>
          <TooltipContent className="max-w-64">
            Build this glyph from parts that slide between two extremes. A part is two glyphs with exactly the same contours and points:
            a minimum (_stem) and a maximum (_stem.max). Drawing in this glyph is replaced while it has parts; edit the parts, then Rebuild all.
          </TooltipContent>
        </Tooltip>
        <span className="flex-1" />
        {parts.length > 0 && <span className="font-mono text-muted-foreground">{parts.length}</span>}
      </div>
      {open && body}
    </div>
  )
}
