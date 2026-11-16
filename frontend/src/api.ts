// Thin client for the Scrifts backend, plus the outline cache every view shares.

export type GlyphInfo = { name: string; unicode: number; width: number }
export type Axis = { tag: string; name: string; min: number; default: number; max: number }
export type FontInfo = {
  path: string; fontname: string; familyname: string
  em: number; ascent: number; descent: number; xheight: number; capheight: number
  quadratic: boolean; glyphs: GlyphInfo[]; axes: Axis[]
  instances: { name: string; location: Record<string, number> }[]
  /** when the file was last written (seconds), from /api/open */
  mtime?: number
}
type RawPath = { d: string; refs?: { ref: string; t: number[]; d: RawPath }[] }
export type RawOutline = RawPath & { name: string; width: number; lsb?: number; rsb?: number }
export type Outline = { name: string; width: number; lsb: number; rsb: number; path: Path2D; uses: string[]; empty: boolean; box: [number, number, number, number] | null }
export type Pt3 = [number, number, number, number?]  // x, y, on-curve 1/0, FontForge point type (1 = smooth)
export type Points = RawOutline & {
  contours: Pt3[][]; refs_list: string[]; background: string
  shapes: { closed: boolean; cw: boolean | null; name: string }[]
  ref_xf: number[][]
  anchors: Anchor[]
}

/** An anchor point; `type` is base (on a letter) or mark (on an accent), among others. */
export type Anchor = { cls: string; type: string; x: number; y: number }
export type AnchorClass = { name: string; kind: string; subtable: string }

/** A second font shown for comparison (read-only), and the page's guides. */
export type Reference = { fid: number; info: FontInfo; store: OutlineStore }
export type Location = Record<string, number>

/** Timings for bench/: read from the page as window.__forgeBench. */
export const bench = { start: 0, opened: 0, firstPaint: 0 }
;(window as unknown as { __forgeBench: typeof bench }).__forgeBench = bench

let inflight = new AbortController()

/** The font this page shows. Every call is addressed to it, so another tab or
 *  script opening a font can never swap what this page draws. */
export const session = { fid: 0, onGone: null as (() => void) | null, stack: false }  // stack: the "Allow overlap" preference, sent with every outline edit

export async function api<T>(url: string, body?: unknown): Promise<T> {
  const fid = session.fid
  if (fid && body === undefined) url += (url.includes('?') ? '&' : '?') + 'fid=' + fid
  if (fid && body && typeof body === 'object' && !('fid' in body)) body = { ...body, fid }
  if (session.stack && url === '/api/edit' && body && typeof body === 'object') body = { ...body, stack: true }
  // the font this call is really about: a ghost's or a reference's going away is not this page's font going away
  const sent = body && typeof body === 'object' && 'fid' in body ? (body as { fid: unknown }).fid : fid
  const r = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: inflight.signal,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    if (r.status === 410 && fid && fid === session.fid && sent === fid) {
      session.onGone?.()
      const e = new Error('font session expired'); e.name = 'AbortError'; throw e
    }
    throw new Error(j.detail ?? r.statusText)
  }
  if (fid !== session.fid) {
    // answer for a font this page has since replaced: drop it
    const e = new Error('stale response'); e.name = 'AbortError'; throw e
  }
  return j as T
}

/** Kill the FontForge worker (the only way to stop a core op) and drop pending fetches. */
export const lastCancel = { at: 0 }
export async function cancelAll() {
  lastCancel.at = Date.now()
  inflight.abort()
  inflight = new AbortController()
  await fetch('/api/cancel', { method: 'POST' })
}

/** Bounding box from the path's numbers (control points included, so slightly generous); refs transformed. */
export function rawBox(raw: { d: string; refs?: RawPath['refs'] }): [number, number, number, number] | null {
  let b: [number, number, number, number] | null = null
  const add = (x: number, y: number) => { b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y] }
  const n = raw.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? []
  for (let i = 0; i + 1 < n.length; i += 2) add(n[i], n[i + 1])
  for (const r of raw.refs ?? []) {
    const rb = rawBox(r.d); if (!rb) continue
    const m = new DOMMatrix(r.t)
    for (const [x, y] of [[rb[0], rb[1]], [rb[2], rb[1]], [rb[0], rb[3]], [rb[2], rb[3]]]) add(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f)
  }
  return b
}

export function toPath(raw: { d: string; refs?: RawPath['refs'] }): Path2D {
  const p = new Path2D(raw.d)
  for (const r of raw.refs ?? []) p.addPath(toPath(r.d), new DOMMatrix(r.t))
  return p
}

/**
 * Path2D from FontForge's point list, for live redraw while dragging (the
 * core's own outline replaces it on release). Cubic: on, off, off, on.
 * Quadratic: consecutive off-curves imply an on-curve halfway between.
 */
export function contourPath(contours: Pt3[][], closed: boolean[], quadratic: boolean): Path2D {
  const path = new Path2D()
  contours.forEach((c, ci) => {
    const start = c.findIndex(p => p[2])
    if (start < 0) return
    const n = c.length
    path.moveTo(c[start][0], c[start][1])
    let offs: Pt3[] = []
    const steps = closed[ci] ? n : n - start - 1
    for (let k = 1; k <= steps; k++) {
      const p = c[(start + k) % n]
      if (!p[2]) { offs.push(p); continue }
      if (!offs.length) path.lineTo(p[0], p[1])
      else if (!quadratic && offs.length === 2) path.bezierCurveTo(offs[0][0], offs[0][1], offs[1][0], offs[1][1], p[0], p[1])
      else offs.forEach((o, i) => {
        const end = i === offs.length - 1 ? p : [(o[0] + offs[i + 1][0]) / 2, (o[1] + offs[i + 1][1]) / 2]
        path.quadraticCurveTo(o[0], o[1], end[0], end[1])
      })
      offs = []
    }
    if (closed[ci]) path.closePath()
  })
  return path
}

const refNames = (raw: RawPath): string[] =>
  (raw.refs ?? []).flatMap(r => [r.ref, ...refNames(r.d)])

export const locKey = (loc: Location | null) =>
  loc ? Object.keys(loc).sort().map(k => `${k}=${loc[k].toFixed(2)}`).join(',') : ''

/**
 * Outline cache keyed by (location, glyph). Views ask for what is on screen;
 * requests made in the same tick are batched into one backend call. Entries
 * are only replaced on edit (`put`) or dropped on a new font (`clear`).
 */
export class OutlineStore {
  /** fid: a fixed font (e.g. a reference font); omitted = this page's font. */
  fid?: number
  constructor(fid?: number) { this.fid = fid }

  private cache = new Map<string, Outline>()
  private points = new Map<string, Points>()
  /** The newest outline of each glyph at any location: drawn while the one for a new location is on its way, so moving a slider never blanks the view. */
  private last = new Map<string, Outline>()
  /** The location the views asked for most recently: older ones are answered late or not at all, and must never become what is shown meanwhile. */
  private newest = ''
  /** The glyphs the views asked for at the newest location: what is on screen (and just was). */
  private seen = new Set<string>()
  private wanted = new Map<string, { names: Set<string>; loc: Location | null }>()
  private pending = new Set<string>()
  /** Names the server did not send back, and when: asked again no sooner than a few seconds later, never in a tight loop. */
  private missing = new Map<string, number>()
  private timer = 0
  private subs = new Set<() => void>()
  version = 0

  get(name: string, loc: Location | null) {
    return this.cache.get(locKey(loc) + '|' + name)
  }

  getPoints(name: string) {
    return this.points.get(name)
  }

  putPoints(p: Points, notify = true) {
    this.points.set(p.name, p)
    this.put(p, null, notify)
  }

  /** Returns the cached outline, scheduling a fetch if it is missing. */
  want(name: string, loc: Location | null) {
    const lk0 = locKey(loc)
    if (loc) { if (lk0 !== this.newest) { this.newest = lk0; this.seen = new Set() } this.seen.add(name) }
    const k = lk0 + '|' + name
    const hit = this.cache.get(k)
    if (hit) return hit
    if (this.pending.has(k)) return this.last.get(name)
    const gone = this.missing.get(k)
    if (gone !== undefined && Date.now() - gone < 5000) return undefined
    if (!this.fid && !session.fid) return this.last.get(name)  // between two fonts (a master switch): nothing can be asked yet; the new font's first draw asks
    this.pending.add(k)
    const lk = locKey(loc)
    if (!this.wanted.has(lk)) this.wanted.set(lk, { names: new Set(), loc })
    this.wanted.get(lk)!.names.add(name)
    if (!this.timer) this.timer = window.setTimeout(() => this.flush(), 0)
    return this.last.get(name)
  }

  /** Fetch what is on screen at each of these locations ahead of time (Play uses it, so the sweep only reads the cache). One after the other; `token.cancelled` stops it. */
  async prefetch(locs: Location[], token: { cancelled: boolean }) {
    const names = [...this.seen].slice(0, 200)
    if (!names.length) return
    for (const loc of locs) {
      if (token.cancelled) return
      const lk = locKey(loc)
      const need = names.filter(n => !this.cache.has(lk + '|' + n))
      if (!need.length) continue
      const res = await api<RawOutline[]>('/api/outlines', this.fid ? { names: need, location: loc, fid: this.fid } : { names: need, location: loc })
      for (const o of res) this.put(o, loc, false)
    }
    this.emit()
  }

  private async flush() {
    this.timer = 0
    let batches = [...this.wanted.values()]
    this.wanted.clear()
    // a slider moved on while these waited: asking for the positions it passed through would only slow the one it is at
    const stale = batches.filter(b => b.loc && locKey(b.loc) !== this.newest)
    if (stale.length < batches.length) {
      for (const b of stale) for (const n of b.names) this.pending.delete(locKey(b.loc) + '|' + n)
      batches = batches.filter(b => !stale.includes(b))
    }
    for (const { names, loc } of batches) {
      const list = [...names]
      try {
        const res = await api<RawOutline[]>('/api/outlines',
          this.fid ? { names: list, location: loc, fid: this.fid } : { names: list, location: loc })
        for (const o of res) this.put(o, loc, false)
        for (const n of list) {
          const k = locKey(loc) + '|' + n
          this.pending.delete(k)
          if (!this.cache.has(k)) this.missing.set(k, Date.now())  // asked for, not sent: do not ask again at once
        }
        this.emit()
      } catch (e) {
        // the answer was for a font this page has since replaced (or the call was cancelled): not the glyphs' fault, so ask again as soon as they are drawn
        // (marking them missing would leave them blank for five seconds, e.g. right after switching masters)
        const gone = (e as Error).name === 'AbortError'
        for (const n of list) { const k = locKey(loc) + '|' + n; this.pending.delete(k); if (!gone) this.missing.set(k, Date.now()) }
      }
    }
  }

  put(o: RawOutline, loc: Location | null, notify = true) {
    if (!loc && !('contours' in o)) this.points.delete(o.name)
    this.missing.delete(locKey(loc) + '|' + o.name)
    const out: Outline = {
      name: o.name, width: o.width, lsb: o.lsb ?? 0, rsb: o.rsb ?? 0, path: toPath(o),
      uses: refNames(o), empty: !o.d.trim() && !o.refs?.length, box: rawBox(o),
    }
    this.cache.set(locKey(loc) + '|' + o.name, out)
    if (this.cache.size > 40000) for (const k of [...this.cache.keys()].slice(0, 10000)) this.cache.delete(k)  // oldest first: a long slider session must not grow without limit
    if (!loc || locKey(loc) === this.newest) this.last.set(o.name, out)  // a late answer for a position the slider has left is kept, but not shown meanwhile
    if (notify) this.emit()
  }

  /** After editing `name`: forget every cached composite that draws it. */
  invalidateUsers(name: string) {
    for (const [k, o] of this.cache) if (o.uses.includes(name)) this.cache.delete(k)
    for (const [n, o] of this.last) if (o.uses.includes(name) || n === name) this.last.delete(n)
    for (const [n, p] of this.points) if (p.refs_list.includes(name)) this.points.delete(n)
    this.emit()
  }

  /** `keepShown`: another master of the same family is coming, so keep drawing the old shapes until the new ones arrive (blank cells would flash). */
  clear(keepShown = false) {
    this.cache.clear()
    if (!keepShown) this.last.clear()
    this.points.clear()
    this.pending.clear()
    this.wanted.clear()
    this.missing.clear()
    this.emit()
  }

  private emit() {
    this.version++
    this.subs.forEach(f => f())
  }

  subscribe = (f: () => void) => {
    this.subs.add(f)
    return () => { this.subs.delete(f) }
  }
}

export const outlines = new OutlineStore()
