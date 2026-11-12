import { useSyncExternalStore } from 'react'
import type { Cap, Join, StrokeSpec } from './strokes'
import type { CornerKind } from './corners'
import type { SvgStyle } from './svgStyle'

/**
 * What the Properties panel shows: the glyph editor that was used last publishes it, the panel reads it.
 * (The editor keeps all the state; this is only a window onto it, so the panel can sit anywhere in the dock.)
 */
export type Box = { x: number; y: number; w: number; h: number }
export type PenSettings = { on: boolean } & StrokeSpec

export type PropsState = {
  glyph: string | null
  tool: string
  editable: boolean              // false away from the default master: nothing can be changed there
  box: Box | null                // of the selection, or of the whole glyph when nothing is selected
  scope: 'selection' | 'glyph'
  points: number                 // selected points (all of them when nothing is selected)
  shapes: number
  svg: SvgStyle | 'none' | null   // an .svg drawing: the colours of the selected shape ('none': nothing selected), else null
  pen: PenSettings               // what the pen draws next
  shownStroke: StrokeSpec        // the selected stroke's settings, or the pen's
  selStrokes: number
  strokes: number                // strokes in the glyph
  vis: { guides: boolean; shadow: boolean; smart: boolean; grid: boolean; rulers: boolean }  // view aids, for the View menu's checkmarks
}

export type PropsActions = {
  setAppearance: (patch: Partial<SvgStyle>) => void
  setBox: (patch: Partial<Box>) => void
  rotate: (degrees: number) => void  // counter-clockwise, about the middle of the selection
  setStroke: (patch: Partial<StrokeSpec> & { on?: boolean }) => void
  expand: () => void
  changeWeight: (delta: number) => void  // make the whole glyph thicker (+) or thinner (-) by this many units, no points added or removed
  roundCorners: (radius: number, kind: CornerKind) => void  // the selected corner points, or every corner when nothing is selected
}

let state: PropsState | null = null
let actions: PropsActions | null = null
let owner: unknown = null
const subs = new Set<() => void>()
const emit = () => subs.forEach(f => f())

export const propsStore = {
  publish(by: unknown, s: PropsState, a: PropsActions) { owner = by; state = s; actions = a; emit() },
  clear(by: unknown) { if (owner === by) { owner = null; state = null; actions = null; emit() } },
  get: () => state,
  actions: () => actions,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f) } },
}

export const useProps = () => useSyncExternalStore(propsStore.subscribe, propsStore.get)
export type { Cap, Join }
