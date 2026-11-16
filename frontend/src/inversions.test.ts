// Run: node --test src/inversions.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { invertedShapes, type ShapeInfo } from './inversions.ts'

const box = (x0: number, y0: number, x1: number, y1: number, cw: boolean): ShapeInfo => {
  const p: [number, number, number][] = [[x0, y0, 1], [x0, y1, 1], [x1, y1, 1], [x1, y0, 1]]
  return { contour: cw ? p : p.reverse(), closed: true, cw }
}

test('a counter and a shape cutting across are inversions, shapes going the same way are not', () => {
  assert.deepEqual([...invertedShapes([box(0, 0, 400, 400, true), box(100, 100, 200, 200, false)])], [1])  // a counter
  assert.deepEqual([...invertedShapes([box(0, 0, 400, 400, true), box(300, 300, 700, 700, false)])], [1])  // crossing the other way
  assert.deepEqual([...invertedShapes([box(0, 0, 400, 400, true), box(300, 300, 700, 700, true)])], [])    // merging
  assert.deepEqual([...invertedShapes([box(0, 0, 400, 400, true), box(100, 100, 200, 200, true)])], [])    // on top
})

test('a shape that touches nothing is not an inversion, whichever way it runs', () => {
  assert.deepEqual([...invertedShapes([box(0, 0, 400, 400, true), box(600, 0, 700, 100, false)])], [])
})

test('crossing bars (no corner of either inside the other) still count', () => {
  assert.deepEqual([...invertedShapes([box(0, 300, 1000, 400, true), box(450, 0, 550, 800, false)])], [1])
})

test('the way the biggest shape runs is the way of the glyph', () => {
  assert.deepEqual([...invertedShapes([box(0, 0, 400, 400, false), box(100, 100, 200, 200, true)])], [1])
})

test('open paths and nothing at all are fine', () => {
  assert.deepEqual([...invertedShapes([])], [])
  assert.deepEqual([...invertedShapes([{ contour: [[0, 0, 1], [10, 10, 1]], closed: false, cw: null }, box(0, 0, 4, 4, true)])], [])
})
