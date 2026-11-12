import { test } from 'node:test'
import assert from 'node:assert/strict'
import { literalChunks, CHUNK } from './shapedText.ts'

const names = new Set(['a', 'f_i', 'a.sc'])

test('plain stretches only: /glyph names and line breaks stand alone', () => {
  assert.deepEqual(literalChunks('office /f_i fifty\nsecond line', names), ['office ', 'fifty', 'second line'])
  assert.deepEqual(literalChunks('/a/a.sc', names), [])
})

test('a slash that is not a glyph name is ordinary text', () => {
  assert.deepEqual(literalChunks('1/2 and /nope', names), ['1/2 and /nope'])
})

test('long text is cut at spaces, never inside a word', () => {
  const word = 'abcdefghi '
  const parts = literalChunks(word.repeat(100), names)
  assert.ok(parts.length > 1)
  assert.ok(parts.every(p => p.length <= CHUNK && p.endsWith(' ')))
  assert.equal(parts.join(''), word.repeat(100))
})
