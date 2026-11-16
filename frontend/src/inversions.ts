// Which shapes of a glyph are inversions: they run against the biggest shape and touch another one, so where they meet they cut it out
// instead of adding to it. Used for the [inv] tag in the Layers panel. Pure, so it can be tested.

type Pt = [number, number, number, ...unknown[]]
export type ShapeInfo = { contour: Pt[]; closed: boolean; cw: boolean | null }

const ring = (c: Pt[]): [number, number][] => {
  const on = c.filter(p => p[2])
  return (on.length >= 3 ? on : c).map(p => [p[0], p[1]])
}
const area = (r: [number, number][]) => Math.abs(r.reduce((s, [x0, y0], i) => { const [x1, y1] = r[(i + 1) % r.length]; return s + x0 * y1 - x1 * y0 }, 0)) / 2
const inside = ([x, y]: [number, number], r: [number, number][]) => {
  let hit = false
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length]
    if ((y0 > y) !== (y1 > y) && x < ((x1 - x0) * (y - y0)) / (y1 - y0) + x0) hit = !hit
  }
  return hit
}
const cross = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]) => {
  const o = (p: [number, number], q: [number, number], r: [number, number]) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0
}
/** Do two outlines overlap: a point of one inside the other, or edges that cross (a plus sign has neither points inside). */
const touch = (a: [number, number][], b: [number, number][]) =>
  a.some(p => inside(p, b)) || b.some(p => inside(p, a)) ||
  a.some((p, i) => b.some((q, j) => cross(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])))

/** The contour indexes that are inversions. */
export function invertedShapes(shapes: ShapeInfo[]): Set<number> {
  const rings = shapes.map(s => (s.closed && s.contour.length >= 3 ? ring(s.contour) : null))
  let big = -1
  rings.forEach((r, i) => { if (r && shapes[i].cw !== null && (big < 0 || area(r) > area(rings[big]!))) big = i })
  const out = new Set<number>()
  if (big < 0) return out
  rings.forEach((r, i) => {
    if (!r || shapes[i].cw === null || shapes[i].cw === shapes[big].cw) return
    if (rings.some((o, j) => j !== i && o && touch(r, o))) out.add(i)
  })
  return out
}
