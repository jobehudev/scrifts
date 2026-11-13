import { useSyncExternalStore } from 'react'
import { api, contourPath, type Location } from './api'
import type { BlendGlyph } from './FamilyBar'

/**
 * The glyphs of a family blended at a weight, for the views that show many at once (the glyph grid). Like OutlineStore: what the
 * views ask for in the same moment goes out as one request, only the newest weight is fetched, and while a weight's drawing is on
 * its way the last one is shown, so a slider moving never blanks the cells. Play fills it ahead of time (`prefetch`).
 */
export type Shape = { path: Path2D; width: number }
type Spot = { family: string; weight: number; location: Location; quadratic: boolean }
const keyOf = (s: Spot) => `${s.family}|${s.weight}|${JSON.stringify(s.location)}`

class BlendStore {
  private cache = new Map<string, Map<string, Shape | null>>()
  private last = new Map<string, Shape>()
  private pending = new Set<string>()
  private wanted = new Map<string, { spot: Spot; names: Set<string> }>()
  private seen = new Set<string>()
  private newest = ''
  private timer = 0
  private subs = new Set<() => void>()
  version = 0

  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f) } }
  private emit() { this.version++; this.subs.forEach(f => f()) }

  /** After an edit or another family: forget everything. */
  clear() {
    this.cache.clear(); this.last.clear(); this.pending.clear(); this.wanted.clear(); this.seen.clear(); this.newest = ''
    this.emit()
  }

  /** The glyph blended at `spot`; until it is there, the last blended drawing of it (or nothing). */
  get(spot: Spot, name: string): Shape | undefined {
    const k = keyOf(spot)
    if (k !== this.newest) { this.newest = k; this.seen = new Set() }
    this.seen.add(name)
    const m = this.cache.get(k)
    if (m?.has(name)) return m.get(name) ?? undefined
    const pk = k + '|' + name
    if (!this.pending.has(pk)) {
      this.pending.add(pk)
      if (!this.wanted.has(k)) this.wanted.set(k, { spot, names: new Set() })
      this.wanted.get(k)!.names.add(name)
      if (!this.timer) this.timer = window.setTimeout(() => this.flush(), 0)
    }
    return this.last.get(name)
  }

  private store(spot: Spot, res: Record<string, BlendGlyph | null>, names: string[]) {
    const k = keyOf(spot)
    const m = this.cache.get(k) ?? this.cache.set(k, new Map()).get(k)!
    for (const n of names) {
      const g = res[n]
      const shape = g ? { path: contourPath(g.contours, g.closed, spot.quadratic), width: g.width } : null
      m.set(n, shape)
      if (shape && k === this.newest) this.last.set(n, shape)
    }
  }

  private async flush() {
    this.timer = 0
    let batches = [...this.wanted.entries()]
    this.wanted.clear()
    const stale = batches.filter(([k]) => k !== this.newest)  // the slider moved on: ask only about where it is
    if (stale.length < batches.length) {
      for (const [k, b] of stale) for (const n of b.names) this.pending.delete(k + '|' + n)
      batches = batches.filter(b => !stale.includes(b))
    }
    for (const [k, { spot, names }] of batches) {
      const list = [...names]
      try {
        const res = await api<Record<string, BlendGlyph | null>>('/api/family/blend', { path: spot.family, weight: spot.weight, location: spot.location, names: list })
        this.store(spot, res, list)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') this.store(spot, {}, list)  // the family can't blend them: the master's own drawing stays
      }
      for (const n of list) this.pending.delete(k + '|' + n)
      this.emit()
    }
  }

  /** Fetch what is on screen at each weight ahead of time, one after the other; `token.cancelled` stops it. */
  async prefetch(base: Omit<Spot, 'weight'>, weights: number[], token: { cancelled: boolean }) {
    const names = [...this.seen].slice(0, 200)
    if (!names.length) return
    for (const weight of weights) {
      if (token.cancelled) return
      const spot = { ...base, weight }
      const have = this.cache.get(keyOf(spot))
      const need = names.filter(n => !have?.has(n))
      if (!need.length) continue
      const res = await api<Record<string, BlendGlyph | null>>('/api/family/blend', { path: spot.family, weight, location: spot.location, names: need })
      this.store(spot, res, need)
    }
    this.emit()
  }
}

export const blendStore = new BlendStore()
export const useBlendVersion = () => useSyncExternalStore(blendStore.subscribe, () => blendStore.version)
