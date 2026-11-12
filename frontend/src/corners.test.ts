import test from 'node:test'
import assert from 'node:assert/strict'
import { cornerAt, radiusFromDrag, roundPoints, widgetPos, type P } from './corners.ts'

const SQ: P[] = [[0, 0, 1], [0, 100, 1], [100, 100, 1], [100, 0, 1]]

test('a square corner becomes a quarter circle, the same as the backend makes', () => {
  assert.deepEqual(roundPoints(SQ, true, new Set([2]), 20).slice(2, 6), [[80, 100, 1], [91, 100, 0], [100, 91, 0], [100, 80, 1]])
})
test('chamfer and inverted', () => {
  assert.deepEqual(roundPoints(SQ, true, new Set([2]), 20, 'chamfer').slice(2, 4), [[80, 100, 1], [100, 80, 1]])
  assert.deepEqual(roundPoints(SQ, true, new Set([2]), 20, 'inverted').slice(2, 6), [[80, 100, 1], [80, 89, 0], [89, 80, 0], [100, 80, 1]])
})
test('corners next to curves are not corners', () => {
  assert.equal(cornerAt([[0, 0, 1], [10, 50, 0], [50, 90, 0], [100, 100, 1], [100, 0, 1]], true, 0), null)
})
test('the widget sits where the drag that made it ends', () => {
  const c = cornerAt(SQ, true, 2)!
  const [wx, wy] = widgetPos(SQ, c, 2, 20, 3)
  assert.ok(Math.abs(radiusFromDrag(SQ, c, 2, wx, wy, 3) - 20) < 1e-6)
  assert.equal(radiusFromDrag(SQ, c, 2, 99, 99, 3), 0)  // dragged back to the corner: no rounding
})
