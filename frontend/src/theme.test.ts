// Run: node --test src/theme.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contrast, parseHex } from './proof.ts'
import { CUSTOM_PRESETS, deriveTokens, inkTokens, mix, readableOn } from './theme.ts'

test('mix', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080')
  assert.equal(mix('#102030', '#102030', 0.7), '#102030')
})

test('readableOn picks the side with more contrast', () => {
  assert.equal(readableOn('#101010'), '#ffffff')
  assert.equal(readableOn('#f0f0f0'), '#000000')
})

test('every preset and the extremes keep text, muted text and accent readable', () => {
  const cases = [...CUSTOM_PRESETS.map(p => p.theme), { bg: '#000000', accent: '#000000' }, { bg: '#ffffff', accent: '#ffffff' },
    { bg: '#808080', accent: '#808080' }, { bg: '#ff00ff', accent: '#00ff00' }]
  for (const t of cases) {
    const { vars } = deriveTokens(t)
    const best = Math.max(contrast('#000000', t.bg), contrast('#ffffff', t.bg))  // a mid grey can't do better than ~5:1
    assert.ok(contrast(vars['--foreground'], vars['--background']) >= Math.min(7, best - 0.05), `text on ${t.bg}`)
    assert.ok(contrast(vars['--muted-foreground'], vars['--background']) >= Math.min(4.5, best - 0.05), `muted on ${t.bg}`)
    assert.ok(contrast(vars['--primary'], vars['--background']) >= 3, `accent ${t.accent} on ${t.bg}`)
    assert.ok(contrast(vars['--primary-foreground'], vars['--primary']) >= 4.5, `text on accent ${t.accent}`)
    for (const v of Object.values(vars)) assert.ok(parseHex(v), `${v} is a hex colour`)
  }
})

test('dark and light follow the background', () => {
  assert.equal(deriveTokens({ bg: '#1b2030', accent: '#7aa2f7' }).dark, true)
  assert.equal(deriveTokens({ bg: '#f1e7d0', accent: '#a0522d' }).dark, false)
})

test('a good accent is kept as it is', () => {
  assert.equal(deriveTokens({ bg: '#1b2030', accent: '#7aa2f7' }).vars['--primary'], '#7aa2f7')
})

test('ink has no hue anywhere in the drawing colours', () => {
  const { dark, vars } = inkTokens()
  assert.equal(dark, false)
  for (const k of ['--point-start', '--point-off', '--guide', '--reference', '--shadow', '--primary']) {
    const [r, g, b] = parseHex(vars[k])!
    assert.ok(Math.abs(r - g) < 3 && Math.abs(g - b) < 3, `${k} ${vars[k]} is grey`)
  }
})
