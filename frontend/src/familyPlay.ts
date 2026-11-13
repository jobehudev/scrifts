import { useEffect, useMemo, useRef, useState } from 'react'
import type { Family } from './FamilyBar'
import { blendStore } from './blendStore'
import { FPS } from './VariableBar'

/**
 * Play for a family of masters, shared by the family bar and the Axes panel: the weight sweeps from end to end and back in
 * 4 seconds at FPS steps a second. Pressing Play first fetches what is on screen at every weight on the way, so the sweep
 * itself only reads the cache. `setWeight(w, true)` moves the views at once; null (and the end) puts the preview away.
 */
export function useFamilyPlay(family: Family | null, axisVals: Record<string, number>, quadratic: boolean, setWeight: (w: number | null, instant?: boolean) => void) {
  const ax = family?.axes[0]
  const frames = useMemo(() => {
    if (!ax || ax.max <= ax.min) return []
    const half = 2 * FPS  // up for two seconds, down for two: even steps
    return Array.from({ length: 2 * half }, (_, i) => Math.round(ax.min + (ax.max - ax.min) * (i <= half ? i / half : (2 * half - i) / half)))
  }, [ax])
  const [playing, setPlaying] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const cancel = useRef({ cancelled: false })
  const stop = () => { cancel.current.cancelled = true; setPlaying(false); setPreparing(false) }
  const toggle = async () => {
    if (playing || preparing) { stop(); return }
    if (!family || !frames.length) return
    const token = cancel.current = { cancelled: false }
    setPreparing(true)
    try { await blendStore.prefetch({ family: family.path, location: axisVals, quadratic }, [...new Set(frames)], token) } catch { /* play anyway: it fetches what is missing as it goes */ }
    if (token.cancelled) return
    setPreparing(false); setPlaying(true)
  }
  useEffect(() => {
    if (!playing || !frames.length) return
    let i = 0
    const id = window.setInterval(() => {
      if (i >= frames.length) { window.clearInterval(id); setWeight(null, true); setPlaying(false); return }
      setWeight(frames[i++], true)
    }, 1000 / FPS)
    return () => window.clearInterval(id)
  }, [playing, frames, setWeight])
  useEffect(() => stop, [family?.path])  // eslint-disable-line react-hooks/exhaustive-deps
  return { playing, preparing, toggle, stop, steps: [...new Set(frames)], can: frames.length > 0 && (family?.masters.length ?? 0) > 1 }
}
export type FamilyPlay = ReturnType<typeof useFamilyPlay>
