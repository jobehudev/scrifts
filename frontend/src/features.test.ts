import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generate, featureTags, languageSystems, addLanguageSystem, removeLanguageSystem, blockOf } from './features.ts'

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

test('language systems: read, add after the last one, remove, no duplicates', () => {
  const code = 'languagesystem DFLT dflt;\nlanguagesystem latn dflt;\n\nfeature liga {\n  sub f i by f_i;\n} liga;\n'
  assert.deepEqual(languageSystems(code), [{ script: 'DFLT', lang: 'dflt' }, { script: 'latn', lang: 'dflt' }])
  const more = addLanguageSystem(addLanguageSystem(code, { script: 'arab', lang: 'dflt' }), { script: 'latn', lang: 'TRK' })
  assert.deepEqual(languageSystems(more).map(l => `${l.script}{${l.lang}}`), ['DFLT{dflt}', 'latn{dflt}', 'arab{dflt}', 'latn{TRK}'])
  assert.ok(more.includes('feature liga {'), 'the features are left alone')
  assert.equal(addLanguageSystem(more, { script: 'arab', lang: 'dflt' }), more)
  const less = removeLanguageSystem(more, { script: 'arab', lang: 'dflt' })
  assert.deepEqual(languageSystems(less).map(l => l.script), ['DFLT', 'latn', 'latn'])
  assert.ok(less.includes('feature liga {'))
})

test('adding a script to code with none puts DFLT dflt first', () => {
  const out = addLanguageSystem('feature liga {\n  sub f i by f_i;\n} liga;\n', { script: 'hani', lang: 'dflt' })
  assert.deepEqual(languageSystems(out).map(l => l.script), ['DFLT', 'hani'])
})

test('code as FontForge writes it back (swaps in named lookups) counts as already used', () => {
  const compiled = 'languagesystem DFLT dflt;\n\nlookup ligaLookup0 {\n  lookupflag 0;\n    sub \\f \\i  by \\f_i;\n} ligaLookup0;\n\nfeature liga {\n  script latn;\n     language dflt ;\n      lookup ligaLookup0;\n  script DFLT;\n     language dflt ;\n      lookup ligaLookup0;\n\n} liga;\n'
  assert.match(blockOf(compiled, 'liga'), /sub \\f \\i\s+by \\f_i;/)
  assert.equal(generate('liga', ['f', 'i', 'f_i'], compiled), '', 'nothing left to add, so no duplicate rule')
  assert.match(generate('liga', ['f', 'i', 'l', 'f_i', 'f_l'], compiled), /sub f l by f_l;/)
})
