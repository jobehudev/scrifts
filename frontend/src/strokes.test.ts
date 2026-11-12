// Run: node --test src/strokes.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStroke, strokeMark } from './strokes.ts'

test('a stroke mark round-trips and matches the backend format', () => {
  assert.equal(strokeMark({ width: 80, cap: 'round', join: 'round' }), '~stroke 80 round round')
  assert.deepEqual(parseStroke('~stroke 62.5 butt miter'), { width: 62.5, cap: 'butt', join: 'miter' })
  assert.deepEqual(parseStroke('~stroke 40'), { width: 40, cap: 'round', join: 'round' })
})

test('ordinary names and bad marks are not strokes', () => {
  for (const n of ['', 'bowl', 'Shape 1', '~stroke', '~stroke x', '~stroke 0', '~stroke -5', '~stroke 10 pointy', '~stroke 10 round zigzag'])
    assert.equal(parseStroke(n), null, n)
  assert.equal(parseStroke(undefined), null)
})
