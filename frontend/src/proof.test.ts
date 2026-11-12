// Run: node --test src/proof.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contrast, hexToHsv, hsvToHex, grade, underlineBand, strikeoutBand, luminance, parseHex, readSwatches, withAlpha } from './proof.ts'

test('parseHex: 3 and 6 digit, rejects junk', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255])
  assert.deepEqual(parseHex('#1b1a17'), [27, 26, 23])
  assert.equal(parseHex('red'), null)
  assert.equal(parseHex('#12'), null)
})

test('luminance: black 0, white 1', () => {
  assert.equal(luminance('#000000'), 0)
  assert.ok(Math.abs(luminance('#ffffff') - 1) < 1e-9)
})

test('contrast: WCAG reference values', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9)
  assert.ok(Math.abs(contrast('#ffffff', '#000000') - 21) < 1e-9)  // order does not matter
  assert.equal(contrast('#777', '#777'), 1)
  // #767676 on white is the well-known smallest grey that passes AA (4.54:1)
  assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01)
})

test('grade thresholds', () => {
  assert.equal(grade(21), 'AAA')
  assert.equal(grade(7), 'AAA')
  assert.equal(grade(6.99), 'AA')
  assert.equal(grade(4.5), 'AA')
  assert.equal(grade(4.49), 'AA large')
  assert.equal(grade(3), 'AA large')
  assert.equal(grade(2.99), 'Fail')
})

test('withAlpha', () => assert.equal(withAlpha('#ff8000', 0.5), 'rgba(255,128,0,0.5)'))

test('readSwatches drops malformed entries', () => {
  assert.deepEqual(readSwatches(null), [])
  assert.deepEqual(readSwatches('nope'), [])
  assert.deepEqual(readSwatches('[{"fg":"#000000","bg":"#fff"},{"fg":"x","bg":"#fff"},null]'), [{ fg: '#000000', bg: '#fff' }])
})

test('underline: FontForge upos is the bottom edge, so the top is upos + width', () => {
  assert.deepEqual(underlineBand(-120, 60), { top: -60, height: 60 })
})

test('strikeout: position is the top of the stroke', () => {
  assert.deepEqual(strikeoutBand(280, 55), { top: 280, height: 55 })
})

test('hsv round trip', () => {
  assert.deepEqual(hexToHsv('#ff0000'), [0, 1, 1])
  assert.equal(hsvToHex(120, 1, 1), '#00ff00')
  assert.equal(hsvToHex(0, 0, 1), '#ffffff')
  for (const c of ['#1b1a17', '#f3ecdc', '#767676', '#3366cc']) assert.equal(hsvToHex(...hexToHsv(c)), c)
})
