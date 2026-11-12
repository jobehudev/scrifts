import { useSyncExternalStore } from 'react'

/** A point somebody asked the glyph editor to select: the Compare masters panel sets it, the editor shows it once it has that master and glyph open. */
export type PointFocus = { path: string; glyph: string; ci: number; pi: number }

let focus: PointFocus | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())

export const pointFocus = {
  set(f: PointFocus) { focus = f; emit() },
  clear() { if (focus) { focus = null; emit() } },
  get: () => focus,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
}
export const usePointFocus = () => useSyncExternalStore(pointFocus.subscribe, pointFocus.get)
