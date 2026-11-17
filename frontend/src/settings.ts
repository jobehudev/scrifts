import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { resetTheme } from './canvas'
import { deriveTokens, inkTokens, type Custom } from './theme'

/** UI preferences. Local to this machine; nothing here touches the font. */
export type Settings = {
  theme: 'dark' | 'light' | 'ink' | 'custom'
  custom: Custom           // the two colours of the custom theme: background and accent
  uiScale: number          // percent of the base 12px type
  uiFont: 'default' | 'system' | 'serif' | 'project'  // 'project' = the open font, compiled live by FontForge
  nudge: number            // arrow keys, font units
  nudgeBig: number         // Shift + arrows
  gridCell: number         // minimum glyph-grid cell, px
  gridStyle: 'dots' | 'lines'  // glyph editor background grid style
  snapToGrid: boolean      // also snap points to grid steps when smart guides are active
  reopenLast: boolean      // open the most recent font on start
  autosave: boolean        // save .sfd projects in place a few seconds after a change
  scripts: string[]        // OpenType script tags whose slots a new font starts with in the glyph grid
  skipAsk: string[]        // prompts answered with "Don't ask again" (keys from confirm.tsx); empty = ask every time
}

export const DEFAULTS: Settings = {
  theme: 'dark', custom: { bg: '#1b2030', accent: '#7aa2f7' }, uiScale: 100, uiFont: 'default', nudge: 1, nudgeBig: 10, gridCell: 64, gridStyle: 'dots', snapToGrid: false, reopenLast: false, autosave: true, scripts: ['latn'], skipAsk: [],
}

const KEY = 'scrifts.settings'
let current: Settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return DEFAULTS }
})()
const subs = new Set<() => void>()

/** Theme and interface size go on <html> before anything re-renders, so
 *  canvases never draw new state with old colours. */
let painted: string[] = []  // the colour variables a theme set on <html> itself, to clear when the theme changes
function apply(s: Settings) {
  const root = document.documentElement
  for (const k of painted) root.style.removeProperty(k)
  painted = []
  // Dark and Light are the stylesheet's own; Ink and Custom are worked out from their colours
  const derived = s.theme === 'ink' ? inkTokens() : s.theme === 'custom' ? deriveTokens(s.custom) : null
  if (derived) for (const [k, v] of Object.entries(derived.vars)) { root.style.setProperty(k, v); painted.push(k) }
  root.classList.toggle('dark', derived ? derived.dark : s.theme === 'dark')
  root.dataset.theme = s.theme
  document.documentElement.style.fontSize = `${s.uiScale}%`
  resetTheme()
}
apply(current)

export const getSettings = () => current

export const UI_SCALE = { min: 70, max: 200, step: 10 }
/** Interface zoom for the keyboard and the View menu: +1 / -1 a step, 0 back to 100%. Says the new size. */
export function zoomUi(dir: -1 | 0 | 1) {
  const next = dir === 0 ? 100 : Math.min(UI_SCALE.max, Math.max(UI_SCALE.min, Math.round(current.uiScale / UI_SCALE.step) * UI_SCALE.step + dir * UI_SCALE.step))
  setSettings({ uiScale: next })
  toast.message(`Interface ${next}%`, { id: 'ui-zoom', duration: 900 })
}

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  localStorage.setItem(KEY, JSON.stringify(current))
  apply(current)
  subs.forEach(f => f())
}

export const useSettings = () => useSyncExternalStore(
  f => { subs.add(f); return () => { subs.delete(f) } },
  () => current,
)
