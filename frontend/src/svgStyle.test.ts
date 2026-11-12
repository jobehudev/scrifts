import test from 'node:test'
import assert from 'node:assert/strict'
import { nextGroup, parseSvgTag, svgGroups, svgTag } from './svgStyle.ts'

test('a tag round-trips', () => {
  const s = { fill: '#ff0000', stroke: null, sw: 1.5, op: 0.5 }
  assert.deepEqual(parseSvgTag(svgTag(4, s)), { group: 4, ...s })
  assert.equal(parseSvgTag('~stroke 80 round round'), null)
})

test('contours of one group are one shape; drawn ones stand alone', () => {
  const g = svgGroups([
    { name: svgTag(0, { fill: '#111111', stroke: null, sw: 1, op: 1 }), closed: true },
    { name: svgTag(0, { fill: '#111111', stroke: null, sw: 1, op: 1 }), closed: true },
    { name: '', closed: true },
    { name: '', closed: false },
  ])
  assert.deepEqual(g.map(x => x.contours), [[0, 1], [2], [3]])
  assert.equal(g[1].fill, '#000000')
  assert.equal(g[2].fill, null)
  assert.equal(g[2].stroke, '#000000')
})

test('the next group number follows the highest', () => {
  assert.equal(nextGroup([{ name: '' }, { name: svgTag(6, { fill: null, stroke: null, sw: 1, op: 1 }) }]), 7)
})
