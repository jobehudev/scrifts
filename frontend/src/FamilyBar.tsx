import { useEffect, useState } from 'react'
import { CircleCheck, CircleX, Loader2, Pause, Play, Plus, X } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type Master = { path: string; name: string; weight: number; location: Record<string, number> }
export type BlendGlyph = { width: number; contours: [number, number, number][][]; closed: boolean[] }
/** Copying glyphs between the masters of a family (paths are the masters' .sfd files). */
export type MasterOps = {
  current: string; others: { label: string; path: string }[]
  copy: (source: string, targets: string[], names: string[]) => Promise<void>
}
export type Check = { masters: string[]; checked: number; glyphs: { name: string; problems: string[] }[] }
/** A brace layer: a sparse master that gives `glyphs` an extra shape at its location. */
export type Brace = Master & { glyphs: string[] }
export type Family = { path: string; axes: { tag: string; name: string; min: number; default: number; max: number }[]; masters: Master[]; braces: Brace[] }

/** Windows paths: compare without caring about slashes or case. */
export const samePath = (a: string, b: string) => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase()

const WEIGHT_NAMES: [number, string][] = [[100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'],
  [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']]
const nameFor = (w: number) => WEIGHT_NAMES.reduce((a, b) => Math.abs(b[0] - w) < Math.abs(a[0] - w) ? b : a)[1]
const weightFor = (style: string) => WEIGHT_NAMES.find(([, n]) => n.toLowerCase() === style.replace(/\s/g, '').toLowerCase())?.[0]

/** The masters of the family, as tabs; the open one is the font being edited. */
export function MasterBar({ family, current, onSwitch, onAdd, onRemove, onEdit, busy, check, onCheck, weight, onWeight, onAddHere, axisVals, onAxis, onAddAxis, glyph, onAddBrace, onRemoveBrace }: {
  family: Family; current: string; onSwitch: (m: Master) => void; onAdd: () => void; onRemove: (m: Master) => void; onEdit: (m: Master) => void; busy: boolean
  check: Check | null; onCheck: () => void
  /** Weight slider: preview the blend at this weight (null = off). */
  weight: number | null; onWeight: (w: number | null) => void; onAddHere: () => void
  /** Values of the axes after Weight (missing = the axis default), and how to change them or add an axis. */
  axisVals: Record<string, number>; onAxis: (name: string, v: number) => void; onAddAxis: () => void
  /** The selected glyph, which a brace layer would be made for, and what to do with brace layers. */
  glyph: string | null; onAddBrace: () => void; onRemoveBrace: (b: Brace, glyph?: string) => void
}) {
  const ax = family.axes[0]
  const extra = family.axes.slice(1)
  const at = (name: string) => axisVals[name] ?? family.axes.find(a => a.name === name)!.default
  const here: Record<string, number> = { Weight: weight ?? ax?.default, ...Object.fromEntries(extra.map(a => [a.name, at(a.name)])) }
  // Play: sweep the weight from one end of the family to the other and back, so the shapes can be watched changing
  const [playing, setPlaying] = useState(false)
  const lo = ax?.min ?? 0, hi = ax?.max ?? 0
  useEffect(() => {
    if (!playing || hi <= lo) return
    const t0 = performance.now()
    let raf = 0
    const frame = () => {  // on the screen's own frame clock; the views fetch only the newest weight, so a fast sweep cannot pile up
      const elapsed = performance.now() - t0
      if (elapsed >= 4000) { onWeight(lo); setPlaying(false); return }  // one round trip, then it rests: it does not keep asking the server
      const phase = (elapsed / 4000) * Math.PI * 2
      onWeight(Math.round(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(phase))))
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [playing, lo, hi, onWeight])
  const between = weight !== null && !family.masters.some(m => family.axes.every(a => (m.location[a.name] ?? a.default) === here[a.name]))
  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1 text-xs">
      <span className="mr-1 text-muted-foreground">Masters</span>
      {family.masters.map(m => {
        const on = samePath(m.path, current)
        return (
          <ContextMenu key={m.path}>
          <ContextMenuTrigger asChild>
          <button onClick={() => !on && onSwitch(m)} disabled={busy} title={m.path} aria-pressed={on}
            aria-label={`${m.name} master, weight ${m.weight}`}
            className={`flex items-baseline gap-1.5 rounded-md border px-2 py-0.5 ${on ? 'border-primary bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
            {m.name}<span className="font-mono text-[10px] opacity-70">{m.weight}{extra.map(a => ` ${a.tag} ${m.location[a.name] ?? a.default}`).join('')}</span>
          </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled={on || busy} onSelect={() => onSwitch(m)}>Edit this master</ContextMenuItem>
            <ContextMenuItem disabled={!on || busy} onSelect={() => onEdit(m)}>Rename or change weight…{on ? '' : ' (open it first)'}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" disabled={busy || family.masters.length < 2} onSelect={() => onRemove(m)}>Remove from family…</ContextMenuItem>
          </ContextMenuContent>
          </ContextMenu>
        )
      })}
      {(family.braces ?? []).map(b => {
        const on = samePath(b.path, current)
        return (
          <ContextMenu key={b.path}>
            <ContextMenuTrigger asChild>
              <button onClick={() => !on && onSwitch(b)} disabled={busy} aria-pressed={on} title={`Brace layer: ${b.glyphs.join(' ')} get an extra shape here`}
                aria-label={`Brace layer at weight ${b.weight}`}
                className={`flex items-baseline gap-1.5 rounded-md border border-dashed px-2 py-0.5 ${on ? 'border-primary bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-accent'}`}>
                {'{'}{Math.round(b.weight * 10) / 10}{extra.map(a => ` ${a.tag} ${Math.round((b.location[a.name] ?? a.default) * 10) / 10}`).join('')}{'}'}
                <span className="max-w-24 truncate font-mono text-[10px] opacity-70">{b.glyphs.join(' ')}</span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem disabled={on || busy} onSelect={() => onSwitch(b)}>Edit this brace layer</ContextMenuItem>
              <ContextMenuSeparator />
              {b.glyphs.map(g => (
                <ContextMenuItem key={g} variant="destructive" disabled={busy} onSelect={() => onRemoveBrace(b, g)}>Remove {g} from this layer</ContextMenuItem>
              ))}
              <ContextMenuItem variant="destructive" disabled={busy} onSelect={() => onRemoveBrace(b)}>Remove the whole layer…</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      <Button size="icon-xs" variant="ghost" onClick={onAdd} disabled={busy} aria-label="Add master"><Plus /></Button>
      <Button size="xs" variant="ghost" onClick={onAddAxis} disabled={busy} title="Add an axis such as Width or Optical size">+ Axis</Button>
      {family.masters.length > 1 && ax && (
        <div className="ml-3 flex items-center gap-2">
          <input type="range" min={ax.min} max={ax.max} step={1} value={weight ?? ax.default}
            onChange={e => onWeight(Number(e.target.value))} aria-label="Preview weight" className="w-32 accent-primary" />
          <span className={`w-8 font-mono ${weight === null ? 'text-muted-foreground' : ''}`}>{weight ?? '—'}</span>
          <Button size="icon-xs" variant={playing ? 'secondary' : 'ghost'} aria-pressed={playing} aria-label={playing ? 'Stop the animation' : 'Play: sweep the weight'}
            title={playing ? 'Stop' : 'Play: watch the shapes change from the lightest master to the heaviest and back'} onClick={() => setPlaying(p => !p)}>{playing ? <Pause /> : <Play />}</Button>
          {extra.map(a => (
            <label key={a.name} className="flex items-center gap-1 text-muted-foreground" title={a.name}>{a.tag}
              <input type="range" min={a.min} max={a.max} step={1} value={at(a.name)} aria-label={`Preview ${a.name}`}
                onChange={e => { if (weight === null) onWeight(ax.default); onAxis(a.name, Number(e.target.value)) }} className="w-24 accent-primary" />
              <span className="w-8 font-mono text-foreground">{at(a.name)}</span>
            </label>
          ))}
          {weight !== null && <>
            <Button size="xs" variant="outline" onClick={onAddHere} disabled={busy || !between} aria-label="Add master here"
              title={between ? 'Make a master from the blend at this position, to adjust by hand' : 'Move the sliders to a position that has no master'}>
              Add master here
            </Button>
            <Button size="xs" variant="outline" onClick={onAddBrace} disabled={busy || !between || !glyph} aria-label="Add brace layer here"
              title={glyph ? (between ? `Give ${glyph} its own extra shape at this position` : 'Move the sliders to a position that has no master') : 'Select a glyph first'}>
              {'{'}Brace{'}'} {glyph ?? ''}
            </Button>
            <Button size="icon-xs" variant="ghost" onClick={() => { setPlaying(false); onWeight(null) }} aria-label="Stop previewing"><X /></Button>
          </>}
        </div>
      )}
      <span className="flex-1" />
      {family.masters.length > 1 && (
        <button onClick={onCheck} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 hover:bg-accent"
          title="Can the masters be blended? Every glyph needs the same contours and points in every master.">
          {!check ? <><Loader2 className="size-3.5 animate-spin" />Checking</>
            : check.glyphs.length
              ? <span className="flex items-center gap-1 text-destructive"><CircleX className="size-3.5" />{check.glyphs.length > 1 ? `${check.glyphs.length} glyphs don't match` : "1 glyph doesn't match"}</span>
              : <span className="flex items-center gap-1 text-muted-foreground"><CircleCheck className="size-3.5" />Compatible</span>}
        </button>
      )}
    </div>
  )
}

/** Start a family from the open font, or add a master by duplicating the open one. */
export function FamilyDialog({ mode, open, onOpenChange, family, fontStyle, blendWeight, blendAxes, onSubmit }: {
  mode: 'new' | 'add' | 'blend'; open: boolean; onOpenChange: (o: boolean) => void
  family: Family | null; fontStyle: string; blendWeight: number | null
  /** The other axes' values the preview slider sits at (for 'blend'). */
  blendAxes: Record<string, number>
  /** 'new': the open font becomes the first master at `thisWeight`, then the new master is added. `location` holds the axes after Weight. */
  onSubmit: (style: string, weight: number, thisWeight: number | undefined, location: Record<string, number>) => void
}) {
  const extraAxes = mode === 'new' ? [] : (family?.axes.slice(1) ?? [])
  const [extra, setExtra] = useState<Record<string, string>>({})
  const [style, setStyle] = useState('')
  const [weight, setWeight] = useState('')
  const [thisWeight, setThisWeight] = useState('')
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form each time it opens
    if (mode === 'new') {
      const w = weightFor(fontStyle) ?? 400
      setThisWeight(String(w))
      const next = w < 900 ? 900 : 100
      setStyle(nameFor(next)); setWeight(String(next))
    }
    else if (mode === 'blend' && blendWeight !== null) {
      setStyle(nameFor(blendWeight)); setWeight(String(blendWeight))
      setExtra(Object.fromEntries((family?.axes.slice(1) ?? []).map(a => [a.name, String(blendAxes[a.name] ?? a.default)])))
    }
    else {
      const ws = family?.masters.map(m => m.weight) ?? []
      const w = Math.max(...ws) < 900 ? 900 : Math.min(...ws) > 100 ? 100 : 400
      setStyle(nameFor(w)); setWeight(String(w))
      setExtra(Object.fromEntries((family?.axes.slice(1) ?? []).map(a => [a.name, String(a.default)])))
    }
  }, [open, mode, family, fontStyle, blendWeight, blendAxes])

  const w = Number(weight), tw = Number(thisWeight)
  const loc = Object.fromEntries(extraAxes.map(a => [a.name, Number(extra[a.name] ?? a.default)]))
  const taken = mode === 'new' ? w === tw : family?.masters.some(m => m.weight === w && extraAxes.every(a => (m.location[a.name] ?? a.default) === loc[a.name]))
  const ok = style.trim() && Number.isFinite(w) && w >= 1 && w <= 1000 && !taken && Object.values(loc).every(Number.isFinite)
    && (mode !== 'new' || (Number.isFinite(tw) && tw >= 1 && tw <= 1000))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'blend' ? 'Add Master Here' : 'Add Master'}</DialogTitle>
          <DialogDescription>
            {mode === 'new'
              ? 'This font becomes the first master of a family (a .designspace file next to it lists the masters). Then it is saved and copied as the new master: reshape the copy by moving points; adding or removing points breaks interpolation.'
              : mode === 'blend'
                ? 'Blends the masters at this weight into a new master you can adjust by hand. Glyphs whose masters don\'t match are copied from the nearest master.'
                : 'Saves the open master, then copies it as a new master. Reshape the copy by moving points; adding or removing points breaks interpolation.'}
          </DialogDescription>
        </DialogHeader>
        {mode === 'new' && (
          <div className="grid grid-cols-[1fr_120px] gap-3 text-sm">
            <div className="grid gap-1.5">
              <Label>This font</Label>
              <Input value={fontStyle} disabled className="h-8" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fam-this-weight">Its weight</Label>
              <Input id="fam-this-weight" type="number" min={1} max={1000} step={1} value={thisWeight}
                onChange={e => setThisWeight(e.target.value)} className="h-8" />
            </div>
          </div>
        )}
        <div className="grid grid-cols-[1fr_120px] gap-3 text-sm">
          <div className="grid gap-1.5">
            <Label htmlFor="fam-style">{mode === 'new' ? 'New master' : 'Style name'}</Label>
            <Input id="fam-style" value={style} className="h-8"
              onChange={e => { setStyle(e.target.value); const g = weightFor(e.target.value); if (g) setWeight(String(g)) }} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fam-weight">Weight</Label>
            <Input id="fam-weight" type="number" min={1} max={1000} step={1} value={weight}
              onChange={e => setWeight(e.target.value)} className="h-8" />
          </div>
        </div>
        {extraAxes.length > 0 && (
          <div className="grid grid-cols-3 gap-3 text-sm">
            {extraAxes.map(a => (
              <div key={a.name} className="grid gap-1.5">
                <Label htmlFor={`fam-ax-${a.tag}`}>{a.name} <span className="text-muted-foreground">{a.min}–{a.max}</span></Label>
                <Input id={`fam-ax-${a.tag}`} type="number" step={1} value={extra[a.name] ?? ''} className="h-8"
                  onChange={e => setExtra(x => ({ ...x, [a.name]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}
        {taken && <p className="text-xs text-destructive">{mode === 'new' ? 'The new master needs a different weight from this font.' : 'There is already a master at that position.'}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ok} onClick={() => onSubmit(style.trim(), w, mode === 'new' ? tw : undefined, loc)}>Add Master</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Glyphs whose masters don't match, with why; click one to open it. */
export function CheckDialog({ open, onOpenChange, check, onGlyph, onRecheck }: {
  open: boolean; onOpenChange: (o: boolean) => void; check: Check | null
  onGlyph: (name: string) => void; onRecheck: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Master Compatibility</DialogTitle>
          <DialogDescription>
            To blend between masters, each glyph needs the same contours, with the same number and kind of
            points, in the same order and direction. {check && `Compared ${check.masters.join(', ')}: ${check.checked} glyphs.`}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto text-sm">
          {!check && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Checking…</div>}
          {check && !check.glyphs.length && <div className="flex items-center gap-2 text-muted-foreground"><CircleCheck className="size-4" />Every glyph matches.</div>}
          {check?.glyphs.map(g => (
            <button key={g.name} onClick={() => { onGlyph(g.name); onOpenChange(false) }}
              className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-accent">
              <span className="font-mono text-xs font-medium">{g.name}</span>
              {g.problems.map((p, i) => <div key={i} className="text-xs text-muted-foreground">{p}</div>)}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onRecheck}>Check again</Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Confirm taking a master out of the family (its file stays on disk). */
export function RemoveMasterDialog({ master, onCancel, onConfirm }: {
  master: Master | null; onCancel: () => void; onConfirm: (m: Master) => void
}) {
  return (
    <Dialog open={!!master} onOpenChange={o => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove {master?.name} from the family?</DialogTitle>
          <DialogDescription>
            The family file stops listing it, so it no longer takes part in blending or the variable font.
            Its file is kept: <span className="font-mono text-xs break-all">{master?.path}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={() => master && onConfirm(master)}>Remove</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Rename a master's style and/or give it another weight. */
export function EditMasterDialog({ master, others, onCancel, onSubmit }: {
  master: Master | null; others: Master[]; onCancel: () => void; onSubmit: (style: string, weight: number) => void
}) {
  const [style, setStyle] = useState('')
  const [weight, setWeight] = useState('')
  const [touched, setTouched] = useState(false)  // weight typed by hand: stop suggesting one from the style name
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- each opening starts from the master being edited
    if (master) { setStyle(master.name); setWeight(String(master.weight)); setTouched(false) }
  }, [master])
  const w = Number(weight)
  const clash = others.some(m => m !== master && m.weight === w && Object.entries(m.location).every(([k, v]) => k === 'Weight' || v === master?.location[k]))
  const styleOk = !!style.trim() && /^[A-Za-z0-9 ]+$/.test(style)
  const ok = styleOk && Number.isFinite(w) && w >= 1 && w <= 1000 && !clash
  return (
    <Dialog open={!!master} onOpenChange={o => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit master</DialogTitle>
          <DialogDescription>Changes the font's own style name and weight class, and where it sits in the family. The file keeps its name.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="grid gap-1.5">
            <Label htmlFor="em-style">Style name</Label>
            <Input id="em-style" value={style} aria-invalid={!styleOk} onChange={e => {
              setStyle(e.target.value)
              const suggested = weightFor(e.target.value)
              if (suggested && !touched) setWeight(String(suggested))
            }} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="em-weight">Weight</Label>
            <Input id="em-weight" type="number" min={1} max={1000} value={weight} aria-invalid={clash} onChange={e => { setWeight(e.target.value); setTouched(true) }} />
            {clash && <p className="text-xs text-destructive">Another master is already at this weight.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button disabled={!ok} onClick={() => onSubmit(style.trim().replace(/\s+/g, ' '), w)}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A font that isn't in a family yet: its one master, and + to add another. */
export function SoloMasterBar({ style, canAdd, onAdd, busy }: { style: string; canAdd: boolean; onAdd: () => void; busy: boolean }) {
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1 text-xs">
      <span className="mr-1 text-muted-foreground">Masters</span>
      <span className="rounded-md border border-primary bg-primary/15 px-2 py-0.5">{style}</span>
      <Button size="icon-xs" variant="ghost" onClick={onAdd} disabled={busy || !canAdd} aria-label="Add master"
        title={canAdd ? 'Add a master (e.g. a bolder weight) to make a variable family' : 'Masters are .sfd files: save this font as .sfd first'}><Plus /></Button>
    </div>
  )
}

const AXIS_PRESETS: { name: string; tag: string; min: number; default: number; max: number }[] = [
  { name: 'Width', tag: 'wdth', min: 75, default: 100, max: 125 },
  { name: 'Optical size', tag: 'opsz', min: 8, default: 14, max: 144 },
  { name: 'Slant', tag: 'slnt', min: -15, default: 0, max: 0 },
]

/** A new axis for the family; every master starts at its default. */
export function AxisDialog({ open, onOpenChange, onSubmit }: {
  open: boolean; onOpenChange: (o: boolean) => void
  onSubmit: (a: { name: string; tag: string; min: number; default: number; max: number }) => void
}) {
  const [f, setF] = useState({ name: 'Width', tag: 'wdth', min: '75', default: '100', max: '125' })
  const n = { min: Number(f.min), default: Number(f.default), max: Number(f.max) }
  const ok = f.name.trim() && /^[A-Za-z0-9]{4}$/.test(f.tag) && [n.min, n.default, n.max].every(Number.isFinite) && n.min <= n.default && n.default <= n.max && n.min < n.max
  const field = (k: 'min' | 'default' | 'max', label: string) => (
    <div className="grid gap-1.5"><Label htmlFor={`ax-${k}`}>{label}</Label>
      <Input id={`ax-${k}`} type="number" className="h-8" value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></div>
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Axis</DialogTitle>
          <DialogDescription>
            Every master starts at the default. Then add masters at the ends of the range (Add Master asks for a value per axis) so the axis does something.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1">
          {AXIS_PRESETS.map(p => (
            <Button key={p.tag} size="xs" variant="outline" onClick={() => setF({ name: p.name, tag: p.tag, min: String(p.min), default: String(p.default), max: String(p.max) })}>{p.name}</Button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_90px] gap-3 text-sm">
          <div className="grid gap-1.5"><Label htmlFor="ax-name">Name</Label>
            <Input id="ax-name" className="h-8" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ax-tag">Tag</Label>
            <Input id="ax-tag" className="h-8 font-mono" maxLength={4} value={f.tag} onChange={e => setF({ ...f, tag: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">{field('min', 'Minimum')}{field('default', 'Default')}{field('max', 'Maximum')}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ok} onClick={() => onSubmit({ name: f.name.trim(), tag: f.tag, ...n })}>Add Axis</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
