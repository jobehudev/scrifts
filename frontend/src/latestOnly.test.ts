// Run: node --test src/latestOnly.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latestOnly } from './latestOnly.ts'

const later = (ms = 5) => new Promise<void>(r => setTimeout(r, ms))

test('a burst of requests runs once, then once more for the newest', async () => {
  let state = 0
  const seen: number[] = []
  const go = latestOnly(async () => { const mine = state; await later(); seen.push(mine) })
  state = 1; go()
  state = 2; go()
  state = 3; go()
  state = 4; go()
  await later(40)
  assert.deepEqual(seen, [1, 4])   // not 1, 2, 3, 4: the ones in between were skipped
})

test('it keeps working after a failure, and runs again when asked again', async () => {
  let calls = 0
  const go = latestOnly(async () => { calls++; if (calls === 1) throw new Error('server hiccup'); await later() })
  go(); await later(15)
  go(); await later(15)
  assert.equal(calls, 2)
})
