import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { propsStore, useProps } from './propsStore'
import { CAPS, JOINS, type Cap, type Join } from './strokes'
import { NumField as Num } from './NumField'
import { CORNER_KINDS, type CornerKind } from './corners'
import type { SvgStyle } from './svgStyle'

const HINTS: Record<string, string> = {
  select: 'Click a point or shape, or drag a box around several. Type below to move or resize what is selected.',
  pen: 'Click for a corner, drag for a curve, Enter ends the path. Click on an outline to add a point there.',
  rect: 'Drag from one corner to the other. Shift makes a square, Alt draws from the middle, Ctrl skips snapping.',
  oval: 'Drag across its box. Shift makes a circle, Alt draws from the middle, Ctrl skips snapping.',
  shaper: 'Drag across the regions that overlapping shapes make to fuse them into one. Alt-drag removes regions.',
  hand: 'Drag to move around. Hold Space for this from any tool.',
  zoom: 'Click to zoom in, Alt+click to zoom out.',
  measure: 'Drag between two points to read the distance. Shift locks the angle.',
}
const Section = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
  <section className="grid gap-2 border-b p-3">
    <h3 className="flex items-baseline justify-between text-xs font-medium text-muted-foreground">
      {title}{note && <span className="font-normal tracking-normal normal-case">{note}</span>}
    </h3>
    {children}
  </section>
)

function StrokeFields({ s, note, off, set }: {
  s: { width: number; cap: Cap; join: Join }; note: string; off: boolean; set: (patch: { width?: number; cap?: Cap; join?: Join }) => void
}) {
  return (
    <Section title="Stroke" note={note}>
      <Num wide label="Width" value={s.width} disabled={off} onCommit={width => width > 0 && set({ width })} />
      <label className="flex items-center gap-2"><span className="w-14 shrink-0 text-muted-foreground">Ends</span>
        <Select value={s.cap} disabled={off} onChange={e => set({ cap: e.target.value as Cap })} className="h-7">
          {CAPS.map(c => <option key={c}>{c}</option>)}</Select></label>
      <label className="flex items-center gap-2"><span className="w-14 shrink-0 text-muted-foreground">Corners</span>
        <Select value={s.join} disabled={off} onChange={e => set({ join: e.target.value as Join })} className="h-7">
          {JOINS.map(c => <option key={c}>{c}</option>)}</Select></label>
    </Section>
  )
}

/** An .svg drawing's colours: fill and stroke (each can be off), stroke width, opacity, of the selected shapes. */
function AppearanceFields({ s, off, set }: { s: SvgStyle | 'none'; off: boolean; set: (patch: Partial<SvgStyle>) => void }) {
  if (s === 'none') return <Section title="Appearance"><p className="text-muted-foreground">Select a shape to change its colours.</p></Section>
  const paint = (label: string, key: 'fill' | 'stroke', fallback: string) => (
    <label className="flex items-center gap-2"><span className="w-14 shrink-0 text-muted-foreground">{label}</span>
      <input type="color" disabled={off || !s[key]} value={s[key] ?? fallback} onChange={e => set({ [key]: e.target.value })} className="h-7 w-10 shrink-0 cursor-pointer rounded border bg-transparent p-0.5" />
      <input type="checkbox" disabled={off} checked={!!s[key]} onChange={e => set({ [key]: e.target.checked ? fallback : null })} aria-label={`${label} on`} />
      <span className="font-mono text-muted-foreground">{s[key] ?? 'none'}</span></label>
  )
  return (
    <Section title="Appearance">
      {paint('Fill', 'fill', '#000000')}
      {paint('Stroke', 'stroke', '#000000')}
      <Num wide label="Stroke width" value={s.sw} disabled={off || !s.stroke} onCommit={sw => sw >= 0 && set({ sw })} />
      <Num wide label="Opacity %" value={Math.round(s.op * 100)} disabled={off} onCommit={v => set({ op: Math.max(0, Math.min(100, v)) / 100 })} />
    </Section>
  )
}

/** Bolder or lighter by any amount: every point moves, none is added or removed, so masters keep matching. */
function WeightFields({ off, change }: { off: boolean; change: (delta: number) => void }) {
  const [d, setD] = useState(() => Number(localStorage.getItem('scrifts.weight')) || 10)
  const set = (v: number) => { setD(v); localStorage.setItem('scrifts.weight', String(v)) }
  return (
    <Section title="Weight" note="whole glyph">
      <Num wide label="Units" value={d} disabled={off} onCommit={v => v > 0 && set(v)} />
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" disabled={off} onClick={() => change(-d)} title="Thinner stems by this many units in total (Ctrl Z undoes it)">Lighter −{d}</Button>
        <Button size="sm" variant="secondary" disabled={off} onClick={() => change(d)} title="Thicker stems by this many units in total (Ctrl Z undoes it)">Bolder +{d}</Button>
      </div>
      <p className="text-muted-foreground">Points only move, so the glyph still interpolates with your other masters.</p>
    </Section>
  )
}

/** Round corners, as Illustrator's Live Corners: a radius, then it rounds the selected points (every corner when none is selected). */
function CornerFields({ off, points, scoped, round }: { off: boolean; points: number; scoped: boolean; round: (r: number, k: CornerKind) => void }) {
  const [r, setR] = useState(() => Number(localStorage.getItem('scrifts.radius')) || 40)
  const [k, setK] = useState<CornerKind>(() => (localStorage.getItem('scrifts.cornerKind') as CornerKind) || 'round')
  return (
    <Section title="Corners" note={scoped ? `${points} selected` : 'all'}>
      <label className="flex items-center gap-2"><span className="w-14 shrink-0 text-muted-foreground">Type</span>
        <Select value={k} disabled={off} onChange={e => setK(e.target.value as CornerKind)} className="h-7">
          {CORNER_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Select></label>
      <Num wide label="Radius" value={r} disabled={off} onCommit={v => v > 0 && setR(v)} />
      <Button size="sm" variant="secondary" disabled={off || r <= 0} onClick={() => round(r, k)}
        title="Straight corners become arcs, inverted arcs or cuts; the radius shrinks to fit short edges. Corners next to curves are left alone. Or select corners and drag the round widget on one (Ctrl: just that one, Alt-click: change type, double-click: dialog). Ctrl Z undoes it.">Round corners</Button>
    </Section>
  )
}

/** Window ▸ Properties: size and position of what is selected, and the settings of the tool in use. */
export function PropertiesPanel() {
  const p = useProps()
  const a = propsStore.actions()
  if (!p || !a) return <p className="p-3 text-xs text-muted-foreground">Select a glyph to see its properties.</p>
  const off = !p.editable
  const hint = <p className="p-3 text-muted-foreground">{HINTS[p.tool] ?? ''}</p>

  // what is shown follows what you are doing: the pen has its own settings, the selection tool has the selection's
  if (p.tool === 'pen') {
    return (
      <div className="h-full overflow-y-auto text-xs">
        <Section title={p.tool === 'pen' ? 'Pen' : 'Shaper'} note="draws…">
          <div role="group" aria-label="What the pen draws" className="grid grid-cols-2 overflow-hidden rounded-md border">
            {([false, true] as const).map(on => (
              <button key={String(on)} type="button" aria-pressed={p.pen.on === on} disabled={off} onClick={() => a.setStroke({ on })}
                title={on ? 'A path with a width: it becomes an outline when you Expand it or generate the font' : 'A closed shape, as usual'}
                className={`px-2 py-1.5 ${p.pen.on === on ? 'bg-primary/20 text-foreground' : 'text-muted-foreground hover:bg-accent'}`}>{on ? 'Stroke' : 'Outline'}</button>
            ))}
          </div>
        </Section>
        {p.pen.on && <StrokeFields s={p.pen} note="for new paths" off={off} set={a.setStroke} />}
        {hint}
      </div>
    )
  }
  if (p.tool !== 'select') return <div className="h-full overflow-y-auto text-xs">{hint}</div>
  return (
    <div className="h-full overflow-y-auto text-xs">
      <Section title={p.scope === 'selection' ? 'Selection' : 'Whole glyph'}
        note={`${p.points} point${p.points === 1 ? '' : 's'} · ${p.shapes} shape${p.shapes === 1 ? '' : 's'}`}>
        {p.box ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Num label="X" value={p.box.x} disabled={off} onCommit={x => a.setBox({ x })} />
            <Num label="Y" value={p.box.y} disabled={off} onCommit={y => a.setBox({ y })} />
            <Num label="W" value={p.box.w} disabled={off || p.box.w <= 0} onCommit={w => w > 0 && a.setBox({ w })} />
            <Num label="H" value={p.box.h} disabled={off || p.box.h <= 0} onCommit={h => h > 0 && a.setBox({ h })} />
          </div>
        ) : <p className="text-muted-foreground">Nothing drawn yet.</p>}
        {p.box && (
          <label className="flex items-center gap-2" title="Turn the selection counter-clockwise by this many degrees (negative: clockwise), about its middle. Enter applies it. Or drag just outside a corner of the box.">
            <span className="w-14 text-muted-foreground">Rotate °</span>
            <input type="number" step="any" placeholder="0" disabled={off}
              className="h-7 w-full rounded-md border bg-transparent px-2 font-mono"
              onKeyDown={e => { if (e.key === 'Enter') { a.rotate(Number(e.currentTarget.value)); e.currentTarget.value = '' } e.stopPropagation() }} />
          </label>
        )}
        <p className="text-muted-foreground">{off ? 'Move the axes back to their defaults to edit.' : 'Font units. X and Y are the lower left corner; W and H scale from it.'}</p>
      </Section>
      {p.svg && <AppearanceFields s={p.svg} off={off} set={a.setAppearance} />}
      <WeightFields off={off} change={a.changeWeight} />
      <CornerFields off={off} points={p.points} scoped={p.scope === 'selection'} round={a.roundCorners} />
      {p.selStrokes > 0 && <StrokeFields s={p.shownStroke} note={`${p.selStrokes} selected`} off={off} set={a.setStroke} />}
      {p.strokes > 0 && (
        <Section title="Strokes" note={`${p.strokes} in this glyph`}>
          <Button size="sm" variant="secondary" disabled={off} onClick={a.expand}
            title="Turn the strokes into outlines you can edit point by point (Ctrl Z undoes it)">
            {p.selStrokes ? `Expand ${p.selStrokes} selected` : `Expand ${p.strokes === 1 ? 'stroke' : `all ${p.strokes} strokes`}`}</Button>
          <p className="text-muted-foreground">Until then they stay editable lines. Generating a font expands them for you.</p>
        </Section>
      )}
      {hint}
    </div>
  )
}
