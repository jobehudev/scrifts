// Run: node --test src/commandPalette.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matches } from './paletteMatch.ts'

const item = (label: string, group = 'File', keywords?: string) => ({ id: label, group, label, keywords, run: () => {} })

test('every word has to be found, in any order and case', () => {
  assert.ok(matches(item('Generate Fonts…'), 'gen font'))
  assert.ok(matches(item('Generate Fonts…'), 'FONTS generate'))
  assert.ok(!matches(item('Generate Fonts…'), 'generate kerning'))
})

test('the group and the extra keywords count too, and an empty search finds everything', () => {
  assert.ok(matches(item('Fit Glyph', 'View'), 'view fit'))
  assert.ok(matches(item('Trace Picture into Glyph…', 'File', 'image bitmap potrace'), 'bitmap'))
  assert.ok(matches(item('Save'), ''))
})
