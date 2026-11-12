import test from 'node:test'
import assert from 'node:assert/strict'
import { align, diffGlyph, startShift, type GlyphPts, type P } from './compare.ts'

const sq = (x: number, w: number): P[] => [[x, 0, 1], [x, 100, 1], [x + w, 100, 1], [x + w, 0, 1]]
const g = (contours: P[][], refs: string[] = []): GlyphPts => ({ width: 500, contours, closed: contours.map(() => true), refs })

test('matching masters are compatible, with the moved points marked', () => {
  const d = diffGlyph(g([sq(0, 40)]), g([sq(0, 120)]))
  assert.equal(d.compatible, true)
  assert.deepEqual(d.contours[0].rows.map(r => r.status), ['same', 'same', 'moved', 'moved'])
})

test('an extra point shows as only in one master', () => {
  const b = sq(0, 40); b.splice(2, 0, [20, 100, 1])
  const d = diffGlyph(g([sq(0, 40)]), g([b]))
  assert.equal(d.compatible, false)
  assert.deepEqual(d.contours[0].rows.map(r => r.status), ['same', 'same', 'only-b', 'same', 'same'])
  assert.match(d.problems[0], /4 points here, 5 there/)
})

test('the same points from another start point are named as such', () => {
  const a = sq(0, 40), b = [...a.slice(1), a[0]]  // a square: the pattern repeats, only the geometry shows the start point moved
  assert.match(diffGlyph(g([a]), g([b])).problems[0], /start/)
  const c: P[] = [[0, 0, 1], [10, 20, 0], [30, 20, 0], [40, 0, 1]]
  const rot = [...c.slice(1), c[0]]
  assert.equal(startShift(c.map(p => p[2]), rot.map(p => p[2])), 3)
  assert.match(diffGlyph(g([c]), g([rot])).problems[0], /start/)
})

test('direction, contour count and components', () => {
  const d = diffGlyph(g([sq(0, 40)], ['acute']), { ...g([sq(0, 40).reverse(), sq(200, 40)]), refs: [] })
  assert.ok(d.problems.some(p => /opposite directions/.test(p)))
  assert.ok(d.problems.some(p => /1 contours here, 2 there/.test(p)))
  assert.ok(d.problems.some(p => /components differ/.test(p)))
})

test('align pairs equal patterns one to one', () => {
  const c: P[] = [[0, 0, 1], [10, 20, 0], [30, 20, 0], [40, 0, 1]]
  assert.deepEqual(align(c, c).map(p => p[0]), [0, 1, 2, 3])
})

test('an unmatched point right beside its neighbour is called a stray', () => {
  const a: P[] = [[0, 0, 1], [0, 100, 1], [40, 100, 1], [40, 0.1, 1], [40, 0, 1]]
  const b: P[] = [[0, 0, 1], [0, 100, 1], [60, 100, 1], [60, 0, 1]]
  const d = diffGlyph(g([a]), g([b]))
  assert.ok(d.contours[0].rows.some(r => r.status === 'only-a' && r.stray))
  assert.ok(d.problems.some(p => /stray/.test(p)))
})

import { diffAll } from './compare.ts'
test('the whole font: problems first, missing glyphs named, categories counted', () => {
  const A = { I: g([sq(0, 40)]), x: g([sq(0, 40)]), only: g([sq(0, 40)]) }
  const b = sq(0, 40); b.splice(2, 0, [20, 100, 1])
  const B = { I: g([sq(0, 120)]), x: g([b]) }
  const r = diffAll(A, B)
  assert.deepEqual(r.map(x => [x.name, x.ok]), [['only', false], ['x', false], ['I', true]])
  assert.equal(r[0].missingIn, 'b')
  assert.deepEqual(r[1].categories, ['points'])
})

import { insertIndex } from './compare.ts'
test('an extra point goes back in after the matched point above it', () => {
  const a = sq(0, 40); a.splice(2, 0, [20, 100, 1])
  const r = diffGlyph(g([a]), g([sq(0, 40)])).contours[0].rows
  const k = r.findIndex(x => x.status === 'only-a')
  assert.equal(insertIndex(r, k, 'b'), 2)
})
