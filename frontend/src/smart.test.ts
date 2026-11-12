// Run: node --test src/smart.test.ts   (Node >= 23 strips the types)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { segmentsOf, subdivideContourSegment, togglePointSmooth, evalQuad, type Segment } from './smart.ts'

type P = [number, number, number]
type Pt = { x: number; y: number }

const cubicAt = (p: Pt[], t: number): Pt => {
  const u = 1 - t
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return { x: k.reduce((s, w, i) => s + w * p[i].x, 0), y: k.reduce((s, w, i) => s + w * p[i].y, 0) }
}

/** Sample a contour (cubic or quadratic) as points along its outline. */
function sample(c: P[], quadratic: boolean, n = 40): Pt[] {
  const out: Pt[] = []
  for (const s of segmentsOf(c, true, quadratic)) for (let i = 0; i <= n; i++) {
    const t = i / n
    if (s.kind === 'line') out.push({ x: s.p0.x + (s.p1.x - s.p0.x) * t, y: s.p0.y + (s.p1.y - s.p0.y) * t })
    else if (s.kind === 'quad') out.push(evalQuad(s.p0, s.p1, s.p2, t))
    else out.push(cubicAt([s.p0, s.p1, s.p2, s.p3], t))
  }
  return out
}

/** Every sample of `b` lies within `tol` of the outline `a` (dense sampling of a). */
function assertSameOutline(a: P[], b: P[], quadratic: boolean, tol = 1.5) {
  const dense = sample(a, quadratic, 400)
  for (const p of sample(b, quadratic)) {
    const d = Math.min(...dense.map(q => Math.hypot(p.x - q.x, p.y - q.y)))
    assert.ok(d <= tol, `point (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) is ${d.toFixed(2)} off the outline`)
  }
}

// cubic "D"-ish shape: line on the left, curve on the right
const cubicD: P[] = [[0, 0, 1], [0, 700, 1], [400, 700, 0], [600, 500, 0], [600, 350, 1], [600, 200, 0], [400, 0, 0]]

test('cubic contour parses into lines and cubics', () => {
  const segs = segmentsOf(cubicD, true)
  assert.deepEqual(segs.map(s => s.kind), ['line', 'cubic', 'cubic'])
})

test('subdividing a cubic keeps the outline', () => {
  const seg = segmentsOf(cubicD, true).find(s => s.kind === 'cubic')!
  const out = subdivideContourSegment(cubicD, seg, 0.37)
  assert.equal(out.length, cubicD.length + 3)
  assertSameOutline(cubicD, out, false)
})

test('subdividing a line inserts one on-curve point on it', () => {
  const seg = segmentsOf(cubicD, true)[0]
  const out = subdivideContourSegment(cubicD, seg, 0.5)
  assert.equal(out.length, cubicD.length + 1)
  assert.deepEqual(out[1], [0, 350, 1])
})

// TrueType circle-ish: on, off, off, on... with implied midpoints between consecutive offs
const quadO: P[] = [[300, 0, 1], [500, 0, 0], [600, 200, 0], [600, 400, 1], [600, 700, 0], [300, 700, 1], [0, 700, 0], [0, 0, 0]]

test('quadratic contour: one curve per off-curve point, implied ends at midpoints', () => {
  const segs = segmentsOf(quadO, true, true)
  assert.deepEqual(segs.map(s => s.kind), ['quad', 'quad', 'quad', 'quad', 'quad'])
  const second = segs[1] as Extract<Segment, { kind: 'quad' }>
  assert.deepEqual(second.p0, { x: 550, y: 100 })
  assert.ok(second.startImplied && !second.endImplied)
})

test('the cubic parser would misread the same quadratic contour', () => {
  // two consecutive offs in a quadratic contour are two curves, not one cubic
  assert.notDeepEqual(segmentsOf(quadO, true).map(s => s.kind), segmentsOf(quadO, true, true).map(s => s.kind))
})

for (const k of [0, 1, 3]) test(`subdividing quadratic segment ${k} keeps the outline`, () => {
  const seg = segmentsOf(quadO, true, true)[k]
  const out = subdivideContourSegment(quadO, seg, 0.4)
  assertSameOutline(quadO, out, true)
})

test('corner -> smooth makes the handles collinear with the point', () => {
  const c: P[] = [[0, 0, 1], [100, 300, 0], [200, 400, 0], [400, 400, 1], [500, 500, 0], [700, 300, 0], [700, 0, 1]]
  const out = togglePointSmooth(c, true, 3)!
  const [a, p, b] = [out[2], out[3], out[4]]
  const cross = (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])
  const len = Math.hypot(p[0] - a[0], p[1] - a[1]) * Math.hypot(b[0] - p[0], b[1] - p[1])
  assert.ok(Math.abs(cross / len) < 0.02, `handles not collinear (sin = ${cross / len})`)
})

test('toggle ignores off-curve points', () => {
  assert.equal(togglePointSmooth(cubicD, true, 2), null)
})
