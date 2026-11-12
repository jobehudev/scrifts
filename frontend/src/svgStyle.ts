// SVG drawings: every shape's colours travel in the name of its contours (see backend/svgdoc.py):
//   ~svg <group> <fill> <stroke> <stroke width> <opacity>      ('-' = none)
// Contours of one group are one shape (a donut is two contours), so they are filled together.

export type SvgStyle = { fill: string | null; stroke: string | null; sw: number; op: number }
export type SvgGroup = SvgStyle & { contours: number[] }

export const DEFAULT_FILL: SvgStyle = { fill: '#000000', stroke: null, sw: 1, op: 1 }

const TAG = /^~svg (\d+) (\S+) (\S+) (\S+) (\S+)$/

export function parseSvgTag(name: string | undefined): (SvgStyle & { group: number }) | null {
  const m = TAG.exec(name ?? '')
  if (!m) return null
  return { group: +m[1], fill: m[2] === '-' ? null : m[2], stroke: m[3] === '-' ? null : m[3], sw: +m[4], op: +m[5] }
}

export const svgTag = (group: number, s: SvgStyle) => `~svg ${group} ${s.fill ?? '-'} ${s.stroke ?? '-'} ${+s.sw.toFixed(3)} ${+s.op.toFixed(3)}`

/** The shapes of a drawing, back to front: neighbouring contours of one group together. A contour drawn here
 *  (no tag) is a shape of its own: a black fill, or a thin black line when it is open. */
export function svgGroups(shapes: { name: string; closed: boolean }[]): SvgGroup[] {
  const out: (SvgGroup & { key: number | null })[] = []
  shapes.forEach((sh, ci) => {
    const t = parseSvgTag(sh.name)
    const last = out[out.length - 1]
    if (t && last && last.key === t.group) { last.contours.push(ci); return }
    const style: SvgStyle = t ?? (sh.closed ? DEFAULT_FILL : { fill: null, stroke: '#000000', sw: 2, op: 1 })
    out.push({ key: t ? t.group : null, fill: style.fill, stroke: style.stroke, sw: style.sw, op: style.op, contours: [ci] })
  })
  return out
}

/** The next free group number. */
export const nextGroup = (shapes: { name: string }[]) => shapes.reduce((n, s) => Math.max(n, (parseSvgTag(s.name)?.group ?? -1) + 1), 0)
