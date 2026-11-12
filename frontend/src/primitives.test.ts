// Run: node --test src/primitives.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRIMITIVES, area, defaults, oval, rect } from './primitives.ts'

const bounds = (cs: { points: number[][] }[]) => {
  const xs = cs.flatMap(c => c.points.map(p => p[0])), ys = cs.flatMap(c => c.points.map(p => p[1]))
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
const P = { x: 80, y: 0, width: 400, height: 500, thickness: 70 }

test('a stem is a clockwise bar of the asked size at the asked place', () => {
  const [c] = PRIMITIVES.find(p => p.id === 'stem')!.make(P)
  assert.deepEqual(bounds([c]), [80, 0, 150, 500])
  assert.ok(area(c) < 0, 'clockwise')
  assert.equal(Math.abs(area(c)), 70 * 500)
})

test('an oval is four curves that touch its box and run clockwise', () => {
  const c = oval(300, 250, 200, 250)
  assert.equal(c.points.length, 12)
  assert.equal(c.points.filter(p => p[2]).length, 4)
  assert.deepEqual(bounds([c]).map(Math.round), [100, 0, 500, 500])
  assert.ok(area(c) < 0)
})

test('a ring is an outer shape and a counter running the other way, thickness apart', () => {
  const [outer, inner] = PRIMITIVES.find(p => p.id === 'ring')!.make(P)
  assert.ok(area(outer) < 0 && area(inner) > 0, 'the hole runs counter-clockwise')
  const [x0, , x1] = bounds([outer]), [ix0, , ix1] = bounds([inner])
  assert.equal(Math.round(ix0 - x0), 70)
  assert.equal(Math.round(x1 - ix1), 70)
})

test('a ring too thick for its size still has a hole', () => {
  const [, inner] = PRIMITIVES.find(p => p.id === 'ring')!.make({ ...P, width: 100, height: 100, thickness: 400 })
  const [x0, , x1] = bounds([inner])
  assert.ok(x1 > x0, 'the counter is not squeezed to nothing or turned inside out')
})

test('every primitive makes closed, clockwise outer shapes inside the size given', () => {
  for (const p of PRIMITIVES) {
    const cs = p.make(P)
    assert.ok(cs.length >= 1 && cs.every(c => c.closed && c.points.length >= 3), p.id)
    assert.ok(area(cs[0]) < 0, `${p.id} outer runs clockwise`)
    const [x0, y0, x1, y1] = bounds(cs)
    assert.ok(x0 >= 80 - 1 && y0 >= -1 && x1 <= 80 + 400 + 1 && y1 <= 500 + 1, `${p.id} stays in its box`)
  }
})

test('the sizes a primitive says it uses are the ones it reads', () => {
  const stem = PRIMITIVES.find(p => p.id === 'stem')!
  const a = stem.make(P), b = stem.make({ ...P, width: 999 })
  assert.deepEqual(a, b)  // width is not used by a stem
  assert.ok(stem.uses.includes('thickness') && !stem.uses.includes('width'))
})

test('starting sizes come from the font, with fallbacks', () => {
  assert.deepEqual(defaults(1000, 500, 700), { x: 80, y: 0, width: 400, height: 500, thickness: 85, xh: 500, cap: 700 })
  const d = defaults(2048, null, null)
  assert.equal(d.xh, 1024)
  assert.equal(d.cap, 1434)
  assert.deepEqual(rect(0, 0, 1, 1).points.length, 4)
})
