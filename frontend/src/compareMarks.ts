import { useSyncExternalStore } from 'react'

/** Points the Compare masters panel found in only one master, per master file, for the glyph editor to draw in red.
 *  keys are "contour:point", as the editor uses. */
export type CompareMarks = { glyph: string; byPath: { path: string; keys: Set<string> }[] } | null

let marks: CompareMarks = null
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())

export const compareMarks = {
  set(m: CompareMarks) { marks = m; emit() },
  get: () => marks,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
}
export const useCompareMarks = () => useSyncExternalStore(compareMarks.subscribe, compareMarks.get)
