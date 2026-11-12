/** A stroke is an open path whose contour name carries its settings, e.g. "~stroke 80 round round"
 *  (width in font units, cap, join). Same format as backend/strokes.py; FontForge does the stroking. */
export const CAPS = ['butt', 'round', 'square'] as const
export const JOINS = ['miter', 'round', 'bevel'] as const
export type Cap = (typeof CAPS)[number]
export type Join = (typeof JOINS)[number]
export type StrokeSpec = { width: number; cap: Cap; join: Join }

const PREFIX = '~stroke'

export const strokeMark = (s: StrokeSpec) => `${PREFIX} ${Math.round(s.width * 100) / 100} ${s.cap} ${s.join}`

export function parseStroke(name: string | null | undefined): StrokeSpec | null {
  const p = (name ?? '').trim().split(/\s+/)
  if (p.length < 2 || p[0] !== PREFIX) return null
  const width = Number(p[1])
  const cap = (p[2] ?? 'round') as Cap
  const join = (p[3] ?? 'round') as Join
  if (!(width > 0) || !CAPS.includes(cap) || !JOINS.includes(join)) return null
  return { width, cap, join }
}
