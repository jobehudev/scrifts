// Live-corner geometry for the Glyph view: the preview while you drag a corner widget. Mirrors backend/corners.py,
// which makes the real edit (FontForge has no fillet call). Pure, so it can be tested.

export type P = [number, number, number, number?]  // x, y, 1 on-curve / 0 handle, FontForge point type
export type CornerKind = 'round' | 'inverted' | 'chamfer'
export const CORNER_KINDS: [CornerKind, string][] = [['round', 'Round'], ['inverted', 'Inverted round'], ['chamfer', 'Chamfer']]

export type Corner = { ux: number; uy: number; lu: number; vx: number; vy: number; lv: number; theta: number }

/** The two edges meeting at point i, if it is a corner between two straight edges (the only kind that can be rounded). */
export function cornerAt(pts: P[], closed: boolean, i: number): Corner | null {
  const n = pts.length
  if (!pts[i]?.[2] || (!closed && !(i > 0 && i < n - 1))) return null
  const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], [x, y] = pts[i]
  if (!a[2] || !b[2]) return null
  const lu = Math.hypot(a[0] - x, a[1] - y), lv = Math.hypot(b[0] - x, b[1] - y)
  if (lu < 1e-6 || lv < 1e-6) return null
  const ux = (a[0] - x) / lu, uy = (a[1] - y) / lu, vx = (b[0] - x) / lv, vy = (b[1] - y) / lv
  const theta = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)))
  return theta < 1e-3 || theta > Math.PI - 1e-3 ? null : { ux, uy, lu, vx, vy, lv, theta }
}

/** The biggest radius that fits this corner (each end may use half its edge). */
export const maxRadius = (c: Corner) => Math.min(c.lu / 2, c.lv / 2) * Math.tan(c.theta / 2)

/** Where the corner's widget sits: the middle of the rounding circle, on the line that halves the corner. */
export function widgetPos(pts: P[], c: Corner, i: number, radius: number, minDist: number): [number, number] {
  const [x, y] = pts[i]
  let bx = c.ux + c.vx, by = c.uy + c.vy
  const l = Math.hypot(bx, by) || 1
  bx /= l; by /= l
  const d = Math.max(Math.min(radius, maxRadius(c)) / Math.sin(c.theta / 2), minDist)
  return [x + bx * d, y + by * d]
}

/** The radius a widget dragged to (qx, qy) means. */
export function radiusFromDrag(pts: P[], c: Corner, i: number, qx: number, qy: number, minDist: number): number {
  const [x, y] = pts[i]
  let bx = c.ux + c.vx, by = c.uy + c.vy
  const l = Math.hypot(bx, by) || 1
  bx /= l; by /= l
  const d = (qx - x) * bx + (qy - y) * by
  return d <= minDist ? 0 : Math.min(d * Math.sin(c.theta / 2), maxRadius(c))
}

export function roundPoints(pts: P[], closed: boolean, picked: Set<number>, radius: number, kind: CornerKind = 'round'): P[] {
  const out: P[] = []
  const rnd = (x: number, y: number, on: number): P => [Math.round(x), Math.round(y), on]
  pts.forEach((p, i) => {
    const c = picked.has(i) && radius > 0 ? cornerAt(pts, closed, i) : null
    if (!c) { out.push(p); return }
    const [x, y] = p, half = c.theta / 2
    const t = Math.min(radius / Math.tan(half), c.lu / 2, c.lv / 2)
    const r = t * Math.tan(half), h = 4 / 3 * Math.tan((Math.PI - c.theta) / 4) * r
    const t1: [number, number] = [x + c.ux * t, y + c.uy * t], t2: [number, number] = [x + c.vx * t, y + c.vy * t]
    if (kind === 'chamfer') { out.push(rnd(...t1, 1), rnd(...t2, 1)); return }
    let c1: [number, number] = [t1[0] - c.ux * h, t1[1] - c.uy * h], c2: [number, number] = [t2[0] - c.vx * h, t2[1] - c.vy * h]
    if (kind === 'inverted') {
      const mirror = (q: [number, number]): [number, number] => {
        const dx = t2[0] - t1[0], dy = t2[1] - t1[1], k = ((q[0] - t1[0]) * dx + (q[1] - t1[1]) * dy) / (dx * dx + dy * dy)
        return [2 * (t1[0] + k * dx) - q[0], 2 * (t1[1] + k * dy) - q[1]]
      }
      c1 = mirror(c1); c2 = mirror(c2)
    }
    out.push(rnd(...t1, 1), rnd(...c1, 0), rnd(...c2, 0), rnd(...t2, 1))
  })
  return out
}
