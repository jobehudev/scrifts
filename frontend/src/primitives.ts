// Ready-made shapes to start a letter from: a stem, a bowl, a serif. Pure, so they can be tested.
// A point is [x, y, on] (on = 1 for an on-curve point, 0 for a curve handle). Outer shapes run
// clockwise and counters (holes) counter-clockwise, which is what makes the hole a hole.

export type Pt = [number, number, number]
export type Contour = { points: Pt[]; closed: boolean }

/** The magic number that makes four cubic curves a near-perfect circle. */
const K = 0.5522847498

export const rect = (x: number, y: number, w: number, h: number): Contour => ({
  points: [[x, y, 1], [x, y + h, 1], [x + w, y + h, 1], [x + w, y, 1]], closed: true,
})

/** An ellipse as four curves. `hole` runs it the other way round. */
export function oval(cx: number, cy: number, rx: number, ry: number, hole = false): Contour {
  const cw: Pt[] = [
    [cx, cy + ry, 1], [cx + K * rx, cy + ry, 0], [cx + rx, cy + K * ry, 0],
    [cx + rx, cy, 1], [cx + rx, cy - K * ry, 0], [cx + K * rx, cy - ry, 0],
    [cx, cy - ry, 1], [cx - K * rx, cy - ry, 0], [cx - rx, cy - K * ry, 0],
    [cx - rx, cy, 1], [cx - rx, cy + K * ry, 0], [cx - K * rx, cy + ry, 0],
  ]
  if (!hole) return { points: cw, closed: true }
  // the same ellipse backwards, starting from the same on-curve point
  const rev = [cw[0], ...cw.slice(1).reverse()]
  return { points: rev, closed: true }
}

export type Params = { x: number; y: number; width: number; height: number; thickness: number }

export type Primitive = {
  id: string; name: string; hint: string
  /** which sizes this shape uses (the rest are hidden) */
  uses: ('width' | 'height' | 'thickness')[]
  make: (p: Params) => Contour[]
}

export const PRIMITIVES: Primitive[] = [
  { id: 'stem', name: 'Stem', hint: 'A vertical bar: the spine of l, i, H, n', uses: ['thickness', 'height'],
    make: p => [rect(p.x, p.y, p.thickness, p.height)] },
  { id: 'bar', name: 'Bar', hint: 'A horizontal bar: the crossbar of e, H, A, the arm of E', uses: ['width', 'thickness'],
    make: p => [rect(p.x, p.y, p.width, p.thickness)] },
  { id: 'oval', name: 'Oval', hint: 'A solid ellipse: the starting point for a counter or a dot', uses: ['width', 'height'],
    make: p => [oval(p.x + p.width / 2, p.y + p.height / 2, p.width / 2, p.height / 2)] },
  { id: 'ring', name: 'Ring (bowl)', hint: 'An oval with a hole: o, O, the bowl of b, d, p, q', uses: ['width', 'height', 'thickness'],
    make: p => {
      const t = Math.min(p.thickness, p.width / 2 - 1, p.height / 2 - 1)
      return [oval(p.x + p.width / 2, p.y + p.height / 2, p.width / 2, p.height / 2),
        oval(p.x + p.width / 2, p.y + p.height / 2, p.width / 2 - t, p.height / 2 - t, true)]
    } },
  { id: 'dot', name: 'Dot', hint: 'A round dot: the dot of i and j, a full stop', uses: ['width'],
    make: p => [oval(p.x + p.width / 2, p.y + p.width / 2, p.width / 2, p.width / 2)] },
  { id: 'serif', name: 'Slab serif', hint: 'A flat foot or head for a stem', uses: ['width', 'thickness'],
    make: p => [rect(p.x, p.y, p.width, p.thickness)] },
  { id: 'wedge', name: 'Wedge', hint: 'A triangle: a pointed serif or terminal, the apex of A', uses: ['width', 'height'],
    make: p => [{ points: [[p.x, p.y, 1], [p.x + p.width / 2, p.y + p.height, 1], [p.x + p.width, p.y, 1]], closed: true }] },
]

/** Signed area of a contour's on-curve polygon: negative means clockwise (y up). */
export function area(c: Contour): number {
  const on = c.points.filter(p => p[2])
  let s = 0
  for (let i = 0; i < on.length; i++) {
    const [x1, y1] = on[i], [x2, y2] = on[(i + 1) % on.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

/** Sensible starting sizes for this font, from its own measurements. */
export function defaults(em: number, xheight: number | null, capheight: number | null) {
  const xh = xheight && xheight > 0 ? xheight : em * 0.5
  const cap = capheight && capheight > 0 ? capheight : em * 0.7
  const stem = Math.round(em * 0.085)
  return { x: Math.round(em * 0.08), y: 0, width: Math.round(em * 0.4), height: Math.round(xh), thickness: stem, xh: Math.round(xh), cap: Math.round(cap) }
}
