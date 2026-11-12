// Comparing one glyph in two masters, point by point, like a text diff. Masters blend only when every contour has
// the same points in the same order with the same on/off-curve pattern, the same direction and the same start point;
// this shows where they stop doing that. Pure, so it can be tested.

export type P = [number, number, number]  // x, y, 1 on-curve / 0 handle
export type GlyphPts = { width: number; contours: P[][]; closed: boolean[]; refs: string[] }

export type Row = {
  a?: P; b?: P; ai?: number; bi?: number
  /** same: identical; moved: the same point somewhere else; only-a / only-b: a point the other master lacks; kind: on-curve in one, handle in the other */
  status: 'same' | 'moved' | 'only-a' | 'only-b' | 'kind'
  /** an unmatched point that sits almost on top of its neighbour in its own master: most likely a stray left over from an edit */
  stray?: boolean
}
export type ContourDiff = {
  index: number; rows: Row[]; onlyIn?: 'a' | 'b'
  /** what stops this contour from blending, in words */
  problems: string[]
}
export type Diff = { contours: ContourDiff[]; problems: string[]; compatible: boolean; width: [number, number] }

const STRAY = 1.5  // units
const kinds = (c: P[]) => c.map(p => p[2])

/** Signed area of the on-curve polygon: positive = counter-clockwise (y up). */
export function area(c: P[]): number {
  const on = c.filter(p => p[2])
  let s = 0
  for (let i = 0; i < on.length; i++) { const [x1, y1] = on[i], [x2, y2] = on[(i + 1) % on.length]; s += x1 * y2 - x2 * y1 }
  return s / 2
}

/**
 * Which point of A is "the same point" as which of B: matching only points of the same kind (on-curve with on-curve,
 * handle with handle), as close together as possible, with the rest left over (only in one master). A plain edit-distance
 * walk, so an extra point shows up where it was inserted rather than at the end.
 */
export function align(a: P[], b: P[]): [number | null, number | null][] {
  const n = a.length, m = b.length
  const xs = [...a, ...b].map(p => p[0]), ys = [...a, ...b].map(p => p[1])
  const gap = Math.max(1, 0.3 * Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)))  // an unmatched point costs this much
  const C = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) C[i][m] = C[i + 1][m] + gap
  for (let j = m - 1; j >= 0; j--) C[n][j] = C[n][j + 1] + gap
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    const pair = a[i][2] === b[j][2] ? Math.hypot(a[i][0] - b[j][0], a[i][1] - b[j][1]) + C[i + 1][j + 1] : Infinity
    C[i][j] = Math.min(pair, gap + C[i + 1][j], gap + C[i][j + 1])
  }
  const out: [number | null, number | null][] = []
  let i = 0, j = 0
  while (i < n || j < m) {
    const pair = i < n && j < m && a[i][2] === b[j][2] ? Math.hypot(a[i][0] - b[j][0], a[i][1] - b[j][1]) + C[i + 1][j + 1] : Infinity
    if (i < n && j < m && pair <= C[i][j] + 1e-9) out.push([i++, j++])
    else if (i < n && (j >= m || gap + C[i + 1][j] <= C[i][j] + 1e-9)) out.push([i++, null])
    else out.push([null, j++])
  }
  return out
}

/** The shift that makes B's on/off pattern equal A's when B starts somewhere else (a different start point), or null. */
export function startShift(a: number[], b: number[]): number | null {
  if (a.length !== b.length || !a.length || a.every((v, i) => v === b[i])) return null
  for (let k = 1; k < b.length; k++) if (b.every((_, i) => b[(i + k) % b.length] === a[i])) return k
  return null
}

/** For two contours with the same pattern: the start shift of B that brings the points clearly closer to A's, or 0. */
export function geometricShift(a: P[], b: P[]): number {
  const n = a.length
  if (n < 3 || n !== b.length) return 0
  const cost = (k: number) => a.reduce((s, p, i) => s + Math.hypot(p[0] - b[(i + k) % n][0], p[1] - b[(i + k) % n][1]), 0)
  let best = 0, bc = cost(0)
  const c0 = bc
  for (let k = 1; k < n; k++) {
    if (a.some((p, i) => p[2] !== b[(i + k) % n][2])) continue
    const c = cost(k)
    if (c < bc) { bc = c; best = k }
  }
  return best && bc < 0.5 * c0 ? best : 0
}

export function diffContour(index: number, ca: P[], cb: P[], closedA: boolean, closedB: boolean): ContourDiff {
  const problems: string[] = []
  const rot = (c: P[], k: number) => c.map((_, i) => c[(i + k) % c.length])
  const ka = kinds(ca), kb = kinds(cb)
  let shift = closedA && closedB ? (startShift(ka, kb) ?? (ca.length === cb.length && ka.every((v, i) => v === kb[i]) ? geometricShift(ca, cb) : 0)) : 0
  const shown = shift ? rot(cb, shift) : cb  // when only the start point differs, line them up so the rest reads as moved points
  if (shift) problems.push(`the same points, but the other master starts ${shift} point${shift > 1 ? 's' : ''} further on (make the first point match)`)
  const same = shown.length === ca.length && shown.every((p, i) => p[2] === ca[i][2])  // the same pattern: the points pair up one to one
  const pairs: [number | null, number | null][] = same ? ca.map((_, i) => [i, i]) : align(ca, shown)
  const rows: Row[] = pairs.map(([i, j]): Row => {
    if (i !== null && j === null) return { a: ca[i], ai: i, status: 'only-a' }
    if (i === null && j !== null) return { b: shown[j], bi: (j + shift) % cb.length, status: 'only-b' }
    const a = ca[i!], b = shown[j!]
    return { a, b, ai: i!, bi: (j! + shift) % cb.length, status: a[0] === b[0] && a[1] === b[1] ? 'same' : 'moved' }
  })
  const near = (c: P[], i: number) => [c[(i + c.length - 1) % c.length], c[(i + 1) % c.length]].some(q => q !== c[i] && Math.hypot(q[0] - c[i][0], q[1] - c[i][1]) < STRAY)
  for (const r of rows) {
    if (r.status === 'only-a' && near(ca, r.ai!)) r.stray = true
    if (r.status === 'only-b' && near(cb, r.bi!)) r.stray = true
  }
  const lost = rows.filter(r => r.status === 'only-a').length, added = rows.filter(r => r.status === 'only-b').length
  if (lost || added) problems.push(`${ca.length} points here, ${cb.length} there${lost && added ? ` (${lost} only here, ${added} only there)` : lost ? ` (${lost} only here)` : ` (${added} only there)`}`)
  const strays = rows.filter(r => r.stray)
  if (strays.length) problems.push(`${strays.length} of the unmatched point${strays.length > 1 ? 's sit' : ' sits'} less than ${STRAY} units from a neighbour: most likely stray points, delete ${strays.length > 1 ? 'them' : 'it'} in the master that has ${strays.length > 1 ? 'them' : 'it'}`)
  if (closedA !== closedB) problems.push(closedA ? 'closed here, open there' : 'open here, closed there')
  if (!lost && !added && closedA && closedB && Math.sign(area(ca)) !== Math.sign(area(shown))) problems.push('drawn in opposite directions')
  return { index, rows, problems }
}

export function diffGlyph(a: GlyphPts, b: GlyphPts): Diff {
  const n = Math.max(a.contours.length, b.contours.length)
  const contours: ContourDiff[] = []
  for (let i = 0; i < n; i++) {
    const ca = a.contours[i], cb = b.contours[i]
    if (ca && cb) contours.push(diffContour(i, ca, cb, a.closed[i], b.closed[i]))
    else contours.push({
      index: i, onlyIn: ca ? 'a' : 'b', problems: [ca ? 'no contour here in the other master' : 'no contour here in this master'],
      rows: (ca ?? cb).map((p, k): Row => ca ? { a: p, ai: k, status: 'only-a' } : { b: p, bi: k, status: 'only-b' }),
    })
  }
  const problems: string[] = []
  if (a.contours.length !== b.contours.length) problems.push(`${a.contours.length} contours here, ${b.contours.length} there`)
  if (a.refs.join(',') !== b.refs.join(',')) problems.push(`components differ (${a.refs.join(' ') || 'none'} / ${b.refs.join(' ') || 'none'})`)
  for (const c of contours) for (const p of c.problems) problems.push(`contour ${c.index + 1}: ${p}`)
  return { contours, problems, compatible: problems.length === 0, width: [a.width, b.width] }
}

// ---- the whole font

export type Category = 'missing' | 'points' | 'start' | 'direction' | 'components' | 'other'
export const CATEGORY_LABEL: Record<Category, string> = {
  missing: 'missing glyph', points: 'different points', start: 'start point', direction: 'direction', components: 'components', other: 'other',
}
const categorize = (p: string): Category =>
  /missing|no contour|contours here/.test(p) ? 'missing' : /points here|stray/.test(p) ? 'points' : /starts \d+ point/.test(p) ? 'start'
    : /opposite directions/.test(p) ? 'direction' : /components differ/.test(p) ? 'components' : 'other'

export type GlyphReport = { name: string; ok: boolean; problems: string[]; categories: Category[]; missingIn?: 'a' | 'b'; diff?: Diff }

/** Every glyph of two masters: the ones that will not blend first (worst first), then the ones that do. */
export function diffAll(a: Record<string, GlyphPts>, b: Record<string, GlyphPts>): GlyphReport[] {
  const out: GlyphReport[] = []
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!a[name] || !b[name]) {
      out.push({ name, ok: false, problems: [`missing in ${!a[name] ? 'A' : 'B'}`], categories: ['missing'], missingIn: !a[name] ? 'a' : 'b' })
      continue
    }
    const d = diffGlyph(a[name], b[name])
    out.push({ name, ok: d.compatible, problems: d.problems, categories: [...new Set(d.problems.map(categorize))], diff: d })
  }
  const rank = (r: GlyphReport) => r.ok ? 9 : Math.min(...r.categories.map(c => ['missing', 'points', 'start', 'direction', 'components', 'other'].indexOf(c)))
  return out.sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name))
}

/** Where a point that only one master has would go in the other master: just after the nearest matched point above it
 *  (or before the nearest one below, or first), as an index into that master's contour. */
export function insertIndex(rows: Row[], k: number, into: 'a' | 'b'): number {
  const at = (r: Row) => into === 'a' ? r.ai : r.bi
  for (let i = k - 1; i >= 0; i--) { const v = at(rows[i]); if (v !== undefined) return v + 1 }
  for (let i = k + 1; i < rows.length; i++) { const v = at(rows[i]); if (v !== undefined) return v }
  return 0
}
