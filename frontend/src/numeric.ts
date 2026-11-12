import { useRef, useState } from 'react'

/** Shift: ten times as much, Alt: a tenth. */
export const stepOf = (e: { shiftKey: boolean; altKey: boolean }, base = 1) => base * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1)

/** No 0.30000000000000004: two decimals at most. */
export const clean = (n: number) => Math.round(n * 100) / 100

/** The value after dragging `dx` pixels from `start`: whole units normally, tenths with Alt. */
export function scrubbed(start: number, dx: number, e: { shiftKey: boolean; altKey: boolean }, base = 1): number {
  const raw = start + dx * stepOf(e, base)
  return e.altKey ? Math.round(raw * 10) / 10 : Math.round(raw)
}

/**
 * Drag a number's label sideways to change it (right = more), like in Figma or Illustrator. Nothing is applied
 * until you let go, so a drag is one edit and one undo step; `preview` is what to show meanwhile.
 * A click without dragging calls `onClick` (to focus the field).
 */
export function useScrub(value: number, commit: (n: number) => void, opts: { base?: number; disabled?: boolean; onClick?: () => void } = {}) {
  const [preview, setPreview] = useState<number | null>(null)
  const from = useRef<{ x: number; v: number; moved: boolean } | null>(null)
  const bind = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || opts.disabled) return
      e.preventDefault()  // no text selection while dragging
      e.currentTarget.setPointerCapture(e.pointerId)
      from.current = { x: e.clientX, v: value, moved: false }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = from.current
      if (!s || (!s.moved && Math.abs(e.clientX - s.x) < 3)) return
      s.moved = true
      setPreview(scrubbed(s.v, e.clientX - s.x, e, opts.base))
    },
    onPointerUp: () => {
      const s = from.current
      from.current = null
      if (!s) return
      if (!s.moved) opts.onClick?.()
      else if (preview !== null && preview !== s.v) commit(preview)
      setPreview(null)
    },
    className: opts.disabled ? '' : 'cursor-ew-resize select-none',
    title: opts.disabled ? undefined : 'Drag sideways to change (Shift: ×10, Alt: ×0.1)',
  }
  return { preview, bind }
}
