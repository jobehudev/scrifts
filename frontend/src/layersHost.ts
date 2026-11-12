import { createContext } from 'react'

/**
 * Where the Layers panel is drawn. `undefined`: nobody hosts it, so the editor
 * floats it over the canvas. An element: the dock's Layers panel, and the
 * editor draws into it (its state stays in the editor). `null`: the dock has
 * hosting but the panel is closed, so nothing is shown.
 */
export const LayersHost = createContext<HTMLElement | null | undefined>(undefined)
