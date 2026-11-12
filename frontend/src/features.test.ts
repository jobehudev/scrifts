import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generate, featureTags } from './features.ts'

const names = ['f', 'i', 'l', 'f_i', 'f_f', 'f_f_i', 'x_y', 'f_i.alt', 'a', 'a.sc', 'b.sc', 'g', 'g.ss01', 'a.ss02']

test('ligatures: only from existing parts, longest first, with a header', () => {
  const out = generate('liga', names, '')
  assert.match(out, /^languagesystem DFLT dflt;/)
  assert.ok(out.indexOf('sub f f i by f_f_i;') < out.indexOf('sub f f by f_f;'))
  assert.ok(!out.includes('x_y') && !out.includes('f_i.alt'))
})

test('glyphs the code already uses are skipped', () => {
  const code = 'languagesystem DFLT dflt;\nfeature liga {\n  sub \\f \\i by \\f_i;\n} liga;'
  const out = generate('liga', names, code)
  assert.ok(!out.includes('by f_i;') && out.includes('by f_f;') && !out.includes('languagesystem'))
})

test('small caps need their base glyph', () => {
  assert.equal(generate('smcp', names, 'languagesystem DFLT dflt;'), 'feature smcp {\n  sub a by a.sc;\n} smcp;')
})

test('stylistic sets one feature per set', () => {
  const out = generate('ss', names, 'languagesystem DFLT dflt;')
  assert.equal(out, 'feature ss01 {\n  sub g by g.ss01;\n} ss01;\n\nfeature ss02 {\n  sub a by a.ss02;\n} ss02;')
  assert.equal(generate('ss', ['g'], ''), '')
})

test('feature tags from code', () => {
  assert.deepEqual(featureTags('feature liga {\n} liga;\n  feature ccmp {', ['kern']), ['ccmp', 'kern', 'liga'])
})

const alts = ['a', 'A', 'one', 'a.sc', 'a.salt', 'one.onum', 'one.tnum', 'g', 'g.ss01', 'x.case', 'f', 'i', 'f_i']

test('suffix features: one block per feature, base glyph required', () => {
  const out = generate('alt', alts, 'languagesystem DFLT dflt;')
  assert.equal(out, 'feature onum {\n  sub one by one.onum;\n} onum;\n\nfeature tnum {\n  sub one by one.tnum;\n} tnum;\n\nfeature salt {\n  sub a by a.salt;\n} salt;')
  assert.ok(!out.includes('x.case'))  // no x glyph to swap
})

test('c2sc maps the capital to the small cap, independent of smcp', () => {
  const code = generate('smcp', alts, '')
  assert.ok(code.includes('sub a by a.sc;'))
  assert.equal(generate('c2sc', alts, code), 'feature c2sc {\n  sub A by a.sc;\n} c2sc;')
})

test('aalt lists the alternate features the code defines, once', () => {
  const code = 'languagesystem DFLT dflt;\nfeature salt {\n  sub a by a.salt;\n} salt;\nfeature liga {\n  sub f i by f_i;\n} liga;\nfeature ss01 {\n  sub g by g.ss01;\n} ss01;'
  assert.equal(generate('aalt', alts, code), 'feature aalt {\n  feature salt;\n  feature ss01;\n} aalt;')
  assert.equal(generate('aalt', alts, code + '\nfeature aalt {\n  feature salt;\n} aalt;'), '')
  assert.equal(generate('aalt', alts, 'feature liga {\n} liga;'), '')
})

test('all: every generator, one header, aalt sees the new features, a second run adds nothing', () => {
  const out = generate('all', alts, '')
  assert.equal(out.match(/languagesystem DFLT/g)?.length, 1)
  for (const tag of ['liga', 'smcp', 'c2sc', 'ss01', 'onum', 'tnum', 'salt']) assert.ok(out.includes(`} ${tag};`), tag)
  assert.match(out, /feature aalt \{\n  feature smcp;\n  feature c2sc;\n  feature salt;\n  feature onum;\n  feature tnum;\n  feature ss01;\n\} aalt;$/)
  assert.equal(generate('all', alts, out), '')
})
