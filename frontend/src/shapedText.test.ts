import { test } from 'node:test'
import assert from 'node:assert/strict'
import { literalChunks, CHUNK, dirOf, isComplex } from './shapedText.ts'

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

test('a change of direction splits the text: Latin words are shaped apart from Arabic and Hebrew', () => {
  assert.deepEqual(literalChunks('hello مرحبا world', names), ['hello ', 'مرحبا ', 'world'])
  assert.deepEqual(literalChunks('שלום', names), ['שלום'])
  assert.equal(dirOf('a'), 'ltr'); assert.equal(dirOf('ب'), 'rtl'); assert.equal(dirOf(' '), 'neutral'); assert.equal(dirOf('5'), 'neutral')
})

test('complexOnly keeps just the stretches that cannot be set one glyph per character', () => {
  assert.deepEqual(literalChunks('hello مرحبا world', names, true), ['مرحبا '])
  assert.deepEqual(literalChunks('नमस्ते and plain', names, true), ['नमस्ते '])
  assert.deepEqual(literalChunks('only latin', names, true), [])
  assert.ok(isComplex('ب') && isComplex('न') && isComplex('ก') && !isComplex('a') && !isComplex('я'))
})
