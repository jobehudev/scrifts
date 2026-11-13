import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Grid3x3, Hand, Magnet, Maximize, MousePointer2, PenTool, Circle, Square, Ruler, Scaling, Shapes, Undo2, Redo2, ZoomIn, History } from 'lucide-react'
import { api, contourPath, outlines, toPath, type Anchor as FontAnchor, type AnchorClass, type FontInfo, type Location, type Points, type OutlineStore, type Pt3, type RawOutline, type Reference } from './api'
import { samePath, type BlendGlyph, type MasterOps } from './FamilyBar'
import { clipContours, getClip, setClip, type P3 } from './clip'
import { theme, useCanvas, useOutlineVersion } from './canvas'
import { ActionsBar } from './ActionsBar'
import { useCommands } from './commands'
import { getSettings, useSettings } from './settings'
import { createPortal } from 'react-dom'
import { LIGATURES } from './ActionsBar'
import { LayersPanel, type LayerVis } from './LayersPanel'
import { LayersHost } from './layersHost'
import { parseStroke, strokeMark, type StrokeSpec } from './strokes'
import { propsStore, type PropsActions, type PropsState } from './propsStore'
import {
  applyMatrix, bboxPointsOf, computeSmartSnap, drawSmartGuides, drawTransformBox,
  hitSegment, hitTransformBox, rotateMatrix, scaleMatrix, selectionBounds,
  subdivideContourSegment, togglePointSmooth, type ScaleHandle, type SmartGuide,
} from './smart'
import { oval, rect } from './primitives'
import { cornerAt, findRounded, radiusFromDrag, roundPoints, sharpenPoints, widgetPos, type CornerKind } from './corners'
import { CornersDialog } from './CornersDialog'
import { pointFocus, usePointFocus } from './pointFocus'
import { useCompareMarks } from './compareMarks'
import { nextGroup, parseSvgTag, svgGroups, svgTag, type SvgStyle } from './svgStyle'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

type Tool = 'object' | 'select' | 'pen' | 'rect' | 'oval' | 'shaper' | 'hand' | 'zoom' | 'measure'
type View = { z: number; tx: number; ty: number }  // applied on top of fit-to-window
type Pt = { x: number; y: number }                 // font units
type Anchor = Pt & { out?: Pt; in?: Pt }           // pen tool: point with optional handles
type Drag =
  | { kind: 'pan'; sx: number; sy: number; view: View }
  | { kind: 'measure'; a: Pt }
  | { kind: 'move'; start: Pt; dx: number; dy: number; alt: boolean; primary?: [number, number] }
  | { kind: 'box_scale'; bounds: NonNullable<ReturnType<typeof selectionBounds>>; handle: ScaleHandle; matrix: [number, number, number, number, number, number] }
  | { kind: 'box_rotate'; bounds: NonNullable<ReturnType<typeof selectionBounds>>; startAngle: number; angle: number; matrix: [number, number, number, number, number, number] }
  | { kind: 'marquee'; a: Pt; b: Pt; add: boolean }
  | { kind: 'pen' }
  | { kind: 'corner'; ci: number; pi: number; r: number; single: boolean; sharpen?: boolean }  // a corner widget: its radius while dragged (Ctrl: this corner only)
  | { kind: 'shape'; a: Pt; b: Pt; square: boolean; center: boolean }  // Rectangle/Oval: dragged from a corner; Shift: square, Alt: from the middle
  | { kind: 'shaper'; pts: Pt[]; alt: boolean }  // Shape Builder: the path dragged across the regions so far; alt: removing them
  | { kind: 'bearing'; side: 'L' | 'R'; sx: number; dx: number }  // FontForge-style: drag the metric lines
  | { kind: 'anchor'; a: FontAnchor; start: Pt; dx: number; dy: number }
  | { kind: 'guide'; axis: 'x' | 'y'; i: number; v: number; out: boolean }  // a guide being moved (i past the end: a new one from a ruler); out: over a ruler, where letting go deletes it
/** Edits that change a glyph's point structure (the weight, move and transform edits do not). */
const STRUCTURAL = new Set(['insert_point', 'delete_points', 'delete_contours', 'add_contour', 'pathfinder', 'shape_build', 'remove_overlap', 'clean_up',
  'simplify', 'add_extrema', 'add_inflections', 'round_corners', 'expand_strokes', 'paste', 'reverse', 'correct_direction', 'draft_ligature', 'clear', 'balance', 'harmonize'])
const FIT: View = { z: 1, tx: 0, ty: 0 }
const HIT_PX = 7
const EDGE_PX = 5  // how near a sidebearing line the pointer grabs it
/** A turning arrow, for the zone just outside a corner of the selection box. */
const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"/><path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" stroke="black" stroke-width="2"/></svg>')}") 12 12, grab`
let hitCtx: CanvasRenderingContext2D | null = null  // scratch canvas for outline hit tests
const CLOSE_PX = 10  // pen: how near the first point a click closes the path
const RULER_PX = 20
const GRID_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]
const key = (ci: number, pi: number) => `${ci}:${pi}`
const unkey = (k: string) => k.split(':').map(Number) as [number, number]
const SMOOTH = new Set([1, 2])  // fontforge.splineCurve, splineHVCurve

const TOOLS: { id: Tool; icon: typeof Hand; label: string; key: string; solid?: boolean }[] = [
  { id: 'object', icon: MousePointer2, solid: true, label: 'Selection: click anywhere on a shape to select all of it, drag to move it, box-select to pick several (Shift adds). Selected shapes get a box to scale and rotate. A picks single points instead', key: 'V' },
  { id: 'select', icon: MousePointer2, label: 'Direct Selection: click or box-select points, drag to move. Alt-drag a handle breaks it from its twin. Drag a guide to move it; drag out of a ruler for a new one, back into it to delete', key: 'A' },
  { id: 'pen', icon: PenTool, label: 'Pen: click for a corner, drag for a curve, click the first point to close. Enter ends an open path. Click on an existing outline to add a point there (Ctrl: start a new path instead). Switch to Stroke in the bar to draw paths with a width', key: 'P' },
  { id: 'rect', icon: Square, label: 'Rectangle: drag a corner to the other. Shift makes a square, Alt draws from the middle', key: 'M' },
  { id: 'oval', icon: Circle, label: 'Oval: drag across its box. Shift makes a circle, Alt draws from the middle', key: 'L' },
  { id: 'shaper', icon: Shapes, label: 'Shape Builder: drag across the regions that overlapping shapes make to fuse them into one; Alt-drag (or Alt-click) removes regions', key: 'Shift M' },
  { id: 'hand', icon: Hand, label: 'Hand: drag to pan (or hold Space)', key: 'H' },
  { id: 'zoom', icon: ZoomIn, label: 'Zoom: click in, Alt+click out (wheel zooms anywhere)', key: 'Z' },
  { id: 'measure', icon: Ruler, label: 'Measure: drag, snaps to points; Shift locks angle', key: 'K' },
]

/** The box a Rectangle/Oval drag covers, in font units. */
function shapeBox(d: { a: Pt; b: Pt; square: boolean; center: boolean }) {
  let dx = d.b.x - d.a.x, dy = d.b.y - d.a.y
  if (d.square) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m }
  const x0 = d.center ? d.a.x - dx : d.a.x, y0 = d.center ? d.a.y - dy : d.a.y, x1 = d.a.x + dx, y1 = d.a.y + dy
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) }
}

function Tip({ label, k, children }: { label: string; k?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-72">{label}{k && <Kbd className="ml-2">{k}</Kbd>}</TooltipContent>
    </Tooltip>
  )
}

/** Pen anchors -> FontForge point list (cubic: on, off, off, on; lines have no offs). */
function penPoints(anchors: Anchor[], closed: boolean): [number, number, number][] {
  const out: [number, number, number][] = [[anchors[0].x, anchors[0].y, 1]]
  const n = anchors.length
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const s = anchors[i], t = anchors[(i + 1) % n]
    if (s.out || t.in) out.push([(s.out ?? s).x, (s.out ?? s).y, 0], [(t.in ?? t).x, (t.in ?? t).y, 0])
    if (!(closed && i === n - 1)) out.push([t.x, t.y, 1])
  }
  return out
}

/**
 * Glyph view and outline editor. Every edit is a FontForge call (move,
 * delete, add contour, pathfinder, transform, undo); while dragging, the
 * outline is redrawn locally and replaced by the core's result on release.
 */
/** Spacing and combining accents (´ ` ^ ¨ ˜ ¸ ˚ and U+0300–036F): characters that sit on letters. */
const isAccentChar = (u: number) => [0x60, 0x5e, 0x7e, 0xa8, 0xaf, 0xb4, 0xb8].includes(u) || (u >= 0x2c6 && u <= 0x2dd) || (u >= 0x300 && u <= 0x36f)

export function GlyphView({ font, name, loc, guides, onGuides, vguides = [], onVGuides = () => {}, reference, ghosts = [], blend, masterOps, underlay, onMoveWhole, onEdited }: {
  font: FontInfo; name: string | null; loc: Location | null
  guides: number[]; onGuides: (ys: number[]) => void
  /** vertical guides (fixed x, the same for every glyph) */
  vguides?: number[]; onVGuides?: (xs: number[]) => void
  reference: Reference | null
  /** The family's other masters: the same glyph drawn behind, outlined. */
  ghosts?: { label: string; store: OutlineStore }[]
  /** The glyph blended at a preview weight (null glyph: its masters don't match). */
  blend?: { name: string; weight: number; glyph: BlendGlyph | null } | null
  /** Copy this glyph between the family's masters (right-click menu). */
  masterOps?: MasterOps
  /** Accent mode: a base glyph drawn behind, where a composite would put it. */
  underlay?: { name: string; dx: number; dy: number } | null
  /** Accents: moving the whole accent moves where it sits in the letter, not its outline (which every composite shares) */
  onMoveWhole?: (dx: number, dy: number) => void
  onEdited?: () => void
}) {
  const [fetchedPts, setFetchedPts] = useState<Points | null>(null)
  const [tool, setTool] = useState<Tool>('object')
  const [space, setSpace] = useState(false)
  const [view, setView] = useState<View>(FIT)
  const [measure, setMeasure] = useState<{ a: Pt; b: Pt } | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [cornerKind, setCornerKind] = useState<CornerKind>(() => (localStorage.getItem('forge.cornerKind') as CornerKind) || 'round')
  const [cornerDlg, setCornerDlg] = useState<{ r: number } | null>(null)  // the Corners dialog; r: the radius being previewed
  // the last rounding, kept live: the outline from before it, so its widgets can be dragged back out (undo + redo with the new radius)
  const [live, setLive] = useState<{ name: string; base: Points; pairs: [number, number][]; r: number; expect: number } | null>(null)
  const liveOn = live && live.name === name ? live : null
  const [pen, setPen] = useState<Anchor[]>([])
  const [hover, setHover] = useState<Pt | null>(null)
  const [overGuide, setOverGuide] = useState<'x' | 'y' | null>(null)  // the pointer is on a guide: it can be dragged
  const [addingPoint, setAddingPoint] = useState(false)  // pen is over the outline: a click adds a point there
  // the pen draws outlines (default) or strokes: open paths with a width, that FontForge turns into outlines on Expand / Generate
  const [stroke, setStroke] = useState<StrokeSpec & { on: boolean }>(() => {
    try { return { on: false, width: 80, cap: 'round', join: 'round', ...JSON.parse(localStorage.getItem('forge.stroke') ?? '{}') } } catch { return { on: false, width: 80, cap: 'round', join: 'round' } }
  })
  const [smartGuides, setSmartGuides] = useState<SmartGuide[]>([])
  const [vis, setVisState] = useState<LayerVis>(() => {
    const defaults: LayerVis = { guides: true, background: true, reference: true, masters: true, underlay: true, shadow: true, grid: true, rulers: true, smart: true }
    try { return { ...defaults, ...JSON.parse(localStorage.getItem('forge.vis') ?? '{}') } } catch { return defaults }
  })
  const setVis = useCallback((v: LayerVis | ((prev: LayerVis) => LayerVis)) => {
    setVisState(prev => {
      const next = typeof v === 'function' ? v(prev) : v
      localStorage.setItem('forge.vis', JSON.stringify(next))
      return next
    })
  }, [])
  const [shadowPick, setShadowPick] = useState<string | null>(null)  // user's choice; null = automatic
  const [edgeHover, setEdgeHover] = useState<'L' | 'R' | null>(null)
  const [boxHover, setBoxHover] = useState<'rotate' | null>(null)  // the pointer is near a corner of the selection box: dragging turns it
  const [selAnchor, setSelAnchor] = useState<FontAnchor | null>(null)
  const [classes, setClasses] = useState<AnchorClass[]>([])
  useEffect(() => { api<AnchorClass[]>('/api/anchor-classes').then(setClasses).catch(() => {}) }, [font])
  // oxlint-disable-next-line react/set-state-in-effect -- reset per-glyph UI state when the glyph or font changes
  useEffect(() => { setSelAnchor(null) }, [name, font])
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [locked, setLocked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const xf = useRef({ s: 1, ox: 0, base: 0 })  // last drawn transform, for hit-testing
  const pending = useRef(Promise.resolve())    // edits run strictly in order
  const { gridStyle, snapToGrid } = useSettings()
  useOutlineVersion(reference?.store)
  const [, ghostTick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const u = ghosts.map(g => g.store.subscribe(ghostTick))
    return () => u.forEach(f => f())
  }, [ghosts])
  const ghostOutlines = name ? ghosts.map(g => g.store.want(name, null)).filter(o => !!o) : []

  const cachedPts = name ? outlines.getPoints(name) : undefined
  // the shared store is the truth (panels, smart parts and interpolation write to it); the local copy only fills a gap
  const pts = (cachedPts ?? (fetchedPts && fetchedPts.name === name ? fetchedPts : undefined)) ?? null

  useEffect(() => {
    if (!name || outlines.getPoints(name)) return
    let stale = false
    api<Points>(`/api/glyph/${encodeURIComponent(name)}`)
      .then(res => {
        if (stale) return
        outlines.putPoints(res)
        setFetchedPts(res)
      })
      .catch(() => {})
    return () => { stale = true }
  }, [name, font])
  // oxlint-disable-next-line react/set-state-in-effect -- same reset
  useEffect(() => { setView(FIT); setMeasure(null) }, [font])
  // a point picked in the Compare masters panel: select it as soon as this master and glyph are the ones on screen
  const wantedPoint = usePointFocus()
  const compared = useCompareMarks()  // points only this master has (Compare masters panel): drawn red
  const extraKeys = compared && compared.glyph === name ? compared.byPath.find(m => samePath(m.path, font.path))?.keys : undefined
  useEffect(() => {
    if (!wantedPoint || !pts || wantedPoint.glyph !== name) return
    if (!samePath(wantedPoint.path, font.path)) return
    if (pts.contours[wantedPoint.ci]?.[wantedPoint.pi]) setSel(new Set([key(wantedPoint.ci, wantedPoint.pi)]))
    pointFocus.clear()
  }, [wantedPoint, pts, name, font.path])  // eslint-disable-line react-hooks/exhaustive-deps
  // oxlint-disable-next-line react/set-state-in-effect -- same reset
  useEffect(() => { setMeasure(null); setSel(new Set()); setPen([]); setHidden(new Set()); setLocked(new Set()); setShadowPick(null) }, [name, font])

  // Points and edits are on the FontForge model, i.e. the default master.
  const atDefault = !loc
  const layersHost = useContext(LayersHost)
  const editable = atDefault && !!pts && pts.name === name
  const o = name ? outlines.want(name, loc) : undefined
  const glyphInfo = font.glyphs.find(g => g.name === name)
  const refName = reference && glyphInfo
    ? (reference.info.glyphs.find(g => glyphInfo.unicode >= 0 && g.unicode === glyphInfo.unicode)
      ?? reference.info.glyphs.find(g => g.name === name))?.name
    : undefined
  const refOutline = reference && refName ? reference.store.want(refName, null) : undefined
  const under = underlay ? outlines.want(underlay.name, null) : undefined
  // Shadow letter: by default the base of an accented letter (É -> E), so its
  // spacing can be matched; any glyph can be picked instead.
  const autoShadow = useMemo(() => {
    if (!glyphInfo) return null
    if (glyphInfo.unicode >= 0) {
      const base = String.fromCodePoint(glyphInfo.unicode).normalize('NFD').codePointAt(0)!
      if (base !== glyphInfo.unicode) return font.glyphs.find(g => g.unicode === base)?.name ?? null
    }
    return null
  }, [glyphInfo, font])
  const shadowName = shadowPick ?? autoShadow
  const shadow = shadowName && shadowName !== name ? outlines.want(shadowName, loc) : undefined
  // Selection (whole shapes) and Direct Selection (points) share the selecting behaviours: guides, rulers, corner widgets, the transform box
  const active: Tool = space ? 'hand' : !atDefault && (tool === 'object' || tool === 'select' || tool === 'pen' || tool === 'rect' || tool === 'oval' || tool === 'shaper') ? 'hand' : tool

  const picking = active === 'object' || active === 'select'

  /** Selected points plus the handles that travel with selected on-curve points. */
  const moving = useMemo(() => {
    const out = new Set(sel)
    if (!pts) return out
    for (const k of sel) {
      const [ci, pi] = unkey(k)
      const c = pts.contours[ci]
      if (!c?.[pi]?.[2]) continue
      for (const j of [(pi + c.length - 1) % c.length, (pi + 1) % c.length]) if (!c[j][2]) out.add(key(ci, j))
    }
    return out
  }, [sel, pts])

  /**
   * Per-point deltas for a move. A handle dragged on its own swings its twin
   * across a smooth point so the curve stays smooth (Illustrator behaviour);
   * Alt skips that and breaks the pair.
   */
  const deltas = useCallback((dx: number, dy: number, alt: boolean) => {
    const d = new Map<string, [number, number]>()
    for (const k of moving) d.set(k, [dx, dy])
    if (alt || !pts) return d
    for (const k of moving) {
      const [ci, pi] = unkey(k)
      const c = pts.contours[ci], n = c.length
      if (c[pi][2]) continue
      for (const [ai, ti] of [[(pi + n - 1) % n, (pi + n - 2) % n], [(pi + 1) % n, (pi + 2) % n]]) {
        const a = c[ai], twin = c[ti]
        if (!a[2] || !SMOOTH.has(a[3] ?? 0) || twin[2] || moving.has(key(ci, ai)) || moving.has(key(ci, ti))) continue
        const hx = c[pi][0] + dx - a[0], hy = c[pi][1] + dy - a[1]
        const len = Math.hypot(hx, hy), tl = Math.hypot(twin[0] - a[0], twin[1] - a[1])
        if (!len) continue
        d.set(key(ci, ti), [Math.round(a[0] - hx / len * tl - twin[0]), Math.round(a[1] - hy / len * tl - twin[1])])
      }
    }
    return d
  }, [moving, pts])

  const shown = useMemo(() => {
    if (!pts) return null
    if (drag?.kind === 'box_scale' || drag?.kind === 'box_rotate') {
      const mat = drag.matrix
      return pts.contours.map((c, ci) => c.map((p, pi) => {
        if (!moving.has(key(ci, pi))) return p
        const [nx, ny] = applyMatrix(mat, p[0], p[1])
        return [nx, ny, p[2], p[3]] as Pt3
      }))
    }
    if (drag?.kind === 'corner' || cornerDlg) {  // a corner being rounded, before the edit is made
      const r = drag?.kind === 'corner' ? drag.r : cornerDlg!.r
      const single = drag?.kind === 'corner' && drag.single
      const base = liveOn?.base ?? pts
      const list: [number, number][] = liveOn ? liveOn.pairs : single ? [[(drag as { ci: number }).ci, (drag as { pi: number }).pi]] : [...sel].map(unkey)
      if (drag?.kind === 'corner' && drag.sharpen) {  // sharpening round corners, then rounding them to the new radius
        return base.contours.map((c, ci) => {
          const closed = base.shapes[ci]?.closed ?? true
          const only = single ? ci === drag.ci : sel.size > 0
          const ps = new Set<number>(single ? [drag.pi, drag.pi + 1, drag.pi + 2, drag.pi + 3].map(i => i % c.length) : [...sel].filter(k => unkey(k)[0] === ci).map(k => unkey(k)[1]))
          if (!only || !ps.size) return c
          const sh = sharpenPoints(c, closed, ps)
          return (r > 0 ? roundPoints(sh.pts, closed, new Set(sh.corners), r, cornerKind) : sh.pts) as Pt3[]
        })
      }
      return base.contours.map((c, ci) => {
        const ps = new Set(list.filter(([a]) => a === ci).map(([, b]) => b))
        return ps.size ? roundPoints(c, base.shapes[ci]?.closed ?? true, ps, r, cornerKind) as Pt3[] : c
      })
    }
    const m = drag?.kind === 'move' ? drag : null
    if (!m || (!m.dx && !m.dy)) return pts.contours
    const d = deltas(m.dx, m.dy, m.alt)
    return pts.contours.map((c, ci) => c.map((p, pi) => {
      const v = d.get(key(ci, pi))
      return v ? [p[0] + v[0], p[1] + v[1], p[2], p[3]] as Pt3 : p
    }))
  }, [pts, drag, deltas, moving, sel, cornerKind, cornerDlg, liveOn])

  const selBounds = useMemo(() => (shown && editable ? selectionBounds(shown, sel) : null), [shown, editable, sel])

  /** Smart-snap a point in font coordinates and return the snapped point + active SmartGuides. */
  const smartSnap = useCallback((
    raw: Pt,
    opts: {
      origin?: Pt | null
      isHandle?: boolean
      parentAnchor?: Pt | null
      oppositeHandle?: Pt | null
      neighborOnCurve?: Pt | null
      exclude?: Set<string>
    } = {},
  ): { pt: Pt; guides: SmartGuide[] } => {
    if (!vis.smart || !pts || !o) return { pt: raw, guides: [] }
    const s = xf.current.s || 1
    const tol = Math.max(1, 6.5 / s)
    const hMetrics = [
      { y: 0, label: 'baseline' },
      ...(font.xheight ? [{ y: font.xheight, label: 'x-height' }] : []),
      ...(font.capheight ? [{ y: font.capheight, label: 'cap' }] : []),
      { y: font.ascent, label: 'ascender' },
      { y: -font.descent, label: 'descender' },
      ...(vis.guides ? guides.map(g => ({ y: g, label: `guide ${g}` })) : []),
    ]
    const vMetrics = [
      { x: 0, label: 'L' },
      { x: o.width, label: 'R' },
      { x: Math.round(o.width / 2), label: 'center' },
    ]
    const extraPoints = [
      ...(vis.shadow && shadow && shadowName ? bboxPointsOf(shadow.width, shadow.lsb, shadow.rsb, font.ascent, font.descent, shadowName) : []),
      ...(vis.reference && reference && refOutline && refName ? bboxPointsOf(refOutline.width, refOutline.lsb, refOutline.rsb, font.ascent, font.descent, reference.info.familyname) : []),
    ]
    const step = vis.grid && snapToGrid ? (GRID_STEPS.find(st => st * s >= 22) ?? 500) : null
    return computeSmartSnap({
      raw,
      ...opts,
      contours: pts.contours,
      closed: pts.shapes.map(sh => sh.closed),
      hidden,
      exclude: opts.exclude ?? moving,
      hMetrics,
      vMetrics,
      glyphWidth: o.width,
      anchors: pts.anchors,
      extraPoints,
      gridStep: step,
      tol,
    })
  }, [vis.smart, vis.guides, vis.shadow, vis.reference, vis.grid, snapToGrid, pts, o, font, guides, shadow, shadowName, reference, refOutline, refName, hidden, moving])

  /** The Rectangle/Oval just drawn, kept on screen until FontForge has made it (the edit can queue behind other work). */
  const [justDrawn, setJustDrawn] = useState<{ a: Pt; b: Pt; square: boolean; center: boolean; oval: boolean } | null>(null)
  const run = useCallback((f: () => Promise<Points>) => {
    pending.current = pending.current.then(async () => {
      setBusy(true)
      try {
        const res = await f()
        setFetchedPts(res)
        outlines.putPoints(res)
        outlines.invalidateUsers(res.name)
        onEdited?.()
      } catch (e) {
        if ((e as Error).name !== 'AbortError') toast.error('Edit failed', { description: (e as Error).message })
      } finally { setBusy(false); setJustDrawn(null) }
    })
  }, [onEdited])

  // Shape Builder: the regions the overlapping shapes cut each other into, fetched whenever the outline changes
  const [regions, setRegions] = useState<{ contours: number[]; paths: Path2D[] } | null>(null)
  useEffect(() => {
    if (active !== 'shaper' || !editable || !name || !pts) { setRegions(null); return }
    const contours = pts.contours.flatMap((_, ci) => (pts.shapes[ci]?.closed ?? true) && !hidden.has(ci) && !locked.has(ci) ? [ci] : [])
    if (contours.length < 1) { setRegions(null); return }
    let stale = false
    api<Pt3[][][]>('/api/regions', { name, contours }).then(faces => {
      if (!stale) setRegions({ contours, paths: faces.map(f => contourPath(f, f.map(() => true), font.quadratic)) })
    }).catch(() => { if (!stale) setRegions(null) })
    return () => { stale = true }
  }, [active, editable, name, pts, hidden, locked, font.quadratic])  // eslint-disable-line react-hooks/exhaustive-deps
  /** The regions a path crosses (indexes into `regions`). */
  const crossed = (path: Pt[]) => {
    const ctx = (hitCtx ??= document.createElement('canvas').getContext('2d')!)
    return regions ? regions.paths.flatMap((r, j) => path.some(q => ctx.isPointInPath(r, q.x, q.y)) ? [j] : []) : []
  }

  // edits that add, drop or reorder points: in a family they make this glyph stop matching the other masters (no blending, no variable font)
  const warned = useRef<string | null>(null)
  const edit = useCallback((kind: string, args: Record<string, unknown> = {}) => {
    if (!name) return
    if (masterOps?.others.length && STRUCTURAL.has(kind) && warned.current !== name) {
      warned.current = name
      toast.warning(`${name} will no longer match your other masters`, {
        description: 'This edit adds, removes or reorders points. Masters must keep the same points to blend: undo (Ctrl Z), or make the same edit in every master and check Masters > Check.',
        duration: 9000,
      })
    }
    if (kind !== 'round_corners') setLive(null)
    if (kind !== 'move' && kind !== 'rename' && kind !== 'transform') setSel(new Set())  // indices shift (moving, renaming and transforming keep every point where it is in the list)
    run(() => api<Points>('/api/edit', { name, kind, args }))
  }, [name, run, masterOps?.others.length])

  /** The glyph as it is in the saved file (one undoable step). */
  const restore = () => {
    if (!name) return
    setSel(new Set())
    run(async () => {
      await api('/api/glyphs/restore', { names: [name] })
      toast(`Restored ${name} to the last saved version`, { description: 'Undo (Ctrl Z) brings your edits back.' })
      return api<Points>(`/api/glyph/${encodeURIComponent(name)}`)
    })
  }
  const undo = () => { if (name) { setLive(null); setSel(new Set()); run(() => api<Points>('/api/undo', { name })) } }
  const redo = () => { if (name) { setLive(null); setSel(new Set()); run(() => api<Points>('/api/redo', { name })) } }
  useEffect(() => { setLive(l => !l ? l : l.expect > 0 ? { ...l, expect: l.expect - 1 } : null) }, [pts])  // any outline change after the rounding's own result ends the live widgets

  const moveSel = (dx: number, dy: number, alt = false) => {
    if (!moving.size || (!dx && !dy)) return
    const all = (pts?.contours ?? []).reduce((n, c) => n + c.length, 0)
    if (onMoveWhole && moving.size >= all) { onMoveWhole(Math.round(dx), Math.round(dy)); return }
    edit('move', { moves: [...deltas(dx, dy, alt)].map(([k, v]) => [...unkey(k), ...v]) })
  }

  // While an anchor is dragged, the server already moves it (one request at a time, newest wins), so every
  // letter linked to it (Accents, the grid, Spacing) follows live; letting go stores it as usual.
  const anchorWant = useRef<{ a: FontAnchor; x: number; y: number } | null>(null)
  const anchorBusy = useRef(false)
  const liveAnchor = (a: FontAnchor, dx: number, dy: number) => {
    if (!name) return
    anchorWant.current = { a, x: Math.round(a.x + dx), y: Math.round(a.y + dy) }
    if (anchorBusy.current) return
    anchorBusy.current = true
    const glyph = name
    const step = (): Promise<void> => {
      const w = anchorWant.current
      anchorWant.current = null
      if (!w) return Promise.resolve()
      return api('/api/anchor', { name: glyph, cls: w.a.cls, type: w.a.type, x: w.x, y: w.y })
        .then(() => outlines.invalidateUsers(glyph)).catch(() => {}).then(step)
    }
    void step().finally(() => { anchorBusy.current = false })
  }

  const deleteSel = () => {
    if (!moving.size) return
    edit('delete_points', { points: [...moving].map(unkey) })
  }

  /** The points a transform acts on: the selection, or the whole glyph when nothing is selected. */
  const transformKeys = () => moving.size ? [...moving] : (pts?.contours ?? []).flatMap((c, ci) => c.map((_, pi) => key(ci, pi)))
  /** Apply a matrix [a, b, c, d, e, f] to those points. */
  const applyTransform = (matrix: number[], keys = transformKeys()) => {
    if (!pts || !keys.length) return
    // whole shapes go as contours, so FontForge can keep their winding right
    const whole = pts.contours.map((c, ci) => c.every((_, pi) => keys.includes(key(ci, pi))))
    const contours = whole.flatMap((w, ci) => w ? [ci] : [])
    const points = keys.map(unkey).filter(([ci]) => !whole[ci])
    edit('transform', { matrix, contours, points })
  }
  /** Flip / rotate the selection (or the whole glyph) about its own centre. */
  const transform = (kind: 'flipH' | 'flipV' | 'rotCW' | 'rotCCW') => {
    if (!pts) return
    const keys = transformKeys()
    if (!keys.length) return
    const p = keys.map(k => { const [ci, pi] = unkey(k); return pts.contours[ci][pi] })
    const xs = p.map(q => q[0]), ys = p.map(q => q[1])
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
    applyTransform({
      flipH: [-1, 0, 0, 1, 2 * cx, 0], flipV: [1, 0, 0, -1, 0, 2 * cy],
      rotCCW: [0, 1, -1, 0, cx + cy, cy - cx], rotCW: [0, -1, 1, 0, cx - cy, cx + cy],
    }[kind], keys)
  }

  /** Where the selection (or the whole glyph) is and how big: its on-curve points, which sit on the extremes of a well-made shape. */
  const selBox = (() => {
    if (!pts) return null
    const all = transformKeys().map(k => { const [ci, pi] = unkey(k); return pts.contours[ci]?.[pi] }).filter(Boolean)
    const on = all.filter(p => p[2])
    const p = on.length ? on : all
    if (!p.length) return null
    const xs = p.map(q => q[0]), ys = p.map(q => q[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  })()
  /** Type a new position or size: scale and move the selection from its box to the new one. */
  const setBox = (patch: Partial<{ x: number; y: number; w: number; h: number }>) => {
    if (!selBox) return
    const n = { ...selBox, ...patch }
    const a = selBox.w > 0 && n.w > 0 ? n.w / selBox.w : 1, d = selBox.h > 0 && n.h > 0 ? n.h / selBox.h : 1
    if (a === 1 && d === 1 && n.x === selBox.x && n.y === selBox.y) return
    applyTransform([a, 0, 0, d, n.x - a * selBox.x, n.y - d * selBox.y])
  }

  /** Turn the selection (or the glyph) by an angle, about the middle of its box. */
  const rotateBy = (deg: number) => {
    if (!selBox || !deg) return
    applyTransform(rotateMatrix(selBox.x + selBox.w / 2, selBox.y + selBox.h / 2, deg * Math.PI / 180))
  }

  const pathfinder = (mode: 'union' | 'subtract' | 'intersect') =>
    edit('pathfinder', { mode, contours: [...new Set([...sel].map(k => unkey(k)[0]))] })

  const commitPen = (closed: boolean) => {
    if (pen.length >= 2) edit('add_contour', { points: penPoints(pen, closed), closed, ...(stroke.on ? { label: strokeMark(stroke) } : {}) })
    setPen([])
  }

  // the guides as drawn: the one being dragged is at its new place, or gone while it is over a ruler
  const withDrag = (list: number[], axis: 'x' | 'y') => !drag || drag.kind !== 'guide' || drag.axis !== axis ? list
    : drag.out ? list.filter((_, i) => i !== drag.i)
    : drag.i < list.length ? list.map((g, i) => i === drag.i ? drag.v : g) : [...list, drag.v]
  const shownGuides = withDrag(guides, 'y'), shownVGuides = withDrag(vguides, 'x')
  /** The guide within a few pixels of this screen position, if any. */
  const guideAt = (sx: number, sy: number): { axis: 'x' | 'y'; i: number } | null => {
    const { s, ox, base } = xf.current
    let best: { axis: 'x' | 'y'; i: number } | null = null, bd = 5
    guides.forEach((g, i) => { const d = Math.abs(sy - (base - g * s)); if (d < bd) { bd = d; best = { axis: 'y', i } } })
    vguides.forEach((g, i) => { const d = Math.abs(sx - (ox + g * s)); if (d < bd) { bd = d; best = { axis: 'x', i } } })
    return best
  }
  /** Which ruler a position is over: the top one makes horizontal guides, the left one vertical guides. */
  const rulerAt = (sx: number, sy: number): 'x' | 'y' | null => !vis.rulers ? null : sy < RULER_PX ? 'y' : sx < RULER_PX ? 'x' : null
  // strokes among the shapes, and among the selected ones
  const strokeAt = (ci: number) => parseStroke(pts?.shapes[ci]?.name)
  const hasStrokes = !!pts?.shapes.some(s => parseStroke(s.name))
  const selStrokes = [...new Set([...sel].map(k => unkey(k)[0]))].filter(ci => strokeAt(ci))
  const drawing = active === 'pen'  // the tools that make new paths, with the pen's settings
  const shownStroke: StrokeSpec = (!stroke.on || !drawing) && selStrokes.length ? strokeAt(selStrokes[0])! : stroke
  /** With the pen: change what it draws next. Otherwise: change the selected strokes. */
  const changeStroke = (patch: Partial<StrokeSpec> & { on?: boolean }) => {
    if (drawing) {
      const next = { ...stroke, ...patch }
      setStroke(next)
      localStorage.setItem('forge.stroke', JSON.stringify(next))
      return
    }
    const { on: _on, ...fields } = patch
    for (const ci of selStrokes) edit('rename', { contour: ci, label: strokeMark({ ...strokeAt(ci)!, ...fields }) })
  }

  // an .svg drawing: the colours of the selected shapes (or of the first shape), and a way to change them
  const isSvg = font.path.toLowerCase().endsWith('.svg')
  const svgSel = isSvg && pts ? [...new Set([...sel].map(k => unkey(k)[0]))].filter(ci => pts.shapes[ci]) : []
  const shownStyle: SvgStyle | null = isSvg && pts && pts.shapes.length
    ? (() => { const g = svgGroups(pts.shapes).find(x => svgSel.length ? x.contours.includes(svgSel[0]) : true)!; return { fill: g.fill, stroke: g.stroke, sw: g.sw, op: g.op } })()
    : null
  const setAppearance = (patch: Partial<SvgStyle>) => {
    if (!pts || !svgSel.length) return
    const groups = svgGroups(pts.shapes).filter(g => g.contours.some(ci => svgSel.includes(ci)))
    let next = nextGroup(pts.shapes)
    for (const g of groups) {
      const style = { fill: g.fill, stroke: g.stroke, sw: g.sw, op: g.op, ...patch }
      const id = parseSvgTag(pts.shapes[g.contours[0]].name)?.group ?? next++  // a shape drawn here gets a group of its own
      for (const ci of g.contours) edit('rename', { contour: ci, label: svgTag(id, style) })
    }
  }
  // anchors of the components (a composite like Ȩ has none of its own): shown, and editable in the component they belong to
  const [anchorRev, setAnchorRev] = useState(0)
  const [inherited, setInherited] = useState<{ comp: string; a: FontAnchor; x: number; y: number }[]>([])
  const refKey = JSON.stringify([pts?.refs_list, pts?.ref_xf])
  useEffect(() => {
    if (!pts || !pts.refs_list.length) { setInherited([]); return }
    let stale = false
    const { refs_list: refs, ref_xf: xf0 } = pts
    Promise.all(refs.map(c => api<Points>(`/api/glyph/${encodeURIComponent(c)}`).catch(() => null))).then(list => {
      if (stale) return
      setInherited(list.flatMap((p, i) => {
        const [xx, xy, yx, yy, dx, dy] = xf0[i] ?? [1, 0, 0, 1, 0, 0]
        return (p?.anchors ?? []).map(a => ({ comp: refs[i], a, x: xx * a.x + yx * a.y + dx, y: xy * a.x + yy * a.y + dy }))
      }))
    })
    return () => { stale = true }
  }, [name, refKey, anchorRev])  // eslint-disable-line react-hooks/exhaustive-deps
  const editInherited = (i: number, nx: number, ny: number) => {
    const h = inherited[i]
    const k = pts?.refs_list.indexOf(h?.comp ?? '')
    if (!h || !pts || !name || k === undefined || k < 0) return
    const [xx, xy, yx, yy, dx, dy] = pts.ref_xf[k]
    const det = xx * yy - yx * xy || 1
    const px = Math.round((yy * (nx - dx) - yx * (ny - dy)) / det), py = Math.round((-xy * (nx - dx) + xx * (ny - dy)) / det)  // back into the component's own coordinates
    run(async () => {
      const cp = await api<Points>('/api/anchor', { name: h.comp, cls: h.a.cls, type: h.a.type, x: px, y: py })
      outlines.putPoints(cp); outlines.invalidateUsers(h.comp)
      setAnchorRev(r => r + 1)
      return api<Points>(`/api/glyph/${encodeURIComponent(name)}`)
    })
  }
  const roundCorners = (radius: number, kind: CornerKind = cornerKind) => {
    if (!(radius > 0)) return
    localStorage.setItem('forge.radius', String(radius))
    applyCorners(radius, kind, sel.size ? [...sel].map(unkey) : undefined)
  }
  // the Properties panel reads this editor's state, and changes it through these (always the latest ones)
  const propsOwner = useRef({}).current
  const latest = useRef<PropsActions | null>(null)
  useEffect(() => {
    latest.current = { setAppearance, setBox, rotate: rotateBy, setStroke: changeStroke, roundCorners, changeWeight: d => editable && d && edit('weight', { delta: d }), expand: () => edit('expand_strokes', selStrokes.length ? { contours: selStrokes } : {}) }
  })
  const stable = useRef<PropsActions>({
    setAppearance: p => latest.current?.setAppearance(p), setBox: p => latest.current?.setBox(p), rotate: d => latest.current?.rotate(d), setStroke: p => latest.current?.setStroke(p), roundCorners: (r, k) => latest.current?.roundCorners(r, k), changeWeight: d => latest.current?.changeWeight(d), expand: () => latest.current?.expand(),
  }).current
  const published: PropsState | null = name && pts ? {
    glyph: name, tool: active, editable: atDefault && editable, box: selBox, scope: sel.size ? 'selection' : 'glyph',
    points: sel.size || pts.contours.reduce((n, c) => n + c.length, 0), shapes: sel.size ? new Set([...sel].map(k => unkey(k)[0])).size : pts.contours.length,
    svg: shownStyle && svgSel.length ? shownStyle : isSvg ? 'none' : null,
    pen: stroke, shownStroke, selStrokes: selStrokes.length, strokes: pts.shapes.filter(s => parseStroke(s.name)).length,
    vis: { guides: vis.guides, shadow: vis.shadow, smart: vis.smart, grid: vis.grid, rulers: vis.rulers },
  } : null
  const publishedKey = JSON.stringify(published)
  useEffect(() => {
    if (published) propsStore.publish(propsOwner, published, stable)
    else propsStore.clear(propsOwner)
  }, [publishedKey])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => propsStore.clear(propsOwner), [propsOwner])

  const build = () => {
    if (!name) return
    run(() => api<Points>('/api/build', { name }))
  }

  const ref = useCanvas((ctx, w, h) => {
    const t = theme()
    if (!name || !o) return
    // fit the metrics, and in Accents also the accent where it lands (it can sit above the ascender)
    const accentTop = underlay && pts ? Math.max(-Infinity, ...pts.contours.flat().map(p => p[1])) + underlay.dy : -Infinity
    const top = Math.max(font.ascent, font.capheight || 0, accentTop + font.em * 0.05), bottom = -font.descent
    const pad = 48
    // Two frames. The page frame is the letter's: baseline, guides, shadow
    // and (in Accents) the base letter sit here. The glyph frame is where the
    // edited outline is drawn and edited; in Accents it is shifted by the
    // accent's offset, so the accent shows where it lands in the composite
    // instead of the base letter sinking below the baseline.
    const W = underlay && under ? under.width : o.width
    const s0 = Math.min((h - pad * 2) / (top - bottom), (w - pad * 2) / Math.max(W, font.em * 0.5))
    const s = s0 * view.z
    const ox0 = view.tx + view.z * (w - W * s0) / 2
    const base0 = view.ty + view.z * (pad + top * s0)
    const ox = ox0 + (underlay?.dx ?? 0) * s, base = base0 - (underlay?.dy ?? 0) * s
    xf.current = { s, ox, base }
    const X = (x: number) => ox + x * s, Y = (y: number) => base - y * s
    const X0 = (x: number) => ox0 + x * s, Y0 = (y: number) => base0 - y * s
    const inFont = (f: (c: CanvasRenderingContext2D) => void) => {
      ctx.save(); ctx.setTransform(ctx.getTransform().translate(ox, base).scale(s, -s)); f(ctx); ctx.restore()
    }
    const inPage = (f: (c: CanvasRenderingContext2D) => void) => {
      ctx.save(); ctx.setTransform(ctx.getTransform().translate(ox0, base0).scale(s, -s)); f(ctx); ctx.restore()
    }

    // adaptive grid in font coordinates (minor + 5x major dots or lines)
    if (vis.grid) {
      const step = GRID_STEPS.find(st => st * s >= 22) ?? 500
      const major = step * 5
      const x0 = Math.ceil(-ox0 / s / step) * step, x1 = Math.floor((w - ox0) / s / step) * step
      const y0 = Math.ceil((base0 - h) / s / step) * step, y1 = Math.floor(base0 / s / step) * step
      if (gridStyle === 'lines') {
        ctx.strokeStyle = t.dim
        ctx.lineWidth = 1
        ctx.globalAlpha = 0.14
        ctx.beginPath()
        for (let gx = x0; gx <= x1; gx += step) {
          if (gx % major === 0) continue
          const px = Math.round(X0(gx)) + .5
          ctx.moveTo(px, 0); ctx.lineTo(px, h)
        }
        for (let gy = y0; gy <= y1; gy += step) {
          if (gy % major === 0) continue
          const py = Math.round(Y0(gy)) + .5
          ctx.moveTo(0, py); ctx.lineTo(w, py)
        }
        ctx.stroke()
        ctx.globalAlpha = 0.3
        ctx.beginPath()
        for (let gx = Math.ceil(-ox0 / s / major) * major; gx <= x1; gx += major) {
          const px = Math.round(X0(gx)) + .5
          ctx.moveTo(px, 0); ctx.lineTo(px, h)
        }
        for (let gy = Math.ceil((base0 - h) / s / major) * major; gy <= y1; gy += major) {
          const py = Math.round(Y0(gy)) + .5
          ctx.moveTo(0, py); ctx.lineTo(w, py)
        }
        ctx.stroke()
      } else {
        ctx.fillStyle = t.dim
        ctx.globalAlpha = 0.22
        for (let gx = x0; gx <= x1; gx += step) {
          const px = Math.round(X0(gx))
          for (let gy = y0; gy <= y1; gy += step) {
            if (gx % major === 0 && gy % major === 0) continue
            ctx.fillRect(px, Math.round(Y0(gy)), 1.25, 1.25)
          }
        }
        ctx.globalAlpha = 0.48
        for (let gx = Math.ceil(-ox0 / s / major) * major; gx <= x1; gx += major) {
          const px = Math.round(X0(gx)) - 0.5
          for (let gy = Math.ceil((base0 - h) / s / major) * major; gy <= y1; gy += major) {
            ctx.fillRect(px, Math.round(Y0(gy)) - 0.5, 2, 2)
          }
        }
      }
      ctx.globalAlpha = 1
    }

    // metrics
    ctx.lineWidth = 1
    ctx.strokeStyle = t.line
    ctx.fillStyle = t.dim
    ctx.font = '10px ' + t.mono
    const labelX = vis.rulers ? 68 : 52
    for (const [y, label] of [[0, 'baseline'], [font.xheight, 'x-height'], [font.capheight, 'cap'],
      [font.ascent, 'ascender'], [-font.descent, 'descender']] as [number, string][]) {
      if (!y && label !== 'baseline') continue
      ctx.beginPath(); ctx.moveTo(0, Math.round(Y0(y)) + .5); ctx.lineTo(w, Math.round(Y0(y)) + .5); ctx.stroke()
      ctx.fillText(`${label} ${y}`, labelX, Y0(y) - 4)  // right of the toolbar
    }
    const bd = drag?.kind === 'bearing' ? drag : null
    for (const [side, x] of [['L', 0], ['R', o.width]] as const) {
      const live = bd?.side === side, hot = live || edgeHover === side
      const xx = Math.round(X(x + (live ? bd.dx : 0))) + .5
      ctx.strokeStyle = hot ? t.start : t.line
      ctx.lineWidth = hot ? 1.5 : 1
      ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, h); ctx.stroke()
      if (live) {
        const v = side === 'L' ? o.lsb - bd.dx : o.rsb + bd.dx
        ctx.fillStyle = t.start
        ctx.textAlign = side === 'L' ? 'right' : 'left'
        ctx.fillText(`${side === 'L' ? 'L' : 'R'} ${Math.round(v)} · w ${Math.round(o.width + (side === 'R' ? bd.dx : -bd.dx))}`, xx + (side === 'L' ? -6 : 6), 14)
        ctx.textAlign = 'left'
      }
    }
    ctx.lineWidth = 1

    // shadow letter: its outline and its advance, from the same origin
    // no shadow letter to compare with: show this glyph's own character in the
    // system font, as in the grid, for when you don't know how to write it
    if (vis.shadow && !shadow && !shadowName && glyphInfo && glyphInfo.unicode >= 0) {
      ctx.save()
      ctx.globalAlpha = 0.35; ctx.fillStyle = t.shadow; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      // sized so the system font's cap height (capitals) or x-height (the rest) equals this font's
      const ch = String.fromCodePoint(glyphInfo.unicode)
      const cap = ch !== ch.toLowerCase(), target = cap ? font.capheight : font.xheight
      ctx.font = '100px system-ui'
      const ref = ctx.measureText(cap ? 'H' : 'x').actualBoundingBoxAscent
      ctx.font = `${target && ref ? 100 * target * s / ref : font.em * s * 0.75}px system-ui`
      ctx.fillText(ch, X0(0), Y0(0))
      ctx.restore()
    }
    if (vis.shadow && shadow) {
      inPage(c => { c.globalAlpha = 0.35; c.fillStyle = t.shadow; c.fill(shadow.path); c.globalAlpha = 1 })
      ctx.setLineDash([2, 3])
      ctx.strokeStyle = t.shadow
      const sx = Math.round(X0(shadow.width)) + .5
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke()
      ctx.setLineDash([])
    }

    if (vis.guides) {
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = t.guide
      ctx.fillStyle = t.guide
      for (const g of shownGuides) {
        ctx.beginPath(); ctx.moveTo(0, Math.round(Y0(g)) + .5); ctx.lineTo(w, Math.round(Y0(g)) + .5); ctx.stroke()
        ctx.textAlign = 'right'
        ctx.fillText(String(g), w - 8, Y0(g) - 4)
      }
      for (const g of shownVGuides) {
        ctx.beginPath(); ctx.moveTo(Math.round(X0(g)) + .5, 0); ctx.lineTo(Math.round(X0(g)) + .5, h); ctx.stroke()
        ctx.textAlign = 'left'
        ctx.fillText(String(g), X0(g) + 4, (vis.rulers ? RULER_PX : 0) + 14)
      }
      ctx.setLineDash([])
      ctx.textAlign = 'left'
    }

    if (vis.background && pts?.background && atDefault) inFont(c => { c.fillStyle = t.faint; c.fill(new Path2D(pts.background)) })
    if (vis.underlay && underlay && under) inPage(c => { c.fillStyle = t.faint; c.fill(under.path) })

    const anyHidden = hidden.size > 0 && !!shown
    const isTransforming = drag?.kind === 'corner' || !!cornerDlg || drag?.kind === 'move' || drag?.kind === 'box_scale' || drag?.kind === 'box_rotate'
    const live = editable && shown && (isTransforming || anyHidden)
      ? (() => {
        const keep = shown.map((_, ci) => !hidden.has(ci) && !parseStroke(pts!.shapes[ci]?.name))  // strokes are drawn at their width below
        const p = contourPath(shown.filter((_, ci) => keep[ci]), pts!.shapes.filter((_, ci) => keep[ci]).map(x => x.closed), font.quadratic)
        if (pts!.refs) p.addPath(toPath({ d: '', refs: pts!.refs }))
        return p
      })()
      : o.path
    if (isSvg && shown && pts) {  // a drawing: every shape in its own colours, back to front
      inFont(c => {
        for (const gr of svgGroups(pts.shapes)) {
          const cs = gr.contours.filter(ci => !hidden.has(ci))
          if (!cs.length) continue
          const p = contourPath(cs.map(ci => shown[ci] ?? pts.contours[ci]), cs.map(ci => pts.shapes[ci]?.closed ?? true), font.quadratic)
          c.globalAlpha = gr.op
          if (gr.fill) { c.fillStyle = gr.fill; c.fill(p) }
          if (gr.stroke) { c.strokeStyle = gr.stroke; c.lineWidth = gr.sw; c.lineJoin = 'round'; c.stroke(p) }
        }
        c.globalAlpha = 1; c.lineJoin = 'miter'
      })
    } else inFont(c => { c.fillStyle = atDefault ? t.fill : t.ink; c.fill(live) })
    if (live !== o.path && shown && pts) {  // while moving, the strokes are the skeletons drawn at their width (FontForge makes the exact outline when the edit lands)
      inFont(c => {
        c.strokeStyle = atDefault ? t.fill : t.ink
        shown.forEach((contour, ci) => {
          const spec = parseStroke(pts.shapes[ci]?.name)
          if (!spec || hidden.has(ci)) return
          c.lineWidth = spec.width; c.lineCap = spec.cap; c.lineJoin = spec.join
          c.stroke(contourPath([contour], [pts.shapes[ci].closed], font.quadratic))
        })
        c.lineCap = 'butt'; c.lineJoin = 'miter'
      })
    }
    const bl = blend && blend.name === name ? blend : null
    if (vis.masters && bl?.glyph) {
      const bp = contourPath(bl.glyph.contours, bl.glyph.closed, font.quadratic)
      inFont(c => {
        c.globalAlpha = 0.18; c.fillStyle = t.reference; c.fill(bp); c.globalAlpha = 1
        c.lineWidth = 1.5 / s; c.strokeStyle = t.reference; c.stroke(bp)
      })
    }
    if (bl) {
      ctx.fillStyle = bl.glyph ? t.reference : t.bad
      ctx.font = '11px ' + t.mono
      ctx.textAlign = 'left'
      ctx.fillText(bl.glyph ? `weight ${bl.weight} · advance ${Math.round(bl.glyph.width)}` : `weight ${bl.weight}: masters don't match, can't blend`,
        vis.rulers ? 68 : 52, h - 12)
    }
    if (vis.masters && ghostOutlines.length) {
      inFont(c => {
        c.lineWidth = 1 / s; c.strokeStyle = t.off; c.setLineDash([6 / s, 4 / s])
        for (const g of ghostOutlines) c.stroke(g.path)
        c.setLineDash([])
      })
    }
    if (vis.reference && reference && refOutline) {
      const k = font.em / reference.info.em  // compare at the same size per em
      inFont(c => { c.scale(k, k); c.lineWidth = 1.5 / (s * k); c.strokeStyle = t.reference; c.stroke(refOutline.path) })
    }
    if (atDefault) {
      inFont(c => { c.lineWidth = 1.5 / s; c.strokeStyle = t.ink; c.stroke(live) })
    }
    if (editable && shown) {

      // handles: line from each off-curve point to its on-curve neighbours
      ctx.strokeStyle = t.off
      ctx.lineWidth = 1
      for (const [ci, c] of shown.entries()) {
        if (hidden.has(ci)) continue
        const n = c.length
        c.forEach((p, i) => {
          if (p[2]) return
          for (const q of [c[(i + n - 1) % n], c[(i + 1) % n]]) {
            if (!q[2]) continue
            ctx.beginPath(); ctx.moveTo(X(p[0]), Y(p[1])); ctx.lineTo(X(q[0]), Y(q[1])); ctx.stroke()
          }
        })
      }
      shown.forEach((c, ci) => !hidden.has(ci) && c.forEach((p, i) => {
        const x = X(p[0]), y = Y(p[1]), on = sel.has(key(ci, i))
        const r = on ? 4 : 3
        ctx.beginPath()
        if (!p[2]) ctx.arc(x, y, r - .5, 0, Math.PI * 2)
        else if (SMOOTH.has(p[3] ?? 0)) ctx.arc(x, y, r + .5, 0, Math.PI * 2)  // smooth: round
        else ctx.rect(x - r, y - r, r * 2, r * 2)                                // corner: square
        const extra = extraKeys?.has(key(ci, i))
        ctx.fillStyle = extra ? '#e5484d' : on ? t.start : i === 0 ? t.start : p[2] ? t.ink : t.off
        ctx.fill()
        if (extra) { ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke() }
        if (on) { ctx.strokeStyle = t.ink; ctx.lineWidth = 1; ctx.stroke() }
      }))

      if (selBounds && picking) {
        drawTransformBox(ctx, selBounds, X, Y, t.start, t.card)
      }
    }

    if (vis.smart && smartGuides.length) {
      drawSmartGuides(ctx, smartGuides, X, Y, t.start, t.mono)
    }

    // pen preview
    if (pen.length) {
      const preview = [...pen, ...(hover && drag?.kind !== 'pen' ? [hover] : [])]
      const pp = penPoints(preview, false)
      inFont(c => {
        const path = contourPath([pp.map(q => [...q] as Pt3)], [false], false)
        if (stroke.on) {  // what the stroke will look like: the path at its real width
          c.lineWidth = stroke.width; c.lineCap = stroke.cap; c.lineJoin = stroke.join
          c.globalAlpha = 0.35; c.strokeStyle = t.fill; c.stroke(path); c.globalAlpha = 1
        }
        c.lineCap = 'butt'; c.lineJoin = 'miter'
        c.lineWidth = 1.5 / s; c.strokeStyle = t.start
        c.stroke(path)
      })
      ctx.strokeStyle = t.off
      ctx.fillStyle = t.start
      for (const a of pen) {
        for (const hnd of [a.in, a.out]) if (hnd) {
          ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(hnd.x), Y(hnd.y)); ctx.stroke()
          ctx.beginPath(); ctx.arc(X(hnd.x), Y(hnd.y), 2.5, 0, Math.PI * 2); ctx.fill()
        }
        ctx.fillRect(X(a.x) - 3, Y(a.y) - 3, 6, 6)
      }
      if (pen.length > 1 && hover && Math.hypot(hover.x - pen[0].x, hover.y - pen[0].y) * s < CLOSE_PX) {
        ctx.strokeStyle = t.start; ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(X(pen[0].x), Y(pen[0].y), 7, 0, Math.PI * 2); ctx.stroke()  // "click to close"
      }
    }

    // Rectangle / Oval: the box being dragged
    const drawing = drag?.kind === 'shape' ? { ...drag, oval: active === 'oval' } : justDrawn
    if (drawing) {
      const r = shapeBox(drawing)
      ctx.strokeStyle = t.start; ctx.lineWidth = 1.5; ctx.fillStyle = t.start
      ctx.beginPath()
      if (drawing.oval) ctx.ellipse(X(r.x + r.w / 2), Y(r.y + r.h / 2), r.w / 2 * xf.current.s, r.h / 2 * xf.current.s, 0, 0, Math.PI * 2)
      else ctx.rect(X(r.x), Y(r.y + r.h), r.w * xf.current.s, r.h * xf.current.s)
      ctx.globalAlpha = 0.15; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke()
      ctx.font = '11px ' + t.mono; ctx.fillStyle = t.ink; ctx.textAlign = 'left'
      ctx.fillText(`${Math.round(r.w)} × ${Math.round(r.h)}`, X(r.x + r.w) + 8, Y(r.y) + 14)
    }

    // Shape Builder: the regions under the cursor or the dragged path, and the path itself
    if (active === 'shaper' && regions) {
      const over = drag?.kind === 'shaper' ? drag.pts : hover ? [hover] : []
      const alt = drag?.kind === 'shaper' && drag.alt
      const picked = crossed(over)
      inFont(c => {
        c.globalAlpha = 0.35; c.fillStyle = alt ? '#e5484d' : t.start
        for (const j of picked) c.fill(regions.paths[j])
        c.globalAlpha = 1
      })
      if (drag?.kind === 'shaper') {
        ctx.strokeStyle = alt ? '#e5484d' : t.start; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'
        ctx.beginPath()
        drag.pts.forEach((q, i) => i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y)))
        ctx.stroke()
      }
    }

    // pen: coordinates of the (snapped) point the next click will place
    if (active === 'pen' && hover && !drag) {
      const label = `${addingPoint ? 'Add point  ' : ''}${Math.round(hover.x)}, ${Math.round(hover.y)}`
      ctx.font = '11px ' + t.mono
      const lx = X(hover.x) + 12, ly = Y(hover.y) + 20
      ctx.fillStyle = t.sel
      ctx.fillRect(lx - 4, ly - 12, ctx.measureText(label).width + 8, 17)
      ctx.fillStyle = t.ink
      ctx.textAlign = 'left'
      ctx.fillText(label, lx, ly)
    }

    // corner widgets, and the radius while one is dragged
    if (cornerWidgets.length) {
      for (const w of cornerWidgets) {
        const [wx, wy] = widgetXY(w)
        ctx.beginPath(); ctx.arc(X(wx), Y(wy), 5.5, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = t.sel; ctx.stroke()
      }
      if (drag?.kind === 'corner') {
        const w = cornerWidgets.find(q => q.ci === drag.ci && q.pi === drag.pi)
        if (w) {
          const [wx, wy] = widgetXY(w)
          ctx.font = '11px ' + t.mono; ctx.textAlign = 'left'
          const label = `r ${drag.r}`
          ctx.fillStyle = t.sel; ctx.fillRect(X(wx) + 10, Y(wy) - 8, ctx.measureText(label).width + 8, 17)
          ctx.fillStyle = t.ink; ctx.fillText(label, X(wx) + 14, Y(wy) + 4)
        }
      }
    }

    // anchors: diamonds, base in orange, mark in green, with their class name
    if (editable && pts) {
      ctx.font = '10px ' + t.mono
      for (const h of inherited) {  // the components' own anchors, hollow
        const ax = X(h.x), ay = Y(h.y)
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.PI / 4)
        ctx.strokeStyle = h.a.type === 'mark' ? t.shadow : t.reference; ctx.lineWidth = 1.5
        ctx.strokeRect(-4, -4, 8, 8)
        ctx.restore()
        ctx.fillStyle = h.a.type === 'mark' ? t.shadow : t.reference; ctx.textAlign = 'left'
        ctx.fillText(`${h.comp}:${h.a.type === 'mark' ? '_' : ''}${h.a.cls}`, ax + 8, ay - 6)
      }
      for (const a of pts.anchors) {
        const live = drag?.kind === 'anchor' && drag.a.cls === a.cls && drag.a.type === a.type
        const ax = X(a.x + (live ? drag.dx : 0)), ay = Y(a.y + (live ? drag.dy : 0))
        const on = selAnchor?.cls === a.cls && selAnchor.type === a.type
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.PI / 4)
        ctx.fillStyle = a.type === 'mark' ? t.shadow : t.reference
        ctx.fillRect(-4, -4, 8, 8)
        if (on) { ctx.strokeStyle = t.ink; ctx.lineWidth = 1.5; ctx.strokeRect(-5.5, -5.5, 11, 11) }
        ctx.restore()
        ctx.fillStyle = a.type === 'mark' ? t.shadow : t.reference
        ctx.textAlign = 'left'
        ctx.fillText(`${a.type === 'mark' ? '_' : ''}${a.cls}`, ax + 8, ay - 6)
      }
    }

    if (drag?.kind === 'marquee') {
      const x0 = X(drag.a.x), y0 = Y(drag.a.y), x1 = X(drag.b.x), y1 = Y(drag.b.y)
      ctx.fillStyle = 'color-mix(in oklch, ' + t.start + ' 12%, transparent)'
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
      ctx.strokeStyle = t.start
      ctx.strokeRect(x0 + .5, y0 + .5, x1 - x0, y1 - y0)
    }

    if (measure) {
      const { a, b } = measure
      const dx = b.x - a.x, dy = b.y - a.y
      ctx.strokeStyle = t.start
      ctx.fillStyle = t.start
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke()
      for (const p of [a, b]) { ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3, 0, Math.PI * 2); ctx.fill() }
      const label = `${fmt(Math.hypot(dx, dy))}  Δx ${fmt(dx)}  Δy ${fmt(dy)}  ${fmt(Math.atan2(dy, dx) * 180 / Math.PI)}°`
      const lx = (X(a.x) + X(b.x)) / 2 + 8, ly = (Y(a.y) + Y(b.y)) / 2 - 8
      const tw = ctx.measureText(label).width
      ctx.fillStyle = t.sel
      ctx.fillRect(lx - 4, ly - 12, tw + 8, 17)
      ctx.fillStyle = t.ink
      ctx.textAlign = 'left'
      ctx.fillText(label, lx, ly)
    }

    if (vis.rulers) {
      const rStep = GRID_STEPS.find(st => st * s >= 56) ?? 500
      const subStep = rStep / 5
      const drawSub = subStep >= 1 && subStep * s >= 6
      ctx.fillStyle = t.card
      ctx.fillRect(0, 0, w, RULER_PX)
      ctx.fillRect(0, RULER_PX, RULER_PX, h - RULER_PX)
      ctx.strokeStyle = t.line
      ctx.lineWidth = 1
      ctx.font = '9px ' + t.mono
      ctx.fillStyle = t.dim

      // horizontal ruler (top)
      ctx.save()
      ctx.beginPath(); ctx.rect(RULER_PX, 0, w - RULER_PX, RULER_PX); ctx.clip()
      if (drawSub) {
        const sx0 = Math.ceil((RULER_PX - ox0) / s / subStep) * subStep
        const sx1 = Math.floor((w - ox0) / s / subStep) * subStep
        ctx.beginPath()
        for (let gx = sx0; gx <= sx1; gx += subStep) {
          if (Math.abs(gx % rStep) < 1e-6) continue
          const px = Math.round(X0(gx)) + .5
          ctx.moveTo(px, RULER_PX - 4); ctx.lineTo(px, RULER_PX)
        }
        ctx.stroke()
      }
      const rx0 = Math.ceil((RULER_PX - ox0) / s / rStep) * rStep
      const rx1 = Math.floor((w - ox0) / s / rStep) * rStep
      ctx.textAlign = 'left'
      ctx.beginPath()
      for (let gx = rx0; gx <= rx1; gx += rStep) {
        const px = Math.round(X0(gx)) + .5
        ctx.moveTo(px, RULER_PX - 11); ctx.lineTo(px, RULER_PX)
        ctx.fillText(String(Math.round(gx)), px + 3, 11)
      }
      ctx.stroke()
      if (hover) {
        const hx = Math.round(X(hover.x)) + .5
        ctx.strokeStyle = t.start
        ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, RULER_PX); ctx.stroke()
      }
      ctx.restore()

      // vertical ruler (left)
      ctx.save()
      ctx.beginPath(); ctx.rect(0, RULER_PX, RULER_PX, h - RULER_PX); ctx.clip()
      ctx.strokeStyle = t.line
      if (drawSub) {
        const sy0 = Math.ceil((base0 - h) / s / subStep) * subStep
        const sy1 = Math.floor((base0 - RULER_PX) / s / subStep) * subStep
        ctx.beginPath()
        for (let gy = sy0; gy <= sy1; gy += subStep) {
          if (Math.abs(gy % rStep) < 1e-6) continue
          const py = Math.round(Y0(gy)) + .5
          ctx.moveTo(RULER_PX - 4, py); ctx.lineTo(RULER_PX, py)
        }
        ctx.stroke()
      }
      const ry0 = Math.ceil((base0 - h) / s / rStep) * rStep
      const ry1 = Math.floor((base0 - RULER_PX) / s / rStep) * rStep
      ctx.textAlign = 'right'
      ctx.beginPath()
      for (let gy = ry0; gy <= ry1; gy += rStep) {
        const py = Math.round(Y0(gy)) + .5
        ctx.moveTo(RULER_PX - 11, py); ctx.lineTo(RULER_PX, py)
        ctx.save()
        ctx.translate(11, py - 3)
        ctx.rotate(-Math.PI / 2)
        ctx.fillText(String(Math.round(gy)), 0, 0)
        ctx.restore()
      }
      ctx.stroke()
      if (hover) {
        const hy = Math.round(Y(hover.y)) + .5
        ctx.strokeStyle = t.start
        ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(RULER_PX, hy); ctx.stroke()
      }
      ctx.restore()

      // ruler borders & corner box
      ctx.strokeStyle = t.line
      ctx.beginPath()
      ctx.moveTo(0, RULER_PX + .5); ctx.lineTo(w, RULER_PX + .5)
      ctx.moveTo(RULER_PX + .5, 0); ctx.lineTo(RULER_PX + .5, h)
      ctx.stroke()
    }
  })

  const screen = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { sx: e.clientX - r.left, sy: e.clientY - r.top }
  }
  const toFont = (e: React.MouseEvent): Pt => {
    const { sx, sy } = screen(e), { s, ox, base } = xf.current
    return { x: Math.round((sx - ox) / s), y: Math.round((base - sy) / s) }
  }
  /** Nearest point within HIT_PX, as [contour, point]. */
  const hit = (p: Pt): [number, number] | null => {
    if (!pts) return null
    let best: [number, number] | null = null, bd = HIT_PX / xf.current.s
    pts.contours.forEach((c, ci) => !hidden.has(ci) && !locked.has(ci) && c.forEach((q, pi) => {
      const d = Math.hypot(q[0] - p.x, q[1] - p.y)
      if (d < bd) { bd = d; best = [ci, pi] }
    }))
    return best
  }
  // Live corners: a round widget on each selected corner between two straight edges; drag it inward to round, as in Illustrator
  const WIDGET_PX = 12
  type CornerWidget = { ci: number; pi: number; cr: NonNullable<ReturnType<typeof cornerAt>>; c: Pt3[]; rounded?: number }
  const cornerWidgets = picking && editable && atDefault && pts && !cornerDlg && (!drag || drag.kind === 'corner')
    ? (liveOn ? liveOn.pairs : [...sel].map(unkey)).flatMap(([ci, pi]): CornerWidget[] => {
      const src = liveOn?.base ?? pts
      const c = src.contours[ci]
      if (!c || hidden.has(ci) || locked.has(ci)) return []
      const closed = src.shapes[ci]?.closed ?? true
      const cr = cornerAt(c, closed, pi)
      if (cr) return [{ ci, pi, cr, c }]
      if (liveOn) return []
      // a round corner made earlier: its widget sits where the arc's edges would meet, and dragging it out sharpens or re-rounds it
      const n = c.length
      for (const t1 of [pi, (pi - 3 + n) % n]) {
        const f = findRounded(c, closed, t1)
        if (!f) continue
        const tmp: Pt3[] = [c[(t1 - 2 + n) % n], c[(t1 - 1 + n) % n], [f.x, f.y, 1], c[(t1 + 4) % n], c[(t1 + 5) % n]]  // the corner with one more point each side, so the room beside it is known
        const tcr = cornerAt(tmp, false, 2)
        return tcr ? [{ ci, pi: t1, cr: tcr, c: tmp, rounded: f.r }] : []
      }
      return []
    }).filter((w, i, all) => all.findIndex(q => q.ci === w.ci && q.pi === w.pi) === i) : []
  const widgetXY = (w: CornerWidget) =>
    widgetPos(w.c, w.cr, w.rounded ? 2 : w.pi, drag?.kind === 'corner' && (!drag.single || (drag.ci === w.ci && drag.pi === w.pi)) ? drag.r : w.rounded ?? liveOn?.r ?? 0, WIDGET_PX / xf.current.s)
  const widgetAt = (p: Pt) => cornerWidgets.find(w => { const [x, y] = widgetXY(w); return Math.hypot(x - p.x, y - p.y) * xf.current.s < 8 })
  const applyCorners = (radius: number, kind: CornerKind, points?: [number, number][]) => {
    localStorage.setItem('forge.cornerKind', kind); setCornerKind(kind)
    if (liveOn && name) {  // re-rounding the last rounding: back to the outline from before it, then round that
      setLive(radius > 0 ? { ...liveOn, r: radius, expect: 1 } : null); setSel(new Set())
      run(async () => {
        await api('/api/undo', { name })
        return radius > 0 ? api<Points>('/api/edit', { name, kind: 'round_corners', args: { radius, corner: kind, points: liveOn.pairs } }) : api<Points>(`/api/glyph/${encodeURIComponent(name)}`)
      })
      return
    }
    edit('round_corners', { radius, corner: kind, points })
  }
  const snap = (p: Pt): Pt => {
    const h = hit(p)
    return h && atDefault ? { x: pts!.contours[h[0]][h[1]][0], y: pts!.contours[h[0]][h[1]][1] } : p
  }

  const hitAnchor = (p: Pt): FontAnchor | null => {
    if (!pts || !editable) return null
    let best: FontAnchor | null = null, bd = (HIT_PX + 2) / xf.current.s
    for (const a of pts.anchors) {
      const d = Math.hypot(a.x - p.x, a.y - p.y)
      if (d < bd) { bd = d; best = a }
    }
    return best
  }

  /** New anchor at a sensible spot. Above-type classes (top, above…): base on
   *  top of the letter, mark at the accent's foot. Below-type (bottom, below,
   *  cedilla, ogonek…): base under the letter, mark at the accent's top. */
  const addAnchor = async (cls: string, type: 'base' | 'mark') => {
    if (!name || !o) return
    if (!classes.some(c => c.name === cls)) setClasses(await api<AnchorClass[]>('/api/anchor-classes', { name: cls }))
    const ys = pts?.contours.flat().map(q => q[1]) ?? []
    const top = ys.length ? Math.max(...ys) : font.xheight, bottom = ys.length ? Math.min(...ys) : 0
    const below = /bottom|below|cedilla|ogonek|under/i.test(cls)
    const atTop = (type === 'base') !== below
    const x = Math.round(o.width / 2), y = Math.round(atTop ? top + (type === 'base' ? font.em * 0.02 : 0) : bottom - (type === 'base' ? font.em * 0.02 : 0))
    setSelAnchor({ cls, type, x, y })
    run(() => api<Points>('/api/anchor', { name, cls, type, x, y }))
  }
  const deleteAnchor = (a: FontAnchor) => {
    if (!name) return
    setSelAnchor(null)
    run(() => api<Points>('/api/anchor/delete', { name, cls: a.cls, type: a.type }))
  }

  const nearEdge = (sx: number): 'L' | 'R' | null => {
    if (!o) return null
    const { s, ox } = xf.current
    if (Math.abs(sx - ox) < EDGE_PX) return 'L'
    if (Math.abs(sx - (ox + o.width * s)) < EDGE_PX) return 'R'
    return null
  }

  const zoomAt = (px: number, py: number, k: number) => setView(v => {
    const z = Math.min(64, Math.max(0.1, v.z * k))
    const f = z / v.z
    return { z, tx: px - (px - v.tx) * f, ty: py - (py - v.ty) * f }
  })

  /** Is p on the outline (within a few pixels), and not on one of its points? Then the pen adds a point there. */
  const onOutline = (p: Pt) => {
    if (!pts || pen.length || hit(p)) return false
    const ctx = (hitCtx ??= document.createElement('canvas').getContext('2d')!)
    ctx.lineWidth = 2 * HIT_PX / xf.current.s
    return ctx.isPointInStroke(contourPath(pts.contours, pts.shapes.map(s => s.closed), font.quadratic), p.x, p.y)
  }

  const onDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.currentTarget.parentElement?.focus()
    const { sx, sy } = screen(e)
    if (e.button === 1 || active === 'hand') { setDrag({ kind: 'pan', sx, sy, view }); return }
    if (e.button !== 0) return
    if (active === 'zoom') { zoomAt(sx, sy, e.altKey ? 0.5 : 2); return }
    const p = toFont(e)
    if (active === 'measure') { const a = snap(p); setDrag({ kind: 'measure', a }); setMeasure({ a, b: a }); return }
    if (picking) {
      const r = rulerAt(sx, sy)
      if (r) { setDrag({ kind: 'guide', axis: r, i: (r === 'y' ? guides : vguides).length, v: Math.round(r === 'y' ? p.y : p.x), out: false }); return }  // drag out of a ruler: a new guide
      const g = vis.guides ? guideAt(sx, sy) : null
      if (g && !(pts && hit(p))) { setDrag({ kind: 'guide', axis: g.axis, i: g.i, v: (g.axis === 'y' ? guides : vguides)[g.i], out: false }); return }
    }
    if (!editable || !pts) return
    if (active === 'pen') {
      if (!e.ctrlKey && onOutline(p)) { edit('insert_point', { x: p.x, y: p.y, tol: 2 * HIT_PX / xf.current.s }); return }
      if (pen.length > 1 && Math.hypot(p.x - pen[0].x, p.y - pen[0].y) * xf.current.s < CLOSE_PX) { commitPen(true); return }
      const snapped = !e.ctrlKey ? smartSnap(p, { origin: pen[pen.length - 1] ?? null, exclude: new Set() }) : { pt: p, guides: [] }
      setSmartGuides(snapped.guides)
      setPen(a => [...a, snapped.pt])
      setDrag({ kind: 'pen' })
      return
    }
    if (active === 'shaper') { setDrag({ kind: 'shaper', pts: [p], alt: e.altKey }); return }
    if (active === 'rect' || active === 'oval') { const q = e.ctrlKey ? p : smartSnap(p, { exclude: new Set() }).pt; setDrag({ kind: 'shape', a: q, b: q, square: e.shiftKey, center: e.altKey }); return }
    const cw = picking ? widgetAt(p) : undefined
    if (cw) {
      if (e.altKey) {  // Alt-click cycles the corner type, as in Illustrator
        const order: CornerKind[] = ['round', 'inverted', 'chamfer']
        const next = order[(order.indexOf(cornerKind) + 1) % order.length]
        localStorage.setItem('forge.cornerKind', next); setCornerKind(next)
        toast(`Corner type: ${next === 'inverted' ? 'inverted round' : next}`)
      } else setDrag({ kind: 'corner', ci: cw.ci, pi: cw.pi, r: cw.rounded ?? liveOn?.r ?? 0, single: !liveOn && e.ctrlKey, sharpen: cw.rounded !== undefined })
      return
    }
    const ah = hitAnchor(p)
    if (ah) {
      setSelAnchor(ah)
      setSel(new Set())
      setDrag({ kind: 'anchor', a: ah, start: p, dx: 0, dy: 0 })
      return
    }
    setSelAnchor(null)
    const h = hit(p)
    if (!h && selBounds) {
      const { s, ox, base } = xf.current
      const X = (x: number) => ox + x * s, Y = (y: number) => base - y * s
      const bh = hitTransformBox(selBounds, sx, sy, X, Y)
      if (bh?.mode === 'scale') {
        setDrag({ kind: 'box_scale', bounds: selBounds, handle: bh.handle, matrix: [1, 0, 0, 1, 0, 0] })
        return
      }
      if (bh?.mode === 'rotate') {
        setDrag({
          kind: 'box_rotate', bounds: selBounds,
          startAngle: Math.atan2(p.y - selBounds.cy, p.x - selBounds.cx),
          angle: 0, matrix: [1, 0, 0, 1, 0, 0],
        })
        return
      }
    }
    const edge = !h && o ? nearEdge(sx) : null
    if (edge) { setDrag({ kind: 'bearing', side: edge, sx, dx: 0 }); return }
    if (h && active === 'object') { grabShape(h[0], p, e); return }
    if (h) {
      const k = key(...h)
      if (e.shiftKey) {
        setSel(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
        return
      }
      if (!sel.has(k)) setSel(new Set([k]))
      setDrag({ kind: 'move', start: p, dx: 0, dy: 0, alt: e.altKey, primary: h })
      return
    }
    // Direct path interaction: Alt-click inserts a point; dragging a segment reshapes/moves it
    const segHit = hitSegment(pts.contours, pts.shapes.map(sh => sh.closed), hidden, locked, p, HIT_PX / xf.current.s, font.quadratic)
    if (segHit) {
      const { ci, seg, t } = segHit
      if (active === 'object') { grabShape(ci, p, e); return }
      if (e.altKey) {
        const newPts = subdivideContourSegment(pts.contours[ci], seg, t)
        edit('set_contour', { contour: ci, points: newPts, closed: pts.shapes[ci]?.closed ?? true })
        return
      }
      if (seg.kind === 'cubic') {
        setSel(new Set([key(ci, seg.c1), key(ci, seg.c2)]))
        setDrag({ kind: 'move', start: p, dx: 0, dy: 0, alt: false, primary: [ci, seg.c1] })
      } else if (seg.kind === 'quad') {
        setSel(new Set([key(ci, seg.c)]))  // a quadratic curve bends by its one control point
        setDrag({ kind: 'move', start: p, dx: 0, dy: 0, alt: false, primary: [ci, seg.c] })
      } else {
        setSel(new Set([key(ci, seg.i0), key(ci, seg.i1)]))
        setDrag({ kind: 'move', start: p, dx: 0, dy: 0, alt: false, primary: [ci, seg.i0] })
      }
      return
    }
    if (active === 'object') {
      const ci = contourAt(p)
      if (ci >= 0) { grabShape(ci, p, e); return }
    }
    setDrag({ kind: 'marquee', a: p, b: p, add: e.shiftKey })
  }

  /** Selection tool: take the whole of shape `ci` (Shift adds or removes it), and start moving it. */
  const grabShape = (ci: number, p: Pt, e: React.PointerEvent | React.MouseEvent) => {
    if (!pts) return
    const all = pts.contours[ci].map((_, pi) => key(ci, pi))
    if (e.shiftKey) {
      setSel(s => { const n = new Set(s); const on = all.every(k => n.has(k)); for (const k of all) { if (on) n.delete(k); else n.add(k) } return n })
      return
    }
    if (!all.every(k => sel.has(k))) setSel(new Set(all))
    setDrag({ kind: 'move', start: p, dx: 0, dy: 0, alt: e.altKey, primary: [ci, 0] })
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (active === 'hand') { setView(FIT); return }
    if (active !== 'select' || !editable || !pts) return
    const p = toFont(e)
    if (widgetAt(p)) { setCornerDlg({ r: Number(localStorage.getItem('forge.radius')) || 40 }); return }
    const h = hit(p)
    if (h) {
      const [ci, pi] = h
      const toggled = togglePointSmooth(pts.contours[ci], pts.shapes[ci]?.closed ?? true, pi)
      if (toggled) edit('set_contour', { contour: ci, points: toggled, closed: pts.shapes[ci]?.closed ?? true })
      return
    }
    const segHit = hitSegment(pts.contours, pts.shapes.map(sh => sh.closed), hidden, locked, p, (HIT_PX + 2) / xf.current.s, font.quadratic)
    if (segHit) {
      const { ci, seg, t } = segHit
      const newPts = subdivideContourSegment(pts.contours[ci], seg, t)
      edit('set_contour', { contour: ci, points: newPts, closed: pts.shapes[ci]?.closed ?? true })
    }
  }

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = toFont(e)
    if (active === 'pen' && !drag) {
      const adding = !e.ctrlKey && onOutline(p)
      if (adding !== addingPoint) setAddingPoint(adding)
      const snapped = !e.ctrlKey && !adding ? smartSnap(p, { origin: pen[pen.length - 1] ?? null, exclude: new Set() }) : { pt: p, guides: [] }
      setHover(snapped.pt)
      setSmartGuides(snapped.guides)
    } else if (vis.rulers || active === 'shaper') {
      setHover(p)
    }
    if (!drag) {
      const scr = screen(e)
      const over = picking && vis.guides && !(pts && hit(p)) ? guideAt(scr.sx, scr.sy)?.axis ?? null : null
      if (over !== overGuide) setOverGuide(over)
      if (active !== 'pen' && smartGuides.length) setSmartGuides([])
      const e2 = picking && editable && !hit(p) ? nearEdge(screen(e).sx) : null
      if (e2 !== edgeHover) setEdgeHover(e2)
      let bh: 'rotate' | null = null
      if (picking && selBounds && !hit(p) && !widgetAt(p)) {
        const { s, ox, base } = xf.current
        bh = hitTransformBox(selBounds, scr.sx, scr.sy, x => ox + x * s, y => base - y * s)?.mode === 'rotate' ? 'rotate' : null
      }
      if (bh !== boxHover) setBoxHover(bh)
      return
    }
    if (drag.kind === 'shaper') { setDrag({ kind: 'shaper', pts: [...drag.pts, p], alt: e.altKey }); return }
    if (drag.kind === 'corner') {
      const w = cornerWidgets.find(q => q.ci === drag.ci && q.pi === drag.pi)
      const c = w?.c, cr = w?.cr
      if (c && cr && w) setDrag({ ...drag, r: Math.round(radiusFromDrag(c, cr, w.rounded ? 2 : drag.pi, p.x, p.y, WIDGET_PX / xf.current.s)) })
      return
    }
    if (drag.kind === 'shape') { setDrag({ ...drag, b: e.ctrlKey ? p : smartSnap(p, { exclude: new Set() }).pt, square: e.shiftKey, center: e.altKey }); return }
    if (drag.kind === 'guide') {
      const { sx, sy } = screen(e)
      setDrag({ ...drag, v: Math.round(drag.axis === 'y' ? p.y : p.x), out: !!rulerAt(sx, sy) })
      return
    }
    if (drag.kind === 'anchor') {
      let dx = p.x - drag.start.x, dy = p.y - drag.start.y
      if (!e.ctrlKey) {
        const s = smartSnap({ x: drag.a.x + dx, y: drag.a.y + dy }, { exclude: new Set() })
        dx = s.pt.x - drag.a.x
        dy = s.pt.y - drag.a.y
        setSmartGuides(s.guides)
      } else setSmartGuides([])
      setDrag({ ...drag, dx, dy })
      liveAnchor(drag.a, dx, dy)
      return
    }
    if (drag.kind === 'bearing') {
      setDrag({ ...drag, dx: Math.round((screen(e).sx - drag.sx) / xf.current.s) })
      return
    }
    if (drag.kind === 'box_scale') {
      setDrag({ ...drag, matrix: scaleMatrix(drag.bounds, drag.handle, p, e.shiftKey, e.altKey) })
      return
    }
    if (drag.kind === 'box_rotate') {
      let ang = Math.atan2(p.y - drag.bounds.cy, p.x - drag.bounds.cx) - drag.startAngle
      if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12)
      setDrag({ ...drag, angle: ang, matrix: rotateMatrix(drag.bounds.cx, drag.bounds.cy, ang) })
      return
    }
    if (drag.kind === 'pan') {
      const { sx, sy } = screen(e)
      setView({ ...drag.view, tx: drag.view.tx + sx - drag.sx, ty: drag.view.ty + sy - drag.sy })
    } else if (drag.kind === 'measure') {
      let b = snap(p)
      if (e.shiftKey) b = lock45(drag.a, b)
      setMeasure({ a: drag.a, b })
    } else if (drag.kind === 'move') {
      let dx = p.x - drag.start.x, dy = p.y - drag.start.y
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0  // constrain like Illustrator
        setSmartGuides([])
      } else if (!e.ctrlKey && pts && drag.primary) {
        const [ci, pi] = drag.primary
        const c = pts.contours[ci]
        const orig = c?.[pi]
        if (orig) {
          const n = c.length
          const isHandle = !orig[2]
          const prev = c[(pi + n - 1) % n], next = c[(pi + 1) % n]
          const parentIdx = isHandle ? (prev?.[2] ? (pi + n - 1) % n : next?.[2] ? (pi + 1) % n : -1) : -1
          const parentAnchor = parentIdx >= 0 ? { x: c[parentIdx][0], y: c[parentIdx][1] } : null
          const oppIdx = parentIdx >= 0 ? (parentIdx === (pi + n - 1) % n ? (pi + n - 2) % n : (pi + 2) % n) : -1
          const oppositeHandle = oppIdx >= 0 && !c[oppIdx]?.[2] ? { x: c[oppIdx][0], y: c[oppIdx][1] } : null
          const neighborOn = !isHandle
            ? (prev?.[2] && !moving.has(key(ci, (pi + n - 1) % n)) ? { x: prev[0], y: prev[1] }
              : next?.[2] && !moving.has(key(ci, (pi + 1) % n)) ? { x: next[0], y: next[1] } : null)
            : null
          const snapped = smartSnap(
            { x: orig[0] + dx, y: orig[1] + dy },
            { isHandle, parentAnchor, oppositeHandle, origin: neighborOn, neighborOnCurve: neighborOn },
          )
          dx = snapped.pt.x - orig[0]
          dy = snapped.pt.y - orig[1]
          setSmartGuides(snapped.guides)
        }
      } else {
        setSmartGuides([])
      }
      setDrag({ ...drag, dx, dy, alt: e.altKey })
    } else if (drag.kind === 'pen') {
      // dragging out of a new anchor makes it a smooth curve point
      setPen(a => {
        const last = a[a.length - 1]
        let out = e.shiftKey ? lock45(last, p) : p
        if (!e.shiftKey && !e.ctrlKey) {
          const s = smartSnap(out, { isHandle: true, parentAnchor: last, exclude: new Set() })
          out = s.pt
          setSmartGuides(s.guides)
        }
        return [...a.slice(0, -1), { x: last.x, y: last.y, out, in: { x: 2 * last.x - out.x, y: 2 * last.y - out.y } }]
      })
    } else {
      setDrag({ ...drag, b: p })
    }
  }

  const onUp = () => {
    setSmartGuides([])
    if (drag?.kind === 'guide') {
      const list = drag.axis === 'y' ? guides : vguides, set = drag.axis === 'y' ? onGuides : onVGuides
      if (drag.out) { if (drag.i < list.length) set(list.filter((_, i) => i !== drag.i)) }  // dropped on a ruler: gone
      else if (drag.i < list.length) { if (list[drag.i] !== drag.v) set(list.map((g, i) => i === drag.i ? drag.v : g)) }
      else { setVis(v => ({ ...v, guides: true })); set([...list, drag.v]) }
    }
    if (drag?.kind === 'move') moveSel(drag.dx, drag.dy, drag.alt)
    if (drag?.kind === 'corner' && drag.sharpen) {
      const w0 = cornerWidgets.find(q => q.ci === drag.ci && q.pi === drag.pi)
      if (drag.r !== (w0?.rounded ?? -1)) {
        localStorage.setItem('forge.cornerKind', cornerKind)
        edit('round_corners', { radius: drag.r, corner: cornerKind, sharpen: true, points: drag.single ? [[drag.ci, drag.pi]] : [...sel].map(unkey) })
      }
    } else if (drag?.kind === 'corner' && (liveOn ? drag.r !== liveOn.r : drag.r > 0)) applyCorners(drag.r, cornerKind, drag.single ? [[drag.ci, drag.pi]] : cornerWidgets.map(w => [w.ci, w.pi]))
    if (drag?.kind === 'shape') {
      const r = shapeBox(drag)
      if (r.w >= 2 && r.h >= 2) setJustDrawn({ ...drag, oval: active === 'oval' })
      if (r.w >= 2 && r.h >= 2) edit('add_contour', { points: (active === 'oval' ? oval(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2) : rect(r.x, r.y, r.w, r.h)).points.map(([x, y, on]) => [Math.round(x), Math.round(y), on]), closed: true })
    }
    if (drag?.kind === 'shaper' && regions) {
      const faces = crossed(drag.pts)
      if (!faces.length) toast('Drag across the regions to fuse; hold Alt to remove')
      else if (drag.alt) edit('shape_build', { mode: 'delete', contours: regions.contours, faces })
      else if (faces.length > 1) edit('shape_build', { mode: 'merge', contours: regions.contours, faces })
      else toast('Drag across two or more regions to fuse them')
    }
    if ((drag?.kind === 'box_scale' || drag?.kind === 'box_rotate') && pts) {
      const m = drag.matrix
      if (m[0] !== 1 || m[1] !== 0 || m[2] !== 0 || m[3] !== 1 || m[4] !== 0 || m[5] !== 0) {
        const keys = [...moving]
        const whole = pts.contours.map((c, ci) => c.every((_, pi) => keys.includes(key(ci, pi))))
        const contours = whole.flatMap((w, ci) => w ? [ci] : [])
        const points = keys.map(unkey).filter(([ci]) => !whole[ci])
        edit('transform', { matrix: m, contours, points })
      }
    }
    if (drag?.kind === 'anchor' && (drag.dx || drag.dy) && name) {
      const a = { ...drag.a, x: Math.round(drag.a.x + drag.dx), y: Math.round(drag.a.y + drag.dy) }
      setSelAnchor(a)
      anchorWant.current = null  // no more live moves: the final one goes after any still on its way
      run(async () => {
        while (anchorBusy.current) await new Promise(r => setTimeout(r, 15))
        return api<Points>('/api/anchor', { name, cls: a.cls, type: a.type, x: a.x, y: a.y })
      })
    }
    if (drag?.kind === 'bearing' && drag.dx && o && name) {
      // left line moved right = less left space; right line moved right = more
      const body = drag.side === 'L' ? { name, lsb: o.lsb - drag.dx } : { name, rsb: o.rsb + drag.dx }
      run(async () => {
        outlines.put(await api<RawOutline>('/api/bearings', body), null)
        return api<Points>(`/api/glyph/${encodeURIComponent(name)}`)
      })
    }
    if (drag?.kind === 'marquee' && pts) {
      const [x0, x1] = [drag.a.x, drag.b.x].sort((a, b) => a - b), [y0, y1] = [drag.a.y, drag.b.y].sort((a, b) => a - b)
      const inside = new Set(drag.add ? sel : [])
      pts.contours.forEach((c, ci) => !hidden.has(ci) && !locked.has(ci) && c.forEach((q, pi) => {
        if (q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) inside.add(key(ci, pi))
      }))
      if (active === 'object') {  // whole shapes: any shape with a point in the box
        for (const ci of new Set([...inside].map(k => unkey(k)[0]))) pts.contours[ci].forEach((_, pi) => inside.add(key(ci, pi)))
      }
      setSel(inside)
    }
    setDrag(null)
  }

  /** The topmost shape whose fill is under this point (font units), or -1. For the Selection tool. */
  const pickCtx = useRef<CanvasRenderingContext2D | null>(null)
  const contourAt = (p: Pt): number => {
    if (!pts) return -1
    pickCtx.current ??= document.createElement('canvas').getContext('2d')
    const c = pickCtx.current
    if (!c) return -1
    for (let ci = pts.contours.length - 1; ci >= 0; ci--) {
      if (hidden.has(ci) || locked.has(ci)) continue
      if (c.isPointInPath(contourPath([pts.contours[ci]], [pts.shapes[ci]?.closed ?? true], font.quadratic), p.x, p.y)) return ci
    }
    return -1
  }

  const pickTool = (t: Tool) => { if (pen.length) commitPen(false); setTool(t) }

  // ---- clipboard and right-click menu
  const [ctxPoint, setCtxPoint] = useState<[number, number] | null>(null)
  /** The selected shapes, or every shape when nothing is selected. */
  const targetShapes = () => pts ? (sel.size ? [...new Set([...sel].map(k => unkey(k)[0]))].sort((a, b) => a - b) : pts.contours.map((_, i) => i)) : []
  const copiedShapes = () => {
    const cs = targetShapes()
    return { contours: cs.map(ci => pts!.contours[ci].map(p => [p[0], p[1], p[2]] as P3)), closed: cs.map(ci => pts!.shapes[ci]?.closed ?? true) }
  }
  const copySel = () => {
    if (!pts?.contours.length) { toast('Nothing to copy'); return }
    const c = copiedShapes()
    setClip({ kind: 'contours', ...c, quadratic: font.quadratic, em: font.em })
    toast(`Copied ${c.contours.length} shape${c.contours.length > 1 ? 's' : ''}`)
  }
  /** Paste scaled to this font's em (copied from a font with another em); inPlace keeps the numbers as they are. */
  const pasteClip = async (inPlace = false) => {
    const c = await getClip()
    if (!c) { toast('Nothing to paste: copy shapes or a glyph first'); return }
    const k = inPlace || !c.em ? 1 : font.em / c.em
    const cc = clipContours(c)
    if (editable) edit('paste', { ...cc, contours: k === 1 ? cc.contours : cc.contours.map(ct => ct.map(([x, y, on]) => [Math.round(x * k), Math.round(y * k), on])), quadratic: c.quadratic })
  }
  /** Select every shape like the selected ones: the same number of points and nearly the same size. */
  const selectSimilar = () => {
    if (!pts || !sel.size) { toast('Select a shape first'); return }
    const box = (c: { 0: number; 1: number }[]) => { const xs = c.map(p => p[0]), ys = c.map(p => p[1]); return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)] }
    const refs = [...new Set([...sel].map(k => unkey(k)[0]))].map(ci => ({ n: pts.contours[ci].length, b: box(pts.contours[ci]) }))
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.05 * Math.max(a, b, 1)
    const out = new Set<string>()
    pts.contours.forEach((c, ci) => {
      if (hidden.has(ci) || locked.has(ci)) return
      const b = box(c)
      if (refs.some(r => r.n === c.length && near(r.b[0], b[0]) && near(r.b[1], b[1]))) c.forEach((_, pi) => out.add(key(ci, pi)))
    })
    setSel(out)
    toast(`${new Set([...out].map(k => unkey(k)[0])).size} similar shapes selected`)
  }
  const cutSel = () => { copySel(); if (pts) edit('delete_contours', { contours: targetShapes() }); setSel(new Set()) }
  const duplicateSel = () => { if (pts?.contours.length) edit('paste', { ...copiedShapes(), quadratic: font.quadratic }) }
  const makeFirst = () => {
    if (!ctxPoint || !pts) return
    const [ci, pi] = ctxPoint
    const c = pts.contours[ci]
    if (!c?.[pi]?.[2] || !pts.shapes[ci]?.closed) return
    edit('set_contour', { contour: ci, points: [...c.slice(pi), ...c.slice(0, pi)].map(p => [p[0], p[1], p[2]]), closed: true })
  }
  const copyMaster = (source: string, targets: string[]) => {
    if (!name || !masterOps) return
    run(async () => { await masterOps.copy(source, targets, [name]); return api<Points>(`/api/glyph/${encodeURIComponent(name)}`) })
  }
  const onContextMenu = (e: React.MouseEvent) => {
    if (!pts) return
    const h = hit(toFont(e))
    setCtxPoint(h)
    // right-clicking a shape that isn't selected selects it, as in Illustrator
    if (h && !sel.has(key(...h))) setSel(new Set(pts.contours[h[0]].map((_, pi) => key(h[0], pi))))
  }

  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (pen.length && (k === 'enter' || k === 'escape')) { e.preventDefault(); commitPen(false); return }
    if (pen.length && k === 'backspace') { e.preventDefault(); setPen(a => a.slice(0, -1)); return }
    if (mod && k === 'z') { e.preventDefault(); if (editable) { if (e.shiftKey) redo(); else undo() } return }
    if (mod && k === 'y') { e.preventDefault(); if (editable) redo(); return }
    if (mod && k === 'c') { e.preventDefault(); copySel(); return }
    if (mod && k === 'x') { e.preventDefault(); if (editable) cutSel(); return }
    if (mod && k === 'v') { e.preventDefault(); if (editable) void pasteClip(e.shiftKey); return }
    if (mod && k === 'd') { e.preventDefault(); if (editable) duplicateSel(); return }
    if (mod && e.shiftKey && k === 'a') { e.preventDefault(); setSel(new Set()); return }  // Illustrator: Select > Deselect
    // Illustrator's View keys
    if (mod && !e.shiftKey && k === 'r') { e.preventDefault(); setVis(v => ({ ...v, rulers: !v.rulers })); return }
    if (mod && !e.shiftKey && k === 'u') { e.preventDefault(); setVis(v => ({ ...v, smart: !v.smart })); return }
    if (mod && k === "'") { e.preventDefault(); setVis(v => ({ ...v, grid: !v.grid })); return }
    if (mod && k === ';') { e.preventDefault(); setVis(v => ({ ...v, guides: !v.guides })); return }
    if (mod && k === '0') { e.preventDefault(); setView(FIT); return }
    if (mod && !e.altKey && (k === '=' || k === '+')) { e.preventDefault(); zoomAt(e.currentTarget.clientWidth / 2, e.currentTarget.clientHeight / 2, 1.25); return }
    if (mod && !e.altKey && k === '-') { e.preventDefault(); zoomAt(e.currentTarget.clientWidth / 2, e.currentTarget.clientHeight / 2, 0.8); return }
    if (mod && k === 'a') { e.preventDefault(); if (pts) setSel(new Set(pts.contours.flatMap((c, ci) => hidden.has(ci) || locked.has(ci) ? [] : c.map((_, pi) => key(ci, pi))))); return }
    if (mod || e.altKey) return
    const step = e.shiftKey ? getSettings().nudgeBig : getSettings().nudge
    const nudge: Record<string, [number, number]> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, step], arrowdown: [0, -step] }
    if (nudge[k] && editable && sel.size) { e.preventDefault(); moveSel(...nudge[k]); return }
    if ((k === 'delete' || k === 'backspace') && editable && selAnchor) { e.preventDefault(); deleteAnchor(selAnchor); return }
    if ((k === 'delete' || k === 'backspace') && editable) { e.preventDefault(); deleteSel(); return }
    if (k === ' ') { e.preventDefault(); setSpace(true) }
    else if (k === 'v') pickTool('object')
    else if (k === 'a') pickTool('select')
    else if (k === 'p') pickTool('pen')
    else if (k === 'm') pickTool(e.shiftKey ? 'shaper' : 'rect')  // Illustrator: M rectangle, Shift M Shape Builder, L ellipse
    else if (k === 'l') pickTool('oval')
    else if (k === 'f' && editable && pts && !e.ctrlKey && !e.metaKey) {  // Blender's F: a filled shape between the selected points
      const ps = [...sel].map(unkey).map(([ci, pi]) => pts.contours[ci]?.[pi]).filter(Boolean)
      if (ps.length < 3) toast('Select three or more points, then press F to fill between them')
      else {
        const cx = ps.reduce((n, q) => n + q[0], 0) / ps.length, cy = ps.reduce((n, q) => n + q[1], 0) / ps.length
        const ring = [...ps].sort((p, q) => Math.atan2(q[1] - cy, q[0] - cx) - Math.atan2(p[1] - cy, p[0] - cx))  // clockwise, like every outer shape
        edit('add_contour', { points: ring.map(q => [q[0], q[1], 1]), closed: true })
      }
    }
    else if (k === 'h') pickTool('hand')
    else if (k === 'z') pickTool('zoom')
    else if (k === 'k') pickTool('measure')
    else if (k === '0' || k === 'f') setView(FIT)
    else if (k === '=' || k === '+') zoomAt(e.currentTarget.clientWidth / 2, e.currentTarget.clientHeight / 2, 1.25)
    else if (k === '-') zoomAt(e.currentTarget.clientWidth / 2, e.currentTarget.clientHeight / 2, 0.8)
    else if (k === 'escape') { setMeasure(null); setSel(new Set()) }
  }

  useCommands(c => {
    const w = document.body.clientWidth / 2, h = document.body.clientHeight / 2
    const run2: Partial<Record<typeof c, () => void>> = {
      undo: () => editable && undo(),
      redo: () => editable && redo(),
      restore: () => editable && restore(),
      selectAll: () => pts && setSel(new Set(pts.contours.flatMap((cc, ci) => hidden.has(ci) || locked.has(ci) ? [] : cc.map((_, pi) => key(ci, pi))))),
      deselect: () => { setSel(new Set()); setMeasure(null) },
      delete: () => editable && deleteSel(),
      roundCorners: () => editable && roundCorners(Number(localStorage.getItem('forge.radius')) || 40, (localStorage.getItem('forge.cornerKind') as CornerKind) || 'round'),
      flipH: () => editable && transform('flipH'), flipV: () => editable && transform('flipV'),
      rotCW: () => editable && transform('rotCW'), rotCCW: () => editable && transform('rotCCW'),
      union: () => editable && pathfinder('union'), subtract: () => editable && pathfinder('subtract'),
      intersect: () => editable && pathfinder('intersect'),
      mergeAll: () => editable && edit('remove_overlap'), fixDirection: () => editable && edit('correct_direction'),
      addExtrema: () => editable && edit('add_extrema'), simplify: () => editable && edit('simplify'), roundCoords: () => editable && edit('round'),
      addInflections: () => editable && edit('add_inflections'), balance: () => editable && edit('balance'), harmonize: () => editable && edit('harmonize'),
      cleanUp: () => editable && edit('clean_up'), clearGlyph: () => editable && edit('clear'), bolder: () => editable && edit('weight', { delta: 10 }), lighter: () => editable && edit('weight', { delta: -10 }),
      build: () => editable && build(), draftLigature: () => editable && edit('draft_ligature'), import: () => editable && importOutlines(),
      fit: () => setView(FIT), zoomIn: () => zoomAt(w, h, 1.25), zoomOut: () => zoomAt(w, h, 0.8),
      toggleSmart: () => setVis(v => ({ ...v, smart: !v.smart })),
      toggleGrid: () => setVis(v => ({ ...v, grid: !v.grid })),
      toggleRulers: () => setVis(v => ({ ...v, rulers: !v.rulers })),
      toggleGuides: () => setVis(v => ({ ...v, guides: !v.guides })),
      toggleShadow: () => setVis(v => ({ ...v, shadow: !v.shadow })),
      'tool:object': () => pickTool('object'), 'tool:select': () => pickTool('select'), 'tool:pen': () => pickTool('pen'), 'tool:shaper': () => pickTool('shaper'), 'tool:rect': () => pickTool('rect'), 'tool:oval': () => pickTool('oval'), 'tool:hand': () => pickTool('hand'),
      'tool:zoom': () => pickTool('zoom'), 'tool:measure': () => pickTool('measure'),
    }
    run2[c]?.()
  })

  const importOutlines = async (flags: string[] = ['correctdir']) => {
    if (!name) return
    const { path } = await api<{ path: string | null }>('/api/pick', { mode: 'outline' })
    if (path) run(() => api<Points>('/api/import', { name, path, flags }))
  }

  const emptyPts: Points = useMemo(() => ({
    name: name ?? '', width: o?.width ?? 0, d: '', contours: [], refs_list: [],
    background: '', shapes: [], ref_xf: [], anchors: [],
  }), [name, o?.width])

  if (!name) return <div className="grid h-full place-items-center text-muted-foreground">Select a glyph</div>
  const info = font.glyphs.find(g => g.name === name)
  const nPts = pts?.contours.reduce((a, c) => a + c.length, 0) ?? 0
  const selShapes = new Set([...sel].map(k => unkey(k)[0]))
  const cursor = (drag?.kind === 'guide' ? drag.axis : overGuide) === 'y' ? 'cursor-ns-resize' : (drag?.kind === 'guide' ? drag.axis : overGuide) === 'x' || drag?.kind === 'bearing' || edgeHover ? 'cursor-ew-resize' : drag?.kind === 'pan' ? 'cursor-grabbing'
    : { object: 'cursor-default', select: 'cursor-default', pen: 'cursor-crosshair', rect: 'cursor-crosshair', oval: 'cursor-crosshair', shaper: 'cursor-crosshair', hand: 'cursor-grab', zoom: 'cursor-zoom-in', measure: 'cursor-crosshair' }[active]

  const layersPanel = (docked: boolean) => (
          <LayersPanel pts={pts ?? emptyPts} quadratic={font.quadratic} selected={selShapes} editable={editable}
            hidden={hidden} locked={locked} onHidden={setHidden} onLocked={l => { setLocked(l); setSel(new Set()) }}
            vis={vis} onVis={setVis} guides={guides} onGuides={onGuides} vguides={vguides} onVGuides={onVGuides}
            hasBackground={!!pts?.background} referenceName={reference ? `${reference.info.familyname}${refName ? '' : ' (no match)'}` : null}
            mastersName={ghosts.length ? ghosts.map(g => g.label).join(', ') : null}
            underlayName={underlay?.name ?? null}
            anchors={pts?.anchors ?? []} classes={classes} selAnchor={selAnchor} onSelectAnchor={setSelAnchor}
            inherited={inherited} onInherited={editInherited}
            onAddAnchor={addAnchor} onDeleteAnchor={deleteAnchor} isAccent={!!underlay || isAccentChar(glyphInfo?.unicode ?? -1)}
            shadowName={shadowName} autoShadow={autoShadow} onShadow={v => setShadowPick(resolveGlyph(font, v))}
            onSelectShape={(ci, add) => pts && setSel(s => new Set([...(add ? s : []), ...pts.contours[ci].map((_, pi) => key(ci, pi))]))}
            edit={edit} docked={docked} storageKey={underlay !== undefined ? 'forge.layers.accents' : 'forge.layers'} />
  )

  return (
    <div className="flex h-full flex-col">
      {cornerDlg && <CornersDialog open kind={cornerKind} radius={cornerDlg.r}
        onPreview={(k, r) => { setCornerKind(k); setCornerDlg({ r }) }}
        onClose={() => { setCornerKind((localStorage.getItem('forge.cornerKind') as CornerKind) || 'round'); setCornerDlg(null) }}
        onApply={(k, r) => { localStorage.setItem('forge.radius', String(r)); setCornerDlg(null); applyCorners(r, k, [...sel].map(unkey)) }} />}
      {atDefault && (
        <ActionsBar hasSelection={sel.size > 0} shapes={selShapes.size} hasUnicode={(info?.unicode ?? -1) >= 0}
          transform={transform} pathfinder={pathfinder} edit={k => edit(k)} build={build} onImport={() => importOutlines()} />
      )}
      <div className="relative min-h-0 flex-1 outline-none" tabIndex={0} onKeyDown={onKey}
        onKeyUp={e => e.key === ' ' && setSpace(false)} onBlur={() => setSpace(false)}>
        <ContextMenu>
        <ContextMenuTrigger asChild disabled={!editable}>
        <canvas ref={ref} className={`absolute inset-0 size-full ${cursor}`} style={boxHover === 'rotate' || drag?.kind === 'box_rotate' ? { cursor: ROTATE_CURSOR } : undefined} onContextMenu={onContextMenu}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
          onMouseLeave={() => { setHover(null); setSmartGuides([]); if (drag?.kind !== 'pen') onUp() }}
          onDoubleClick={onDoubleClick}
          onWheel={e => {
            const { sx, sy } = screen(e)
            zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015))
          }} />
        </ContextMenuTrigger>
        <ContextMenuContent className="w-60">
          <ContextMenuItem onSelect={cutSel}>Cut<ContextMenuShortcut>Ctrl X</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem onSelect={copySel}>Copy<ContextMenuShortcut>Ctrl C</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem onSelect={() => void pasteClip()}>Paste<ContextMenuShortcut>Ctrl V</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem onSelect={() => void pasteClip(true)}>Paste in Place<ContextMenuShortcut>Ctrl Shift V</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem onSelect={duplicateSel}>Duplicate<ContextMenuShortcut>Ctrl D</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem variant="destructive" disabled={!sel.size} onSelect={deleteSel}>Delete<ContextMenuShortcut>Del</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => pts && setSel(new Set(pts.contours.flatMap((c, ci) => hidden.has(ci) || locked.has(ci) ? [] : c.map((_, pi) => key(ci, pi)))))}>
            Select All<ContextMenuShortcut>Ctrl A</ContextMenuShortcut></ContextMenuItem>
          <ContextMenuItem disabled={!sel.size} onSelect={selectSimilar}>Select Similar</ContextMenuItem>
          <ContextMenuItem onSelect={() => edit('reverse', { contours: targetShapes() })}>Reverse Direction</ContextMenuItem>
          <ContextMenuItem disabled={!hasStrokes} onSelect={() => edit('expand_strokes', selStrokes.length ? { contours: selStrokes } : {})}>Expand Stroke</ContextMenuItem>
          <ContextMenuItem disabled={!ctxPoint || !pts?.contours[ctxPoint[0]]?.[ctxPoint[1]]?.[2] || !pts?.shapes[ctxPoint[0]]?.closed}
            onSelect={makeFirst}>Make First Point</ContextMenuItem>
          <ContextMenuItem onSelect={() => transform('flipH')}>Flip Horizontal</ContextMenuItem>
          <ContextMenuItem onSelect={() => transform('flipV')}>Flip Vertical</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={restore}>Restore to Last Saved</ContextMenuItem>
          {masterOps && masterOps.others.length > 0 && <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>Replace with Version From</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {masterOps.others.map(m => <ContextMenuItem key={m.path} onSelect={() => copyMaster(m.path, [masterOps.current])}>{m.label}</ContextMenuItem>)}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Copy This Version To</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onSelect={() => copyMaster(masterOps.current, masterOps.others.map(m => m.path))}>All Other Masters</ContextMenuItem>
                <ContextMenuSeparator />
                {masterOps.others.map(m => <ContextMenuItem key={m.path} onSelect={() => copyMaster(masterOps.current, [m.path])}>{m.label}</ContextMenuItem>)}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>}
        </ContextMenuContent>
        </ContextMenu>
        {editable && LIGATURES.has(info?.unicode ?? -1) && pts && !pts.contours.length && !pts.refs_list.length && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <Button className="pointer-events-auto" variant="outline" onClick={() => edit('draft_ligature')}
              title="Build it from its parts as components (a + e, or O + slash). Then Make editable and finish it. Or ignore this and draw or paste your own.">
              Draft from parts
            </Button>
          </div>
        )}
        <div className={`absolute flex flex-col gap-0.5 rounded-md border bg-card/90 p-0.5 shadow-sm backdrop-blur ${vis.rulers ? 'top-7 left-7' : 'top-2 left-2'}`}>
          {TOOLS.map(({ id, icon: Icon, label, key: k, solid }) => (
            <Tip key={id} label={label} k={k}>
              <Button size="icon-sm" variant={active === id ? 'secondary' : 'ghost'} aria-label={label}
                aria-pressed={active === id} disabled={(id === 'object' || id === 'select' || id === 'pen' || id === 'rect' || id === 'oval' || id === 'shaper') && !atDefault}
                onClick={() => pickTool(id)}><Icon fill={solid ? 'currentColor' : 'none'} /></Button>
            </Tip>
          ))}
          <div className="mx-1 my-0.5 h-px bg-border" />
          <Tip label="Fit to window" k="0">
            <Button size="icon-sm" variant="ghost" aria-label="Fit glyph to window" onClick={() => setView(FIT)}><Maximize /></Button>
          </Tip>
          <Tip label="Undo (FontForge's per-glyph undo)" k="Ctrl Z">
            <Button size="icon-sm" variant="ghost" aria-label="Undo" disabled={!editable} onClick={undo}><Undo2 /></Button>
          </Tip>
          <Tip label="Redo what you just undid" k="Ctrl Shift Z">
            <Button size="icon-sm" variant="ghost" aria-label="Redo" disabled={!editable} onClick={redo}><Redo2 /></Button>
          </Tip>
          <Tip label="Restore to last saved: the glyph as it is in the saved file (undoable)">
            <Button size="icon-sm" variant="ghost" aria-label="Restore glyph to last saved" disabled={!editable} onClick={restore}><History /></Button>
          </Tip>
          <div className="mx-1 my-0.5 h-px bg-border" />
          <Tip label="Smart guides & snapping (alignment, line extensions, parallel, equal stems; hold Ctrl to bypass)" k="S">
            <Button size="icon-sm" variant={vis.smart ? 'secondary' : 'ghost'} aria-label="Toggle smart guides"
              aria-pressed={vis.smart} onClick={() => setVis(v => ({ ...v, smart: !v.smart }))}><Magnet /></Button>
          </Tip>
          <Tip label="Toggle grid" k="G">
            <Button size="icon-sm" variant={vis.grid ? 'secondary' : 'ghost'} aria-label="Toggle grid"
              aria-pressed={vis.grid} onClick={() => setVis(v => ({ ...v, grid: !v.grid }))}><Grid3x3 /></Button>
          </Tip>
          <Tip label="Toggle rulers" k="R">
            <Button size="icon-sm" variant={vis.rulers ? 'secondary' : 'ghost'} aria-label="Toggle rulers"
              aria-pressed={vis.rulers} onClick={() => setVis(v => ({ ...v, rulers: !v.rulers }))}><Scaling /></Button>
          </Tip>
        </div>
        {atDefault && layersHost === undefined && layersPanel(false)}
        {atDefault && layersHost && createPortal(layersPanel(true), layersHost)}
      </div>
      <div className="flex gap-4 border-t px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        <span className="text-foreground">{name}</span>
        {info && info.unicode >= 0 && <span>U+{info.unicode.toString(16).toUpperCase().padStart(4, '0')}</span>}
        {o && <span>w {Math.round(o.width)}</span>}
        {o && <span>L {Math.round(o.lsb)} · R {Math.round(o.rsb)}</span>}
        {atDefault && <span>{pts ? `${pts.contours.length} shapes · ${nPts} points` : '…'}</span>}
        {vis.shadow && shadow && o && (
          <span title={`Compared with the shadow letter ${shadowName}`}>
            vs {shadowName}: L {signed(o.lsb - shadow.lsb)} · R {signed(o.rsb - shadow.rsb)} · w {signed(o.width - shadow.width)}
          </span>
        )}
        {sel.size > 0 && <span className="text-foreground">{sel.size} selected</span>}
        {drag?.kind === 'move' && <span className="text-foreground">Δ {drag.dx}, {drag.dy}{drag.alt ? ' · handles broken' : ''}</span>}
        {pen.length > 0 && <span className="text-foreground">pen: {pen.length} points · Enter ends · click first point closes</span>}
        {busy && <span>saving…</span>}
        {!atDefault && <span>instance outline · edit at the default location</span>}
        <span className="flex-1" />
        <span>{Math.round(view.z * 100)}%</span>
      </div>
    </div>
  )
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString()

function lock45(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy)
  return { x: Math.round(a.x + Math.cos(ang) * len), y: Math.round(a.y + Math.sin(ang) * len) }
}

const signed = (n: number) => (n > 0 ? '+' : '') + Math.round(n)

/** "E", "/E", "U+0045" or a glyph name -> glyph name in this font; "" -> automatic. */
function resolveGlyph(font: FontInfo, v: string): string | null {
  v = v.trim().replace(/^\//, '')
  if (!v) return null
  const hex = /^(?:u\+|uni|0x)([0-9a-f]{4,6})$/i.exec(v)
  const cp = hex ? parseInt(hex[1], 16) : [...v].length === 1 ? v.codePointAt(0)! : -1
  return font.glyphs.find(g => g.name === v)?.name ?? font.glyphs.find(g => cp >= 0 && g.unicode === cp)?.name ?? null
}
