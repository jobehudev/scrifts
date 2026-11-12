import assert from 'node:assert/strict'
import { test } from 'node:test'

import { proofPages } from './proofSheet.ts'

const font = { path: 'x.sfd', fontname: 'T-Regular', familyname: 'T & <Co>', em: 1000, ascent: 800, descent: 200, xheight: 500, capheight: 700,
  quadratic: false, axes: [], instances: [], glyphs: Array.from({ length: 400 }, (_, i) => ({ name: 'g' + i, unicode: 65 + i, width: 600 })) }
const outline = (name: string) => ({ name, width: 600, d: 'M0 0L600 0L600 700Z', refs: [{ ref: 'x', t: [1, 0, 0, 1, 10, 0], d: { d: 'M0 0L1 1Z' } }] })
const outlines = new Map(font.glyphs.slice(0, 399).map(g => [g.name, outline(g.name)]))  // the last glyph is empty

test('the waterfall, then every drawn glyph, over as many pages as it takes', () => {
  const shaped = Array.from({ length: 30 }, (_, i) => ({ name: 'g' + i, ax: 600, dx: 0, dy: 0 }))
  const pages = proofPages(font, shaped, outlines, 'text', 'today')
  assert.ok(pages.length >= 3, `${pages.length} pages`)
  assert.ok(pages.every(p => p.startsWith('<svg') && p.endsWith('</svg>')))
  assert.match(pages[0], /72 pt/)
  assert.match(pages[0], /T &amp; &lt;Co&gt;/)  // names are escaped
  const all = pages.join('')
  assert.match(all, /399 glyphs/)  // the empty one is left out
  assert.match(all, /matrix\(1 0 0 1 10 0\)/)  // components are drawn in place
  // 72 pt: 0.072 pt per unit, 43.2 pt per letter, 511 pt of line: 11 letters fit, the 12th is cut
  const first = pages[0].split('48 pt')[0]
  assert.equal(first.match(/scale\(0\.072 /g)?.length, 11)
})
