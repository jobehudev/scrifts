import { useEffect, useRef } from 'react'

/**
 * Menu commands handled by whichever view owns them (the glyph editor, the
 * grid). The menu bar only names the action; the view that is on screen
 * does it with its own state, so there is one implementation per action.
 */
export type Command =
  | 'undo' | 'redo' | 'restore' | 'selectAll' | 'deselect' | 'delete'
  | 'roundCorners' | 'flipH' | 'flipV' | 'rotCW' | 'rotCCW'
  | 'union' | 'subtract' | 'intersect' | 'mergeAll' | 'fixDirection'
  | 'addExtrema' | 'simplify' | 'roundCoords' | 'addInflections' | 'balance' | 'harmonize' | 'bolder' | 'lighter' | 'cleanUp' | 'clearGlyph' | 'build' | 'draftLigature' | 'import'
  | 'fit' | 'zoomIn' | 'zoomOut' | 'toggleGrid' | 'toggleRulers' | 'toggleSmart' | 'toggleGuides' | 'toggleShadow'
  | 'tool:object' | 'tool:select' | 'tool:pen' | 'tool:rect' | 'tool:oval' | 'tool:shaper' | 'tool:hand' | 'tool:zoom' | 'tool:measure'
  | 'grid:font' | 'grid:latin' | 'grid:unicode'

export const command = (c: Command) => window.dispatchEvent(new CustomEvent<Command>('forge:cmd', { detail: c }))

export function useCommands(handle: (c: Command) => void) {
  const ref = useRef(handle)
  useEffect(() => { ref.current = handle })
  useEffect(() => {
    const f = (e: Event) => ref.current((e as CustomEvent<Command>).detail)
    window.addEventListener('forge:cmd', f)
    return () => window.removeEventListener('forge:cmd', f)
  }, [])
}
