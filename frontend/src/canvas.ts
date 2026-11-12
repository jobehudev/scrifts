import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { outlines, type OutlineStore } from './api'

const noop = () => () => {}
/** Re-render when the page's outlines (and, if given, another store's) change. */
export const useOutlineVersion = (extra?: OutlineStore | null) => {
  useSyncExternalStore(extra ? extra.subscribe : noop, () => extra?.version ?? 0)
  return useSyncExternalStore(outlines.subscribe, () => outlines.version)
}

/**
 * A canvas that fills its parent, is DPR-correct, and redraws (once per
 * frame at most) when `draw` changes or the parent resizes. `draw` gets CSS
 * pixel coordinates.
 */
export function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  const frame = useRef(0)

  const paintNow = () => {
    cancelAnimationFrame(frame.current)
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth, h = c.clientHeight
    if (!w || !h) return
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    drawRef.current(ctx, w, h)
  }

  const paint = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(paintNow)
  }

  useLayoutEffect(() => {
    drawRef.current = draw
    paintNow()
  })

  useEffect(() => {
    const ro = new ResizeObserver(paint)
    if (ref.current) ro.observe(ref.current)
    return () => { ro.disconnect(); cancelAnimationFrame(frame.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return ref
}

/** Colours from the shadcn theme tokens, so the canvases match the chrome. */
const v = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()
type Theme = Record<'bad' | 'ink' | 'dim' | 'faint' | 'line' | 'sel' | 'fill' | 'off' | 'start' | 'guide' | 'reference' | 'shadow' | 'card' | 'mono', string>
let cached: Theme | null = null
/** Forget cached colours (after a theme switch); canvases pick up the new ones on their next draw. */
export const resetTheme = () => { cached = null }
export const theme = (): Theme => cached ??= {
  bad: v('--destructive'), ink: v('--foreground'), dim: v('--muted-foreground'), faint: v('--secondary'),
  line: v('--border'), sel: v('--accent'), fill: v('--glyph-fill'),
  off: v('--point-off'), start: v('--point-start'), guide: v('--guide'), reference: v('--reference'), shadow: v('--shadow'),
  card: v('--card'),
  mono: getComputedStyle(document.body).getPropertyValue('--font-mono') || 'monospace',
}
