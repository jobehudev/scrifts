// Run: node --test src/numeric.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clean, scrubbed, stepOf } from './numeric.ts'

const none = { shiftKey: false, altKey: false }

test('Shift is ten times, Alt a tenth', () => {
  assert.equal(stepOf(none), 1)
  assert.equal(stepOf({ shiftKey: true, altKey: false }), 10)
  assert.equal(stepOf({ shiftKey: false, altKey: true }), 0.1)
  assert.equal(stepOf({ shiftKey: true, altKey: false }, 5), 50)
})

test('floating point noise is cleaned off', () => {
  assert.equal(clean(0.1 + 0.2), 0.3)
  assert.equal(clean(512.14159), 512.14)
})

test('dragging a number', () => {
  assert.equal(scrubbed(100, 25, none), 125)
  assert.equal(scrubbed(100, -40, none), 60)
  assert.equal(scrubbed(100, 25, { shiftKey: true, altKey: false }), 350)
  assert.equal(scrubbed(100, 25, { shiftKey: false, altKey: true }), 102.5)
  assert.equal(scrubbed(100, 0, none), 100)
})
