import { useEffect, useState, type CSSProperties } from 'react'

// The SCRIFTS wordmark, one shape per letter in reading order, so each letter can move on its own.
const SHAPES: [string, string][] = [
  ['path', 'M121.38,100h218.62c33.08,0,60,26.92,60,60h100C500,71.78,428.22,0,340,0H121.38C54.45,0,0,54.45,0,121.38c0,41.12,20.55,79.1,54.97,101.6l83.21,54.4c19.8,12.94,42.76,19.78,66.41,19.78h99.31l79.65,43.52c10.15,5.54,16.45,16.17,16.45,27.73,0,17.42-14.17,31.6-31.6,31.6h-236.8c-17.42,0-31.6-14.17-31.6-31.6v-48.4H0v48.4c0,72.56,59.03,131.6,131.6,131.6h236.8c72.56,0,131.6-59.03,131.6-131.6,0-48.15-26.25-92.4-68.5-115.49l-102.06-55.76h-124.84c-4.17,0-8.21-1.21-11.7-3.48l-83.21-54.39c-6.06-3.96-9.68-10.65-9.68-17.9,0-11.79,9.59-21.38,21.38-21.38Z'],
  ['path', 'M910,0h-220c-77.2,0-140,62.8-140,140v220c0,77.2,62.8,140,140,140h220c77.2,0,140-62.8,140-140h-100c0,22.06-17.94,40-40,40h-160V100h160c22.06,0,40,17.94,40,40v20h100v-20c0-77.2-62.8-140-140-140Z'],
  ['path', 'M1600,155c0-85.47-69.53-155-155-155h-345v500h100v-190h53.86c12.85,54.38,54.78,98.68,110.64,113.29l95.03,24.85c23.58,6.17,40.04,27.49,40.04,51.86h100c0-69.83-47.19-130.95-114.75-148.61l-95.03-24.85c-10.66-2.79-19.85-8.68-26.74-16.54h81.94c85.47,0,155-69.53,155-155ZM1200,210v-110h245c30.33,0,55,24.67,55,55s-24.67,55-55,55h-245Z'],
  ['path', 'M1800,100v300c0,27.61,22.39,50,50,50h0v50h-200v-50h0c27.61,0,50-22.39,50-50V100c0-27.61-22.39-50-50-50h0V0h200v50h0c-27.61,0-50,22.39-50,50Z'],
  ['polygon', '2400 100 2400 0 1900 0 1900 500 1950 500 2000 500 2100 500 2100 300 2300 300 2300 200 2000 200 2000 100 2400 100'],
  ['path', 'M2950,0v100h0c0-27.61-22.39-50-50-50h-100c-27.61,0-50,22.39-50,50v400h-100V150h-200V0h500Z'],
  ['path', 'M3378.62,400h-218.62c-33.08,0-60-26.92-60-60h-100c0,88.22,71.78,160,160,160h218.62c66.93,0,121.38-54.45,121.38-121.38,0-41.12-20.55-79.1-54.97-101.6l-83.21-54.4c-19.8-12.94-42.76-19.78-66.41-19.78h-99.31l-79.65-43.52c-10.15-5.54-16.45-16.17-16.45-27.73,0-17.42,14.17-31.6,31.6-31.6h236.8c17.42,0,31.6,14.17,31.6,31.6v48.4h100v-48.4c0-72.56-59.03-131.6-131.6-131.6h-236.8c-72.56,0-131.6,59.03-131.6,131.6,0,48.15,26.25,92.4,68.5,115.49l102.06,55.76h124.84c4.17,0,8.21,1.21,11.7,3.48l83.21,54.39c6.06,3.96,9.68,10.65,9.68,17.9,0,11.79-9.59,21.38-21.38,21.38Z'],
]

type Pt = { x: number; y: number }
type Curve = { from: Pt; pull1: Pt; pull2: Pt; to: Pt }
type Letter = { kind: string; d: string; curves: Curve[]; left: number; right: number }

const BIG_CURVE = 150   // only curves at least this long get points; the small rounded corners would just be clutter
const REACH = 2.2       // handles are drawn this much longer than they are, so they can be seen

/** Reads an outline: the curves worth showing, and how far left and right it reaches. */
function readOutline(kind: string, d: string): Letter {
  const curves: Curve[] = [], xs: number[] = []
  if (kind === 'polygon') {
    const n = d.trim().split(/[\s,]+/).map(Number)
    for (let i = 0; i < n.length; i += 2) xs.push(n[i])
  } else {
    const t = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? []
    let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0
    const num = () => Number(t[i++])
    while (i < t.length) {
      if (/[a-zA-Z]/.test(t[i])) cmd = t[i++]
      else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l'  // more pairs after a move are lines
      const rel = cmd === cmd.toLowerCase()
      const ox = rel ? x : 0, oy = rel ? y : 0
      switch (cmd.toUpperCase()) {
        case 'M': x = ox + num(); y = oy + num(); sx = x; sy = y; break
        case 'L': x = ox + num(); y = oy + num(); break
        case 'H': x = ox + num(); break
        case 'V': y = oy + num(); break
        case 'C': {
          const pull1 = { x: ox + num(), y: oy + num() }, pull2 = { x: ox + num(), y: oy + num() }, to = { x: ox + num(), y: oy + num() }
          if (Math.hypot(to.x - x, to.y - y) >= BIG_CURVE) curves.push({ from: { x, y }, pull1, pull2, to })
          x = to.x; y = to.y; break
        }
        case 'Z': x = sx; y = sy; break
        default: i = t.length
      }
      xs.push(x)
    }
  }
  return { kind, d, curves, left: Math.min(...xs), right: Math.max(...xs) }
}
/** A handle's far end, drawn longer than it really is. */
const reach = (from: Pt, pull: Pt): Pt => ({ x: from.x + (pull.x - from.x) * REACH, y: from.y + (pull.y - from.y) * REACH })
const LETTERS = SHAPES.map(([k, d]) => readOutline(k, d))

const SB = 25            // each letter's sidebearing when spaced right, font units: half the 50 between neighbours
const TOP = 0, BASE = 500
// where each letter starts: awkwardly spaced, some close and some far, but always apart (squashing makes a letter a little wider,
// so even the closest pair keeps room)
const OFFSET = [-420, -360, -160, -60, 180, 260, 420]
// how much each letter stretches on the way up (A) and while sliding (B): every character moves a little differently
const STRETCH_A = [0.5, 0.35, 0.65, 0.9, 0.3, 0.55, 0.4]
const STRETCH_B = [0.18, 0.1, 0.22, 0.3, 0.08, 0.16, 0.24]

const FRAME = 1000 / 12
const SLIDE_AT = 1400, SLIDE_FOR = 1333.333  // when the spacing spring runs: the same delay and length as .wm-spacer in index.css

/** cubic-bezier(1, -0.36, 0, 1.29): the spring the letters follow. */
function spring(u: number) {
  let lo = 0, hi = 1
  for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (3 * (1 - m) ** 2 * m + m ** 3 < u) lo = m; else hi = m }
  const t = (lo + hi) / 2
  return 3 * (1 - t) ** 2 * t * -0.36 + 3 * (1 - t) * t * t * 1.29 + t ** 3
}

/** How far the spacing has got (0 = as scattered, 1 = as spaced), stepped at 12 frames a second like the CSS. */
function useSpacing(on: boolean) {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (!on) return
    const t0 = performance.now()
    const id = setInterval(() => {
      const ms = Math.floor((performance.now() - t0) / FRAME) * FRAME
      setP(spring(Math.min(1, Math.max(0, (ms - SLIDE_AT) / SLIDE_FOR))))
      if (ms > SLIDE_AT + SLIDE_FOR) clearInterval(id)
    }, FRAME)
    return () => clearInterval(id)
  }, [on])
  return p
}

/** The wordmark in the current text colour. With `animate`, it plays the way a font gets spaced: the letters pop in badly spaced
 *  with their points and sidebearings showing, then spring into the right spacing and the construction lines fade away. */
export function Wordmark({ animate = false, className }: { animate?: boolean; className?: string }) {
  const p = useSpacing(animate)
  // where each letter is now, and so how much room it has either side (the gap between two letters is shared between them)
  const at = OFFSET.map(d => d * (1 - p))
  const lsb = (i: number) => (i === 0 ? SB : SB + (at[i] - at[i - 1]) / 2)
  const rsb = (i: number) => (i === LETTERS.length - 1 ? SB : SB + (at[i + 1] - at[i]) / 2)
  return (
    <svg viewBox="0 0 3500 500" role="img" aria-label="Scrifts" fill="currentColor" overflow="visible" className={`${className ?? ''} ${animate ? 'wordmark-zoom' : ''}`}>
      {animate && (
        <g className="wm-show" aria-hidden stroke="var(--guide)" strokeWidth={1} vectorEffect="non-scaling-stroke">
          {[TOP, BASE].map(y => <line key={y} x1={-700} x2={4200} y1={y} y2={y} vectorEffect="non-scaling-stroke" />)}
        </g>
      )}
      {LETTERS.map((l, i) => {
        const style = { ['--i' as string]: i, ['--dx' as string]: `${OFFSET[i] ?? 0}px`, ['--a' as string]: STRETCH_A[i] ?? 0.4, ['--b' as string]: STRETCH_B[i] ?? 0.15 } as CSSProperties
        const shape = l.kind === 'polygon' ? <polygon points={l.d} /> : <path d={l.d} />
        if (!animate) return <g key={i}>{shape}</g>
        return (
          <g key={i} className="wm-spacer" style={style}>
            <g className="wm-show" aria-hidden>
              <rect x={l.left - lsb(i)} y={TOP} width={lsb(i)} height={BASE} fill="var(--guide)" opacity={0.35} />
              <rect x={l.right} y={TOP} width={rsb(i)} height={BASE} fill="var(--guide)" opacity={0.35} />
              {[l.left - lsb(i), l.right + rsb(i)].map(x => <line key={x} x1={x} x2={x} y1={TOP - 40} y2={BASE + 40} stroke="var(--guide)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
              {/* the numbers, as the editor's status bar shows them: left bearing above the letter, right bearing below */}
              <g fill="var(--guide)" fontFamily="ui-monospace, 'Cascadia Mono', Consolas, monospace" fontSize={64} textAnchor="middle">
                <text x={l.left - lsb(i) / 2} y={TOP - 70}>{Math.round(lsb(i))}</text>
                <text x={l.right + rsb(i) / 2} y={BASE + 130}>{Math.round(rsb(i))}</text>
              </g>
            </g>
            <g className="wm-body">
            {shape}
            <g className="wm-show" aria-hidden>
              {l.curves.map((c, j) => {
                const h1 = reach(c.from, c.pull1), h2 = reach(c.to, c.pull2)
                return (
                  <g key={j}>
                    <line x1={c.from.x} y1={c.from.y} x2={h1.x} y2={h1.y} stroke="var(--point-off)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <line x1={c.to.x} y1={c.to.y} x2={h2.x} y2={h2.y} stroke="var(--point-off)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    {[h1, h2].map((h, k) => <circle key={k} cx={h.x} cy={h.y} r={16} fill="var(--background)" stroke="var(--point-off)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
                    {[c.from, c.to].map((p, k) => <rect key={k} x={p.x - 14} y={p.y - 14} width={28} height={28} fill="var(--background)" stroke="var(--point-start)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
                  </g>
                )
              })}
            </g>
            </g>
          </g>
        )
      })}
    </svg>
  )
}
