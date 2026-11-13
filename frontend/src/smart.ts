import type { Pt3 } from './api'

export type Pt = { x: number; y: number }

export type SmartGuide =
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number; label?: string; dashed?: boolean; target?: Pt }
  | { kind: 'parallel'; a0: Pt; a1: Pt; b0: Pt; b1: Pt }
  | { kind: 'distance'; a0: Pt; a1: Pt; b0: Pt; b1: Pt; dist: number; axis: 'x' | 'y' }

export type Segment =
  | { kind: 'line'; i0: number; i1: number; p0: Pt; p1: Pt }
  | { kind: 'cubic'; i0: number; c1: number; c2: number; i1: number; p0: Pt; p1: Pt; p2: Pt; p3: Pt }
  // TrueType: one control point; an end may be implied (the midpoint of two
  // consecutive off-curve points), shown by startImplied / endImplied
  | { kind: 'quad'; c: number; p0: Pt; p1: Pt; p2: Pt; startImplied: boolean; endImplied: boolean }

export type ScaleHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export type BoxHit = { mode: 'scale'; handle: ScaleHandle } | { mode: 'rotate' }

const key = (ci: number, pi: number) => `${ci}:${pi}`
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/**
 * Parse a FontForge contour into segments. Cubic fonts: on, off, off, on.
 * Quadratic (TrueType) fonts: each off-curve point is the control of its own
 * curve, and two consecutive off-curve points imply an on-curve point halfway.
 */
export function segmentsOf(c: Pt3[], closed: boolean, quadratic = false): Segment[] {
  const start = c.findIndex(p => p[2])
  if (start < 0) return []
  const n = c.length
  const steps = closed ? n : n - start - 1
  const out: Segment[] = []
  let prevIdx = start
  let offs: number[] = []
  for (let k = 1; k <= steps; k++) {
    const idx = (start + k) % n
    const p = c[idx]
    if (!p[2]) {
      offs.push(idx)
      continue
    }
    const p0 = { x: c[prevIdx][0], y: c[prevIdx][1] }
    const pEnd = { x: p[0], y: p[1] }
    if (offs.length === 0) {
      out.push({ kind: 'line', i0: prevIdx, i1: idx, p0, p1: pEnd })
    } else if (quadratic) {
      const ctrl = offs.map(i => ({ x: c[i][0], y: c[i][1] }))
      offs.forEach((ci, k) => {
        const start = k === 0 ? p0 : lerp(ctrl[k - 1], ctrl[k], 0.5)
        const end = k === offs.length - 1 ? pEnd : lerp(ctrl[k], ctrl[k + 1], 0.5)
        out.push({ kind: 'quad', c: ci, p0: start, p1: ctrl[k], p2: end, startImplied: k > 0, endImplied: k < offs.length - 1 })
      })
    } else if (offs.length === 2) {
      const c1 = offs[0], c2 = offs[1]
      out.push({
        kind: 'cubic', i0: prevIdx, c1, c2, i1: idx,
        p0, p1: { x: c[c1][0], y: c[c1][1] }, p2: { x: c[c2][0], y: c[c2][1] }, p3: pEnd,
      })
    }
    prevIdx = idx
    offs = []
  }
  return out
}

export function evalQuad(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const u = 1 - t
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y }
}

function evalCubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

/** Hit-test all visible, unlocked contour segments within `tol` font units. */
export function hitSegment(
  contours: Pt3[][],
  closed: boolean[],
  hidden: Set<number>,
  locked: Set<number>,
  pt: Pt,
  tol: number,
  quadratic = false,
): { ci: number; seg: Segment; t: number; proj: Pt } | null {
  let best: { ci: number; seg: Segment; t: number; proj: Pt } | null = null
  let bestD = tol
  contours.forEach((c, ci) => {
    if (hidden.has(ci) || locked.has(ci)) return
    for (const seg of segmentsOf(c, closed[ci] ?? true, quadratic)) {
      if (seg.kind === 'line') {
        const dx = seg.p1.x - seg.p0.x, dy = seg.p1.y - seg.p0.y
        const len2 = dx * dx + dy * dy
        if (len2 < 1e-6) continue
        const t = Math.max(0.08, Math.min(0.92, ((pt.x - seg.p0.x) * dx + (pt.y - seg.p0.y) * dy) / len2))
        const proj = { x: seg.p0.x + t * dx, y: seg.p0.y + t * dy }
        const d = Math.hypot(pt.x - proj.x, pt.y - proj.y)
        if (d < bestD) { bestD = d; best = { ci, seg, t, proj } }
      } else {
        const N = 24
        for (let i = 1; i < N; i++) {
          const t0 = (i - 0.5) / N, t1 = (i + 0.5) / N
          const tm = i / N
          const at = (tt: number) => seg.kind === 'quad' ? evalQuad(seg.p0, seg.p1, seg.p2, tt) : evalCubic(seg.p0, seg.p1, seg.p2, seg.p3, tt)
          const pm = at(tm)
          const d = Math.hypot(pt.x - pm.x, pt.y - pm.y)
          if (d < bestD) {
            // refine locally
            let bt = tm, bp = pm, bd = d
            for (let j = 0; j <= 6; j++) {
              const tt = t0 + (t1 - t0) * (j / 6)
              const pp = at(tt)
              const dd = Math.hypot(pt.x - pp.x, pt.y - pp.y)
              if (dd < bd) { bd = dd; bt = tt; bp = pp }
            }
            bestD = bd
            best = { ci, seg, t: Math.max(0.08, Math.min(0.92, bt)), proj: bp }
          }
        }
      }
    }
  })
  return best
}

const rPt = (p: Pt): [number, number] => [Math.round(p.x), Math.round(p.y)]

/** Subdivide a line or cubic Bézier segment at `t` (de Casteljau), returning replacement points for `set_contour`. */
export function subdivideContourSegment(c: Pt3[], seg: Segment, t: number): [number, number, number][] {
  const pts: [number, number, number][] = c.map(p => [p[0], p[1], p[2]])
  if (seg.kind === 'line') {
    const mid = lerp(seg.p0, seg.p1, t)
    const insertAt = seg.i1 === 0 ? pts.length : seg.i1
    pts.splice(insertAt, 0, [...rPt(mid), 1])
    return pts
  }
  if (seg.kind === 'quad') {
    // split the quadratic at t; implied ends become explicit on-curve points,
    // because the new control points would otherwise imply different ones
    const q0 = lerp(seg.p0, seg.p1, t), q1 = lerp(seg.p1, seg.p2, t), s = lerp(q0, q1, t)
    pts.splice(seg.c, 1,
      ...(seg.startImplied ? [[...rPt(seg.p0), 1] as [number, number, number]] : []),
      [...rPt(q0), 0], [...rPt(s), 1], [...rPt(q1), 0],
      ...(seg.endImplied ? [[...rPt(seg.p2), 1] as [number, number, number]] : []))
    return pts
  }
  const q0 = lerp(seg.p0, seg.p1, t)
  const q1 = lerp(seg.p1, seg.p2, t)
  const q2 = lerp(seg.p2, seg.p3, t)
  const r0 = lerp(q0, q1, t)
  const r1 = lerp(q1, q2, t)
  const s = lerp(r0, r1, t)
  // Replace [c1, c2] with [q0, r0, s(on), r1, q2]
  pts.splice(seg.c1, 2,
    [...rPt(q0), 0],
    [...rPt(r0), 0],
    [...rPt(s), 1],
    [...rPt(r1), 0],
    [...rPt(q2), 0],
  )
  return pts
}

/** Toggle an on-curve point between Smooth (○) and Corner (□), returning replacement points for `set_contour`. */
export function togglePointSmooth(c: Pt3[], closed: boolean, pi: number): [number, number, number][] | null {
  const n = c.length
  if (n < 2 || !c[pi]?.[2]) return null
  const isSmooth = c[pi][3] === 1 || c[pi][3] === 2
  const prevIdx = (pi + n - 1) % n
  const nextIdx = (pi + 1) % n
  const prev = c[prevIdx], cur = c[pi], next = c[nextIdx]

  if (isSmooth) {
    // Smooth -> Corner: pull adjacent off-curve handles onto the chord toward their on-curve neighbor
    // or remove off-curve pairs if both handles on a segment are retracted.
    const out: [number, number, number][] = c.map(p => [p[0], p[1], p[2]])
    if (!prev[2]) {
      const prevOn = c[(pi + n - 3) % n]
      if (prevOn?.[2]) {
        out[prevIdx] = [Math.round(cur[0] + (prevOn[0] - cur[0]) * 0.25), Math.round(cur[1] + (prevOn[1] - cur[1]) * 0.25), 0]
      }
    }
    if (!next[2]) {
      const nextOn = c[(pi + 3) % n]
      if (nextOn?.[2]) {
        out[nextIdx] = [Math.round(cur[0] + (nextOn[0] - cur[0]) * 0.25), Math.round(cur[1] + (nextOn[1] - cur[1]) * 0.25), 0]
      }
    }
    // Slightly offset one handle by 1 unit if they remained accidentally collinear
    if (!prev[2] && !next[2]) out[nextIdx][1] += 1
    return out
  }

  // Corner -> Smooth:
  // If both adjacent points are already off-curve handles, align them collinearly along the bisector tangent.
  if (!prev[2] && !next[2]) {
    const vx = (cur[0] - prev[0]) + (next[0] - cur[0])
    const vy = (cur[1] - prev[1]) + (next[1] - cur[1])
    const vLen = Math.hypot(vx, vy) || 1
    const ux = vx / vLen, uy = vy / vLen
    const l1 = Math.max(12, Math.hypot(cur[0] - prev[0], cur[1] - prev[1]))
    const l2 = Math.max(12, Math.hypot(next[0] - cur[0], next[1] - cur[1]))
    const out: [number, number, number][] = c.map(p => [p[0], p[1], p[2]])
    out[prevIdx] = [Math.round(cur[0] - ux * l1), Math.round(cur[1] - uy * l1), 0]
    out[nextIdx] = [Math.round(cur[0] + ux * l2), Math.round(cur[1] + uy * l2), 0]
    return out
  }

  // If adjacent segments are straight lines, convert them to cubic curves with smooth collinear handles at `pi`.
  const vx = (cur[0] - prev[0]) + (next[0] - cur[0])
  const vy = (cur[1] - prev[1]) + (next[1] - cur[1])
  const vLen = Math.hypot(vx, vy) || 1
  const ux = vx / vLen, uy = vy / vLen
  const dPrev = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) / 3
  const dNext = Math.hypot(next[0] - cur[0], next[1] - cur[1]) / 3

  const out: [number, number, number][] = []
  for (let i = 0; i < n; i++) {
    const p = c[i]
    if (i === pi && prev[2] && (closed || pi > 0)) {
      // insert two off-curve handles for the incoming line segment prev -> cur
      out.push(
        [Math.round(prev[0] + (cur[0] - prev[0]) / 3), Math.round(prev[1] + (cur[1] - prev[1]) / 3), 0],
        [Math.round(cur[0] - ux * dPrev), Math.round(cur[1] - uy * dPrev), 0],
      )
    } else if (i === prevIdx && !prev[2]) {
      out.push([Math.round(cur[0] - ux * dPrev), Math.round(cur[1] - uy * dPrev), 0])
      continue
    }
    if (i === nextIdx && !next[2]) {
      out.push([Math.round(cur[0] + ux * dNext), Math.round(cur[1] + uy * dNext), 0])
      continue
    }
    out.push([p[0], p[1], p[2]])
    if (i === pi && next[2] && (closed || pi < n - 1)) {
      // insert two off-curve handles for the outgoing line segment cur -> next
      out.push(
        [Math.round(cur[0] + ux * dNext), Math.round(cur[1] + uy * dNext), 0],
        [Math.round(next[0] + (cur[0] - next[0]) / 3), Math.round(next[1] + (cur[1] - next[1]) / 3), 0],
      )
    }
  }
  return out
}

/** Bounding box of selected points (for >= 2 selected points). */
export function selectionBounds(contours: Pt3[][], sel: Set<string>) {
  if (sel.size < 2) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let count = 0
  for (const k of sel) {
    const [ci, pi] = k.split(':').map(Number)
    const p = contours[ci]?.[pi]
    if (!p) continue
    count++
    if (p[0] < minX) minX = p[0]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
  }
  if (count < 2 || (maxX - minX < 2 && maxY - minY < 2)) return null
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
}

export function scaleHandlePositions(b: NonNullable<ReturnType<typeof selectionBounds>>): Record<ScaleHandle, Pt> {
  return {
    nw: { x: b.minX, y: b.maxY },
    n:  { x: b.cx,   y: b.maxY },
    ne: { x: b.maxX, y: b.maxY },
    e:  { x: b.maxX, y: b.cy },
    se: { x: b.maxX, y: b.minY },
    s:  { x: b.cx,   y: b.minY },
    sw: { x: b.minX, y: b.minY },
    w:  { x: b.minX, y: b.cy },
  }
}

/** Hit-test the selection transform bounding box in screen pixels. */
export function hitTransformBox(
  b: NonNullable<ReturnType<typeof selectionBounds>>,
  sx: number,
  sy: number,
  X: (x: number) => number,
  Y: (y: number) => number,
): BoxHit | null {
  const handles = scaleHandlePositions(b)
  for (const [h, pt] of Object.entries(handles) as [ScaleHandle, Pt][]) {
    if (Math.hypot(sx - X(pt.x), sy - Y(pt.y)) <= 6.5) return { mode: 'scale', handle: h }
  }
  // rotating: outside the box only (inside, the corner widgets own the space), and from a good distance away
  const xs = [X(b.minX), X(b.maxX)], ys = [Y(b.minY), Y(b.maxY)]
  if (sx >= Math.min(...xs) && sx <= Math.max(...xs) && sy >= Math.min(...ys) && sy <= Math.max(...ys)) return null
  for (const h of ['nw', 'ne', 'se', 'sw'] as const) {
    const pt = handles[h]
    if (Math.hypot(sx - X(pt.x), sy - Y(pt.y)) <= 90) return { mode: 'rotate' }
  }
  return null
}

/** Compute 2D affine matrix [a, b, c, d, e, f] for scaling `bounds` by dragging `handle` to `pt`. */
export function scaleMatrix(
  b: NonNullable<ReturnType<typeof selectionBounds>>,
  handle: ScaleHandle,
  pt: Pt,
  uniform: boolean,
  fromCenter: boolean,
): [number, number, number, number, number, number] {
  const ox = fromCenter ? b.cx : handle.includes('w') ? b.maxX : handle.includes('e') ? b.minX : b.cx
  const oy = fromCenter ? b.cy : handle.includes('n') ? b.minY : handle.includes('s') ? b.maxY : b.cy
  const hPt = scaleHandlePositions(b)[handle]
  const dx0 = hPt.x - ox, dy0 = hPt.y - oy
  let sx = Math.abs(dx0) > 1e-3 ? (pt.x - ox) / dx0 : 1
  let sy = Math.abs(dy0) > 1e-3 ? (pt.y - oy) / dy0 : 1
  if (Math.abs(sx) < 0.02) sx = 0.02 * (sx < 0 ? -1 : 1)
  if (Math.abs(sy) < 0.02) sy = 0.02 * (sy < 0 ? -1 : 1)
  if (uniform) {
    if (handle === 'n' || handle === 's') sx = sy
    else if (handle === 'e' || handle === 'w') sy = sx
    else {
      const m = Math.max(Math.abs(sx), Math.abs(sy))
      sx = m * Math.sign(sx || 1)
      sy = m * Math.sign(sy || 1)
    }
  }
  return [sx, 0, 0, sy, ox * (1 - sx), oy * (1 - sy)]
}

/** Compute 2D affine matrix [a, b, c, d, e, f] for rotating around `(cx, cy)` by `angleRad`. */
export function rotateMatrix(cx: number, cy: number, angleRad: number): [number, number, number, number, number, number] {
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad)
  return [cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos]
}

/**
 * Illustrator / Glyphs-style Smart Guides & Snapping engine.
 * Evaluates point alignment, metrics/guides, symmetry, 0°/90° handle extrema,
 * line extensions, parallel segments, equal stem distances, and grid snap.
 */
export function computeSmartSnap(opts: {
  raw: Pt
  origin?: Pt | null
  isHandle?: boolean
  parentAnchor?: Pt | null
  oppositeHandle?: Pt | null
  neighborOnCurve?: Pt | null
  contours: Pt3[][]
  closed: boolean[]
  hidden: Set<number>
  exclude: Set<string>
  hMetrics: { y: number; label: string }[]
  vMetrics: { x: number; label: string }[]
  glyphWidth: number
  anchors: { x: number; y: number; cls: string }[]
  extraPoints?: { x: number; y: number; label?: string }[]
  gridStep?: number | null
  tol: number
}): { pt: Pt; guides: SmartGuide[] } {
  const {
    raw, origin, isHandle, parentAnchor, oppositeHandle, neighborOnCurve,
    contours, closed, hidden, exclude, hMetrics, vMetrics, glyphWidth,
    anchors, extraPoints = [], gridStep, tol,
  } = opts

  let x = raw.x, y = raw.y
  let snappedX = false, snappedY = false
  const guides: SmartGuide[] = []

  // Collect static reference points and straight segments
  const refPts: { x: number; y: number; on: boolean; label?: string }[] = []
  const lines: { p0: Pt; p1: Pt; dx: number; dy: number; len: number }[] = []

  contours.forEach((c, ci) => {
    if (hidden.has(ci)) return
    c.forEach((p, pi) => {
      if (!exclude.has(key(ci, pi))) refPts.push({ x: p[0], y: p[1], on: !!p[2] })
    })
    for (const seg of segmentsOf(c, closed[ci] ?? true)) {
      if (seg.kind === 'line' && !exclude.has(key(ci, seg.i0)) && !exclude.has(key(ci, seg.i1))) {
        const dx = seg.p1.x - seg.p0.x, dy = seg.p1.y - seg.p0.y
        const len = Math.hypot(dx, dy)
        if (len >= 12) lines.push({ p0: seg.p0, p1: seg.p1, dx, dy, len })
      }
    }
  })
  for (const a of anchors) refPts.push({ x: a.x, y: a.y, on: true, label: a.cls })
  for (const ep of extraPoints) refPts.push({ x: ep.x, y: ep.y, on: true, label: ep.label })

  // 1. Handle 0° / 90° extrema & collinear tangent snap
  if (isHandle && parentAnchor) {
    if (Math.abs(raw.x - parentAnchor.x) <= tol) {
      x = parentAnchor.x
      snappedX = true
      guides.push({ kind: 'line', x0: x, y0: parentAnchor.y, x1: x, y1: y, label: '90°', target: parentAnchor })
    }
    if (Math.abs(raw.y - parentAnchor.y) <= tol) {
      y = parentAnchor.y
      snappedY = true
      guides.push({ kind: 'line', x0: parentAnchor.x, y0: y, x1: x, y1: y, label: '0°', target: parentAnchor })
    }
    if (!snappedX && !snappedY && oppositeHandle) {
      const tx = parentAnchor.x - oppositeHandle.x, ty = parentAnchor.y - oppositeHandle.y
      const tLen = Math.hypot(tx, ty)
      if (tLen > 4) {
        const ux = tx / tLen, uy = ty / tLen
        const proj = (raw.x - parentAnchor.x) * ux + (raw.y - parentAnchor.y) * uy
        if (proj > 0) {
          const px = parentAnchor.x + ux * proj, py = parentAnchor.y + uy * proj
          if (Math.hypot(raw.x - px, raw.y - py) <= tol) {
            x = Math.round(px); y = Math.round(py)
            snappedX = true; snappedY = true
            guides.push({
              kind: 'line', x0: oppositeHandle.x, y0: oppositeHandle.y, x1: x, y1: y,
              label: 'tangent', dashed: true, target: parentAnchor,
            })
          }
        }
      }
    }
  }

  // 2. Line Extension Snap (snap onto infinite extension of straight segments)
  if (!snappedX && !snappedY) {
    let bestExt: { px: number; py: number; d: number; src: Pt } | null = null
    for (const ln of lines) {
      const ux = ln.dx / ln.len, uy = ln.dy / ln.len
      const t = (raw.x - ln.p0.x) * ux + (raw.y - ln.p0.y) * uy
      // Only snap on extensions outside the segment itself (or across endpoints)
      if (t >= 0 && t <= ln.len) continue
      const extDist = t < 0 ? -t : t - ln.len
      if (extDist > 420) continue
      const px = ln.p0.x + ux * t, py = ln.p0.y + uy * t
      const d = Math.hypot(raw.x - px, raw.y - py)
      if (d <= tol && (!bestExt || d < bestExt.d)) {
        bestExt = { px, py, d, src: t < 0 ? ln.p0 : ln.p1 }
      }
    }
    if (bestExt) {
      x = Math.round(bestExt.px)
      y = Math.round(bestExt.py)
      snappedX = true
      snappedY = true
      guides.push({
        kind: 'line', x0: bestExt.src.x, y0: bestExt.src.y, x1: x, y1: y,
        label: 'extension', dashed: true, target: bestExt.src,
      })
    }
  }

  // 3. Parallel Line Snap (when drawing/moving a segment from `origin`)
  if (!snappedX && !snappedY && origin) {
    const segLen = Math.hypot(raw.x - origin.x, raw.y - origin.y)
    if (segLen >= 16) {
      let bestPar: { px: number; py: number; d: number; ln: typeof lines[number] } | null = null
      for (const ln of lines) {
        if (Math.hypot(ln.p0.x - origin.x, ln.p0.y - origin.y) < 1 || Math.hypot(ln.p1.x - origin.x, ln.p1.y - origin.y) < 1) continue
        const ux = ln.dx / ln.len, uy = ln.dy / ln.len
        const dot = (raw.x - origin.x) * ux + (raw.y - origin.y) * uy
        if (Math.abs(dot) < 12) continue
        const px = origin.x + ux * dot, py = origin.y + uy * dot
        const d = Math.hypot(raw.x - px, raw.y - py)
        if (d <= tol && (!bestPar || d < bestPar.d)) {
          bestPar = { px, py, d, ln }
        }
      }
      if (bestPar) {
        x = Math.round(bestPar.px)
        y = Math.round(bestPar.py)
        snappedX = true
        snappedY = true
        guides.push({
          kind: 'parallel',
          a0: origin, a1: { x, y },
          b0: bestPar.ln.p0, b1: bestPar.ln.p1,
        })
      }
    }
  }

  // 4. Point-to-Point / X & Y Coordinate Alignment / Metrics / Symmetry Snap
  if (!snappedX) {
    let bestDx = tol
    let bestGuide: SmartGuide | null = null
    let bestVal = x

    for (const rp of refPts) {
      if (!rp.on && !isHandle) continue
      const d = Math.abs(raw.x - rp.x)
      if (d <= bestDx) {
        bestDx = d
        bestVal = rp.x
        bestGuide = { kind: 'line', x0: rp.x, y0: rp.y, x1: rp.x, y1: y, label: rp.label, target: rp }
      }
    }
    for (const vm of vMetrics) {
      const d = Math.abs(raw.x - vm.x)
      if (d <= bestDx) {
        bestDx = d
        bestVal = Math.round(vm.x)
        bestGuide = { kind: 'line', x0: bestVal, y0: -500, x1: bestVal, y1: 1500, label: vm.label, dashed: true }
      }
    }
    // Mirror / symmetry snap across glyph center (glyphWidth / 2)
    if (glyphWidth > 0) {
      for (const rp of refPts) {
        if (!rp.on || Math.abs(raw.y - rp.y) > tol * 2.5) continue
        const mirrorX = glyphWidth - rp.x
        if (Math.abs(mirrorX - rp.x) < 4) continue
        const d = Math.abs(raw.x - mirrorX)
        if (d <= bestDx) {
          bestDx = d
          bestVal = Math.round(mirrorX)
          bestGuide = { kind: 'line', x0: rp.x, y0: rp.y, x1: bestVal, y1: y, label: 'symmetry', dashed: true, target: rp }
        }
      }
    }
    if (bestGuide) {
      x = bestVal
      snappedX = true
      guides.push(bestGuide)
    }
  }

  if (!snappedY) {
    let bestDy = tol
    let bestGuide: SmartGuide | null = null
    let bestVal = y

    for (const rp of refPts) {
      if (!rp.on && !isHandle) continue
      const d = Math.abs(raw.y - rp.y)
      if (d <= bestDy) {
        bestDy = d
        bestVal = rp.y
        bestGuide = { kind: 'line', x0: rp.x, y0: rp.y, x1: x, y1: rp.y, label: rp.label, target: rp }
      }
    }
    for (const hm of hMetrics) {
      const d = Math.abs(raw.y - hm.y)
      if (d <= bestDy) {
        bestDy = d
        bestVal = Math.round(hm.y)
        bestGuide = { kind: 'line', x0: -500, y0: bestVal, x1: glyphWidth + 500, y1: bestVal, label: hm.label }
      }
    }
    if (bestGuide) {
      y = bestVal
      snappedY = true
      guides.push(bestGuide)
    }
  }

  // 5. Equal Stem / Distance Snap (`↔`)
  const refOrigin = neighborOnCurve ?? origin
  if (refOrigin && (!snappedX || !snappedY)) {
    // Collect horizontal & vertical segment lengths in the glyph
    const hSpans: { dist: number; p0: Pt; p1: Pt }[] = []
    const vSpans: { dist: number; p0: Pt; p1: Pt }[] = []
    for (const ln of lines) {
      if (Math.abs(ln.dy) <= 2 && ln.len >= 20) hSpans.push({ dist: Math.round(Math.abs(ln.dx)), p0: ln.p0, p1: ln.p1 })
      if (Math.abs(ln.dx) <= 2 && ln.len >= 20) vSpans.push({ dist: Math.round(Math.abs(ln.dy)), p0: ln.p0, p1: ln.p1 })
    }
    if (!snappedX && Math.abs(y - refOrigin.y) <= 24) {
      const curDist = Math.abs(raw.x - refOrigin.x)
      const sign = raw.x >= refOrigin.x ? 1 : -1
      for (const sp of hSpans) {
        if (Math.abs(curDist - sp.dist) <= tol) {
          x = Math.round(refOrigin.x + sign * sp.dist)
          snappedX = true
          guides.push({
            kind: 'distance', axis: 'x', dist: sp.dist,
            a0: refOrigin, a1: { x, y },
            b0: sp.p0, b1: sp.p1,
          })
          break
        }
      }
    }
    if (!snappedY && Math.abs(x - refOrigin.x) <= 24) {
      const curDist = Math.abs(raw.y - refOrigin.y)
      const sign = raw.y >= refOrigin.y ? 1 : -1
      for (const sp of vSpans) {
        if (Math.abs(curDist - sp.dist) <= tol) {
          y = Math.round(refOrigin.y + sign * sp.dist)
          snappedY = true
          guides.push({
            kind: 'distance', axis: 'y', dist: sp.dist,
            a0: refOrigin, a1: { x, y },
            b0: sp.p0, b1: sp.p1,
          })
          break
        }
      }
    }
  }

  // 6. Optional Grid Snap
  if (gridStep && gridStep > 0) {
    if (!snappedX) {
      const gx = Math.round(raw.x / gridStep) * gridStep
      if (Math.abs(raw.x - gx) <= tol) x = gx
    }
    if (!snappedY) {
      const gy = Math.round(raw.y / gridStep) * gridStep
      if (Math.abs(raw.y - gy) <= tol) y = gy
    }
  }

  return { pt: { x, y }, guides }
}


/** Apply a 6-element affine matrix [a,b,c,d,e,f] to (x, y), rounding to integer font units. */
export function applyMatrix(m: [number, number, number, number, number, number], x: number, y: number): [number, number] {
  return [
    Math.round(m[0] * x + m[2] * y + m[4]),
    Math.round(m[1] * x + m[3] * y + m[5]),
  ]
}

/** Extract key extrema/bounding points from a cached SVG Path2D or RawOutline for shadow/reference snapping. */
export function bboxPointsOf(width: number, lsb: number, rsb: number, ascent: number, descent: number, labelPrefix: string): { x: number; y: number; label: string }[] {
  const xMin = lsb
  const xMax = width - rsb
  const xMid = Math.round((xMin + xMax) / 2)
  return [
    { x: xMin, y: 0, label: `${labelPrefix} L` },
    { x: xMax, y: 0, label: `${labelPrefix} R` },
    { x: xMid, y: Math.round(ascent / 2), label: `${labelPrefix} center` },
    { x: width, y: 0, label: `${labelPrefix} adv` },
    { x: xMid, y: -descent, label: `${labelPrefix}` },
  ]
}

/** Draw active Smart Guides (alignment lines, parallel markers, equal stem distance arrows) on canvas. */
export function drawSmartGuides(
  ctx: CanvasRenderingContext2D,
  guides: SmartGuide[],
  X: (x: number) => number,
  Y: (y: number) => number,
  color: string,
  monoFont: string,
) {
  if (!guides.length) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1
  ctx.font = '10px ' + monoFont
  ctx.textAlign = 'left'

  const drawCross = (px: number, py: number) => {
    ctx.beginPath()
    ctx.moveTo(px - 3.5, py - 3.5); ctx.lineTo(px + 3.5, py + 3.5)
    ctx.moveTo(px + 3.5, py - 3.5); ctx.lineTo(px - 3.5, py + 3.5)
    ctx.stroke()
  }

  for (const g of guides) {
    if (g.kind === 'line') {
      const x0 = X(g.x0), y0 = Y(g.y0), x1 = X(g.x1), y1 = Y(g.y1)
      if (g.dashed) ctx.setLineDash([3, 3])
      else ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      ctx.setLineDash([])
      if (g.target) drawCross(X(g.target.x), Y(g.target.y))
      if (g.label) {
        const mx = (x0 + x1) / 2 + 5, my = (y0 + y1) / 2 - 4
        ctx.fillText(g.label, mx, my)
      }
    } else if (g.kind === 'parallel') {
      ctx.setLineDash([4, 3])
      for (const [p0, p1] of [[g.a0, g.a1], [g.b0, g.b1]] as const) {
        const x0 = X(p0.x), y0 = Y(p0.y), x1 = X(p1.x), y1 = Y(p1.y)
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2
        ctx.setLineDash([])
        ctx.fillText('//', mx + 4, my - 4)
        ctx.setLineDash([4, 3])
      }
      ctx.setLineDash([])
    } else if (g.kind === 'distance') {
      ctx.setLineDash([])
      for (const [p0, p1] of [[g.a0, g.a1], [g.b0, g.b1]] as const) {
        const x0 = X(p0.x), y0 = Y(p0.y), x1 = X(p1.x), y1 = Y(p1.y)
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
        drawCross(x0, y0)
        drawCross(x1, y1)
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2
        ctx.textAlign = 'center'
        ctx.fillText(`↔ ${g.dist}`, mx, my - 5)
        ctx.textAlign = 'left'
      }
    }
  }
  ctx.restore()
}

/** Draw the selection transform bounding box (8 scale handles + center pivot). */
export function drawTransformBox(
  ctx: CanvasRenderingContext2D,
  b: NonNullable<ReturnType<typeof selectionBounds>>,
  X: (x: number) => number,
  Y: (y: number) => number,
  strokeColor: string,
  fillBg: string,
) {
  ctx.save()
  const x0 = Math.round(X(b.minX)) + .5, y0 = Math.round(Y(b.maxY)) + .5
  const x1 = Math.round(X(b.maxX)) + .5, y1 = Math.round(Y(b.minY)) + .5
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0)
  ctx.setLineDash([])

  // Center pivot crosshair
  const cx = X(b.cx), cy = Y(b.cy)
  ctx.beginPath()
  ctx.arc(cx, cy, 3, 0, Math.PI * 2)
  ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy)
  ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5)
  ctx.stroke()

  // 8 scale handles
  const handles = scaleHandlePositions(b)
  ctx.fillStyle = fillBg
  for (const pt of Object.values(handles)) {
    const hx = Math.round(X(pt.x)) - 3, hy = Math.round(Y(pt.y)) - 3
    ctx.fillRect(hx, hy, 6, 6)
    ctx.strokeRect(hx + .5, hy + .5, 5, 5)
  }
  ctx.restore()
}
