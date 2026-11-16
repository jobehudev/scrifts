import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Eye, EyeOff, Info, Lock, LockOpen, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, contourPath, type Anchor, type AnchorClass, type Points } from './api'
import { parseStroke } from './strokes'
import { invertedShapes } from './inversions'
import { theme } from './canvas'
import { useNarrow } from './narrow'
import { setSettings, useSettings } from './settings'
import { NumField } from './NumField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type LayerVis = { guides: boolean; background: boolean; reference: boolean; masters: boolean; underlay: boolean; shadow: boolean; grid: boolean; rulers: boolean; smart: boolean }

/** Small icon toggle in the eye / lock columns. */
function Toggle({ on, onClick, label, iconOn: On, iconOff: Off }: {
  on: boolean; onClick: () => void; label: string; iconOn: typeof Eye; iconOff: typeof Eye
}) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} title={label}
      onClick={e => { e.stopPropagation(); onClick() }}
      className={`grid size-5 shrink-0 place-items-center rounded-sm hover:bg-accent ${on ? 'text-foreground' : 'text-muted-foreground/40'}`}>
      {on ? <On className="size-3.5" /> : <Off className="size-3.5" />}
    </button>
  )
}

/** Thumbnail of one shape, scaled to fit, like Illustrator's layer previews. */
function Thumb({ pts, ci, quadratic }: { pts: Points; ci: number; quadratic: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { theme: mode } = useSettings()  // redraw in the new colours after a theme switch
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1, S = 20
    c.width = c.height = S * dpr
    const ctx = c.getContext('2d')!
    const pts1 = pts.contours[ci]
    const xs = pts1.map(p => p[0]), ys = pts1.map(p => p[1])
    const w = Math.max(...xs) - Math.min(...xs) || 1, h = Math.max(...ys) - Math.min(...ys) || 1
    const k = (S - 4) / Math.max(w, h)
    ctx.setTransform(dpr * k, 0, 0, -dpr * k, dpr * (S / 2 - (Math.min(...xs) + w / 2) * k), dpr * (S / 2 + (Math.min(...ys) + h / 2) * k))
    ctx.fillStyle = theme().ink
    ctx.fill(contourPath([pts1], [pts.shapes[ci]?.closed ?? true], quadratic))
  }, [pts, ci, quadratic, mode])
  return <canvas ref={ref} className="size-5 shrink-0 rounded-[3px] bg-background" />
}

/** A section title in one style for every list in the panel; `children` are small actions at the right. */
function Head({ title, count, tip, children }: { title: string; count?: number; tip?: string; children?: React.ReactNode }) {
  return (
    <div className="mt-1 flex h-7 items-center gap-1.5 border-t px-2 first:mt-0 first:border-t-0">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      {count !== undefined && <span className="font-mono text-xs text-muted-foreground">{count}</span>}
      {tip && (
        <Tooltip>
          <TooltipTrigger asChild><Info className="size-3 text-muted-foreground" aria-label={`About ${title}`} /></TooltipTrigger>
          <TooltipContent className="max-w-72">{tip}</TooltipContent>
        </Tooltip>
      )}
      <span className="ml-auto flex items-center">{children}</span>
    </div>
  )
}

/**
 * Layers, Illustrator style: eye and lock columns, thumbnails, double-click
 * to rename, drag to reorder. In a font every shape is one colour, so
 * "order" is drawing order, not stacking; overlap behaviour comes from
 * direction (↻/↺), shown on each row.
 */
export function LayersPanel({ pts, quadratic, selected, editable, hidden, locked, onHidden, onLocked, vis, onVis,
  guides, onGuides, vguides, onVGuides, hasBackground, referenceName, mastersName, underlayName, shadowName, autoShadow, onShadow, onSelectShape, edit,
  anchors, classes, selAnchor, onSelectAnchor, onAddAnchor, onDeleteAnchor, inherited = [], onInherited, storageKey = 'forge.layers', docked = false, isAccent = false }: {
  pts: Points; quadratic: boolean; selected: Set<number>; editable: boolean
  hidden: Set<number>; locked: Set<number>
  onHidden: (s: Set<number>) => void; onLocked: (s: Set<number>) => void
  vis: LayerVis; onVis: (v: LayerVis) => void
  guides: number[]; onGuides: (ys: number[]) => void
  vguides: number[]; onVGuides: (xs: number[]) => void
  hasBackground: boolean; referenceName: string | null; mastersName?: string | null; underlayName: string | null
  shadowName: string | null; autoShadow: string | null; onShadow: (v: string) => void
  anchors: Anchor[]; classes: AnchorClass[]; selAnchor: Anchor | null
  /** anchors of the glyph's components (E in Ȩ), where they land in this glyph; editing one moves it in the component itself */
  inherited?: { comp: string; a: Anchor; x: number; y: number }[]; onInherited?: (i: number, x: number, y: number) => void
  onSelectAnchor: (a: Anchor | null) => void
  onAddAnchor: (cls: string, type: 'base' | 'mark') => void
  onDeleteAnchor: (a: Anchor) => void
  onSelectShape: (ci: number, add: boolean) => void
  edit: (kind: string, args?: Record<string, unknown>) => void
  /** where collapsed/open is remembered; each workspace keeps its own */
  storageKey?: string
  /** Filling a dock panel instead of floating over the canvas: always open, no header. */
  docked?: boolean
  /** an accent: its anchor is _top (the point that sits on a letter's top), not top */
  isAccent?: boolean
}) {
  const inverted = useMemo(() => invertedShapes(pts.contours.map((contour, i) => ({ contour, closed: pts.shapes[i]?.closed ?? true, cw: pts.shapes[i]?.cw ?? null }))), [pts])  // shapes that cut others out, tagged [inv]
  const [newCls, setNewCls] = useState(isAccent ? '_top' : 'top')
  useEffect(() => { setNewCls(isAccent ? '_top' : 'top') }, [isAccent])
  const [newGuide, setNewGuide] = useState('')
  const [newAxis, setNewAxis] = useState<'y' | 'x'>('y')
  const { gridStyle, snapToGrid } = useSettings()
  const [storedCollapsed, setCollapsed] = useState(() => (localStorage.getItem(storageKey) ?? (storageKey === 'forge.layers' ? 'open' : 'collapsed')) === 'collapsed')
  // in a narrow pane the panel starts folded so it doesn't cover the glyph; opening it there is temporary
  const root = useRef<HTMLDivElement>(null)
  const narrowPane = useNarrow(root)
  const narrow = !docked && narrowPane
  const [narrowOpen, setNarrowOpen] = useState(false)
  const collapsed = docked ? false : narrow ? !narrowOpen : storedCollapsed
  const [renaming, setRenaming] = useState<number | null>(null)
  // Reorder by pointer, not HTML5 drag-and-drop: a native drag that ends off
  // a row never fires drop and left the row stuck half-dragged.
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null)
  const dragRef = useRef<{ from: number; over: number } | null>(null)
  const n = pts.contours.length
  const flip = (s: Set<number>, i: number) => { const x = new Set(s); if (x.has(i)) x.delete(i); else x.add(i); return x }
  const allHidden = n > 0 && hidden.size === n, allLocked = n > 0 && locked.size === n

  const startDrag = (ci: number) => {
    dragRef.current = { from: ci, over: ci }
    setDrag(dragRef.current)
    // Listen now, not in an effect: a quick click's mouseup can arrive before
    // an effect runs, leaving the drag open and the next row as its target.
    window.addEventListener('mouseup', () => {
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!d || d.over === d.from) return
      const order = [...Array(n).keys()]
      order.splice(d.over, 0, ...order.splice(d.from, 1))
      edit('reorder', { order })
    }, { once: true })
  }
  const dragOver = (ci: number) => {
    if (!dragRef.current) return
    dragRef.current = { ...dragRef.current, over: ci }
    setDrag(dragRef.current)
  }

  const row = 'flex h-8 items-center gap-1.5 px-2'
  const layerRow = (label: string, on: boolean, toggle: () => void, extra?: React.ReactNode, swatch?: string) => (
    <div className={row}>
      {swatch ? <span className="grid size-5 shrink-0 place-items-center"><span className="size-2 rounded-full" style={{ background: swatch }} /></span> : <span className="size-5" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {extra}
      <Toggle on={on} onClick={toggle} label={on ? 'Hide' : 'Show'} iconOn={Eye} iconOff={EyeOff} />
    </div>
  )

  return (
    <div ref={root} className={docked ? 'flex h-full w-full flex-col overflow-hidden text-xs' : `absolute right-2 flex w-64 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-md border bg-card/95 text-xs shadow-sm backdrop-blur ${vis.rulers ? 'top-7 max-h-[calc(100%-2.25rem)]' : 'top-2 max-h-[calc(100%-1rem)]'}`}>
      {!docked && (
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <button type="button" className="flex items-center gap-1" aria-expanded={!collapsed}
          onClick={() => { if (narrow) { setNarrowOpen(!narrowOpen); return } localStorage.setItem(storageKey, collapsed ? 'open' : 'collapsed'); setCollapsed(!collapsed) }}>
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          <span className="font-medium text-muted-foreground">Layers</span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild><Info className="size-3 text-muted-foreground" /></TooltipTrigger>
          <TooltipContent className="max-w-64">
            Fonts are one colour, so shapes don't sit on top of each other. Overlapping shapes going the same
            way merge; the opposite way cuts a hole. ↻ clockwise, ↺ counter-clockwise. Drag rows to change drawing order.
            Font info, Drawing has Allow overlap, which makes crossing shapes always merge.
          </TooltipContent>
        </Tooltip>
      </div>
      )}
      {!collapsed && <div className="min-h-0 flex-1 overflow-y-auto select-none">
        {/* the glyph's own shapes: eye and lock show on hover, or stay when they are in use */}
        <Head title="Shapes" count={n + pts.refs_list.length} tip="What the glyph is made of. Drag a row to change the drawing order; double-click a name to rename it.">
          <Toggle on={!allHidden} onClick={() => onHidden(allHidden ? new Set() : new Set(Array(n).keys()))} label="Show/hide all shapes" iconOn={Eye} iconOff={EyeOff} />
          <Toggle on={allLocked} onClick={() => onLocked(allLocked ? new Set() : new Set(Array(n).keys()))} label="Lock/unlock all shapes" iconOn={Lock} iconOff={LockOpen} />
        </Head>
        {pts.contours.length === 0 && pts.refs_list.length === 0 && <p className="px-3 py-2 text-muted-foreground">Nothing drawn yet.</p>}
        {pts.contours.map((c, ci) => {
          const stroke = parseStroke(pts.shapes[ci]?.name)
          const used = hidden.has(ci) || locked.has(ci)
          return (
            <div key={ci}
              onMouseDown={e => { if (e.button === 0 && editable && renaming === null) startDrag(ci) }}
              onMouseEnter={() => dragOver(ci)}
              onClick={e => !locked.has(ci) && !(drag && drag.over !== drag.from) && onSelectShape(ci, e.shiftKey)}
              className={`group ${row} ${selected.has(ci) ? 'bg-accent shadow-[inset_2px_0_0_var(--point-start)]' : 'hover:bg-accent/50'}
                ${hidden.has(ci) ? 'opacity-60' : ''}
                ${drag?.from === ci && drag.over !== ci ? 'opacity-50' : ''}
                ${drag && drag.over === ci && drag.from !== ci ? (drag.over < drag.from ? 'shadow-[inset_0_2px_0_var(--point-start)]' : 'shadow-[inset_0_-2px_0_var(--point-start)]') : ''}`}>
              <Thumb pts={pts} ci={ci} quadratic={quadratic} />
              {renaming === ci ? (
                <Input autoFocus defaultValue={pts.shapes[ci]?.name} className="h-6 px-1 text-xs"
                  onClick={e => e.stopPropagation()}
                  onBlur={e => { edit('rename', { contour: ci, label: e.target.value }); setRenaming(null) }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }} />
              ) : (
                <span className="min-w-0 flex-1 truncate" onDoubleClick={() => editable && !stroke && setRenaming(ci)}
                  title={stroke ? 'A stroke: change it in the Properties panel, or Expand it into an outline' : 'Double-click to rename (saved in .sfd)'}>
                  {stroke ? `Stroke · ${stroke.width}` : pts.shapes[ci]?.name || `Shape ${ci + 1}`}
                </span>
              )}
              {inverted.has(ci) && <span className="shrink-0 font-mono text-[10px] text-primary" title="Inversion: runs against the shapes it meets, so it cuts them out instead of adding to them">[inv]</span>}
              <span className="w-3 text-center text-muted-foreground" title={pts.shapes[ci]?.closed === false ? 'open path' : pts.shapes[ci]?.cw ? 'clockwise' : 'counter-clockwise'}>
                {pts.shapes[ci]?.closed === false ? '–' : pts.shapes[ci]?.cw ? '↻' : '↺'}
              </span>
              <span className="w-6 text-right font-mono text-muted-foreground" title="points">{c.length}</span>
              <span className={`flex shrink-0 items-center ${used ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                <Toggle on={!hidden.has(ci)} onClick={() => onHidden(flip(hidden, ci))} label="Show/hide shape" iconOn={Eye} iconOff={EyeOff} />
                <Toggle on={locked.has(ci)} onClick={() => onLocked(flip(locked, ci))} label="Lock/unlock shape" iconOn={Lock} iconOff={LockOpen} />
                {editable && <button type="button" title="Delete shape (Ctrl Z brings it back)" aria-label="Delete shape"
                  className="grid size-5 place-items-center rounded-[3px] text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); edit('delete_contours', { contours: [ci] }) }}><X className="size-3" /></button>}
              </span>
            </div>
          )
        })}
        {pts.refs_list.map((r, i) => (
          <div key={'r' + i} className={`${row} text-muted-foreground`}>
            <span className="grid size-5 place-items-center rounded-[3px] bg-background">⧉</span>
            <span className="flex-1 truncate">Component: {r}</span>
          </div>
        ))}
        {editable && pts.refs_list.length > 0 && (
          <div className="flex flex-wrap gap-1 px-2 py-1">
            <Button size="xs" variant="outline" title="Turn the components of this glyph into real outlines you can edit. They stop following the original glyphs. Ctrl Z undoes it."
              onClick={() => edit('unlink')}>Make editable</Button>
            <Button size="xs" variant="outline" title="Keep this glyph as it is and make a new glyph from a flattened copy of it, e.g. your own accent from acute + dieresis"
              onClick={() => {
                const name = pts.refs_list.join('_') + '.custom'  // rename it afterwards like any glyph
                void api<{ name: string }>('/api/copy-flat', { name: pts.name, new: name })
                  .then(r => { toast.success(`Made ${r.name}`, { description: 'A separate glyph with its own outlines.' }); window.dispatchEvent(new CustomEvent('forge:new-glyph', { detail: r.name })) })
                  .catch(e => toast.error('Could not make it', { description: (e as Error).message }))
              }}>Save as new glyph</Button>
          </div>
        )}
        {/* things drawn under or over the glyph, when there are any */}
        {hasBackground && layerRow('Background', vis.background, () => onVis({ ...vis, background: !vis.background }), undefined, 'var(--secondary)')}
        {underlayName && layerRow(`Base guide: ${underlayName}`, vis.underlay, () => onVis({ ...vis, underlay: !vis.underlay }), undefined, 'var(--muted-foreground)')}
        {mastersName && layerRow(`Masters: ${mastersName}`, vis.masters, () => onVis({ ...vis, masters: !vis.masters }), undefined, 'var(--point-off)')}
        {referenceName && layerRow(`Reference: ${referenceName}`, vis.reference, () => onVis({ ...vis, reference: !vis.reference }), undefined, 'var(--reference)')}

        {/* Anchors: where accents attach (base on letters, mark on accents) */}
        <Head title="Anchors" count={anchors.length} tip={'Anchors are named points that say where an accent attaches. Put a base anchor called "top" on a letter, above where an accent should sit, and a mark anchor on the accent itself. Scrifts then places the accent on any letter that has that anchor (Accents view, "Place all by anchors"). Add as many as the letter needs: top, bottom, ogonek.'} />
        {anchors.length === 0 && <p className="px-3 py-1.5 text-[11px] leading-snug text-muted-foreground">None yet. Name one below and press +; hover ⓘ for what they are for.</p>}
        {anchors.map(a => {
          const on = selAnchor?.cls === a.cls && selAnchor.type === a.type
          return (
            <div key={a.cls + a.type} onClick={() => onSelectAnchor(on ? null : a)}
              className={`group ${row} ${on ? 'bg-accent shadow-[inset_2px_0_0_var(--point-start)]' : 'hover:bg-accent/50'}`}>
              <span className="grid size-5 shrink-0 place-items-center"><span className={`size-2 rotate-45 ${a.type === 'mark' ? 'bg-(--shadow)' : 'bg-(--reference)'}`} /></span>
              <span className="min-w-0 flex-1 truncate">{a.type === 'mark' ? '_' : ''}{a.cls}</span>
              <span className="font-mono text-muted-foreground">{Math.round(a.x)}, {Math.round(a.y)}</span>
              {editable && <Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Delete anchor ${a.cls}`}
                onClick={e => { e.stopPropagation(); onDeleteAnchor(a) }}><X /></Button>}
            </div>
          )
        })}
        {inherited.length > 0 && (
          <>
            <p className="px-3 pt-1.5 text-[11px] leading-snug text-muted-foreground">From the components. Changing one changes it in that component, so every letter built from it follows.</p>
            {inherited.map((h, i) => (
              <div key={h.comp + h.a.cls + h.a.type} className={`${row} gap-2`}>
                <span className="grid size-5 shrink-0 place-items-center"><span className={`size-2 rotate-45 border ${h.a.type === 'mark' ? 'border-(--shadow)' : 'border-(--reference)'}`} /></span>
                <span className="min-w-0 flex-1 truncate" title={`${h.a.type === 'mark' ? '_' : ''}${h.a.cls} of ${h.comp}`}>{h.comp} · {h.a.type === 'mark' ? '_' : ''}{h.a.cls}</span>
                <div className="w-16 shrink-0"><NumField label="x" value={Math.round(h.x)} disabled={!editable} onCommit={n => onInherited?.(i, n, h.y)} /></div>
                <div className="w-16 shrink-0"><NumField label="y" value={Math.round(h.y)} disabled={!editable} onCommit={n => onInherited?.(i, h.x, n)} /></div>
              </div>
            ))}
          </>
        )}
        {editable && (
          <form className={row} onSubmit={e => {
            e.preventDefault()
            const n = newCls.trim()
            if (!n || /\s/.test(n)) return
            // "_top" is how Glyphs names an accent's anchor: the mark anchor of class top
            if (n.startsWith('_') && n.length > 1) onAddAnchor(n.slice(1), 'mark')
            else onAddAnchor(n, 'base')
          }}>
            <Input list="anchor-classes" value={newCls} onChange={e => setNewCls(e.target.value)} placeholder="top on a letter, _top on an accent" title="Letters get top (or bottom); accents get _top (or _bottom). A letter's top and an accent's _top are linked: the accent sits with its _top on the letter's top."
              className="h-6 min-w-0 flex-1 px-1.5 font-mono text-xs" />
            <datalist id="anchor-classes">{classes.map(c => <option key={c.name} value={c.name} />)}</datalist>
            <Button type="submit" size="icon-xs" variant="ghost" aria-label="Add anchor"><Plus /></Button>
          </form>
        )}

        {/* Guides, shadow letter and grid: a switch each, and the one input that goes with it */}
        <Head title="Guides" count={guides.length + vguides.length} tip="Lines for the whole font, saved with it, to line shapes up against. y is a horizontal line at that height, x a vertical line at that position. Type a number below and press Enter to add one; drag a guide on the canvas to move it, or pull one out of a ruler (top ruler: horizontal, left ruler: vertical) and drop it back there to delete it.">
          <Switch checked={vis.guides} onCheckedChange={on => onVis({ ...vis, guides: on })} label="Show guides" />
        </Head>
        {([['y', guides, onGuides], ['x', vguides, onVGuides]] as const).map(([axis, list, set]) => list.map((v, i) => (
          <div key={axis + i} className={`group ${row} hover:bg-accent/50`}>
            <div className="min-w-0 flex-1"><NumField label={axis} value={v} disabled={!editable} onCommit={n => set(list.map((g, j) => j === i ? n : g))} /></div>
            {editable && <Button size="icon-xs" variant="ghost" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Remove the ${axis} guide at ${v}`} onClick={() => set(list.filter((_, j) => j !== i))}><X /></Button>}
          </div>
        )))}
        {editable && (
          <form className={row} onSubmit={e => {
            e.preventDefault()
            if (newGuide.trim() !== '' && !isNaN(+newGuide)) { onVis({ ...vis, guides: true }); if (newAxis === 'y') onGuides([...guides, +newGuide]); else onVGuides([...vguides, +newGuide]) }
            setNewGuide('')
          }}>
            <Select value={newAxis} onChange={e => setNewAxis(e.target.value as 'x' | 'y')} className="h-6 w-24 px-1.5 text-xs" aria-label="Kind of guide">
              <option value="y">Horizontal</option><option value="x">Vertical</option>
            </Select>
            <Input value={newGuide} onChange={e => setNewGuide(e.target.value)} inputMode="decimal" placeholder={newAxis === 'y' ? 'Height' : 'Position'} aria-label="Position of a new guide"
              className="h-6 min-w-0 flex-1 px-1.5 font-mono text-xs" />
            <Button type="submit" size="icon-xs" variant="ghost" aria-label="Add the guide" disabled={newGuide.trim() === '' || isNaN(+newGuide)}><Plus /></Button>
          </form>
        )}

        <Head title="Shadow letter" tip="Another letter drawn faintly behind this one, from the same origin, to match spacing (É against E). Type a letter, /name or U+XXXX. Left empty it is the base letter of an accented glyph, or else this glyph's own character in the system font (to see how it is written).">
          <Switch checked={vis.shadow} onCheckedChange={on => onVis({ ...vis, shadow: on })} label="Show the shadow letter" />
        </Head>
        <div className={row}>
          <Input key={shadowName ?? ''} defaultValue={shadowName ?? ''} placeholder={autoShadow ? `${autoShadow} (the base letter)` : 'This letter in the system font, or type one'} aria-label="Shadow letter"
            title="A letter, /name or U+XXXX; empty = the base letter (É → E)"
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            onBlur={e => { onShadow(e.target.value); if (e.target.value.trim() !== '' && !vis.shadow) onVis({ ...vis, shadow: true }) }}
            className="h-6 min-w-0 flex-1 px-1.5 font-mono text-xs" />
          {shadowName && shadowName === autoShadow && <span className="text-muted-foreground">auto</span>}
        </div>

        <Head title="Grid" tip="A background grid whose spacing follows the zoom. Dots or lines; with Snap on, points snap to it while smart guides are on.">
          <Switch checked={vis.grid} onCheckedChange={on => onVis({ ...vis, grid: on })} label="Show the grid" />
        </Head>
        <div className={row}>
          <Select value={gridStyle} onChange={e => setSettings({ gridStyle: e.target.value as 'dots' | 'lines' })} className="h-6 w-24 px-1.5 text-xs" aria-label="Grid style">
            <option value="dots">Dots</option><option value="lines">Lines</option>
          </Select>
          <label className="flex items-center gap-1.5 text-muted-foreground"><input type="checkbox" checked={snapToGrid} onChange={e => setSettings({ snapToGrid: e.target.checked })} />Snap to grid</label>
        </div>
      </div>}
    </div>
  )
}
