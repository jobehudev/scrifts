// Proofing helpers for the Spacing view: colours, contrast, sizes. Pure, so they can be tested with node.

export type Pair = { fg: string; bg: string }

/** "#rgb" / "#rrggbb" -> [r, g, b] 0-255, or null if it isn't a hex colour. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

/** WCAG 2 relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const rgb = parseHex(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** AAA at 7, AA at 4.5 (normal text), "AA large" at 3, otherwise a fail. */
export function grade(ratio: number): 'AAA' | 'AA' | 'AA large' | 'Fail' {
  return ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'Fail'
}

/** "#rrggbb" at some opacity, as a canvas colour. */
export function withAlpha(hex: string, a: number): string {
  const rgb = parseHex(hex) ?? [0, 0, 0]
  return `rgba(${rgb.join(',')},${a})`
}

export const PRESETS: { name: string; pair: Pair }[] = [
  { name: 'Dark', pair: { fg: '#e8e8e8', bg: '#121212' } },
  { name: 'Light', pair: { fg: '#111111', bg: '#ffffff' } },
  { name: 'Ink on paper', pair: { fg: '#1b1a17', bg: '#f3ecdc' } },
]

export const WATERFALL = [12, 16, 24, 36, 48, 72]

/** Metrics labels (sidebearings, kerning) would clutter below this size. */
export const LABELS_MIN_SIZE = 48

/** Saved swatches: only well-formed pairs survive a bad localStorage value. */
export function readSwatches(raw: string | null): Pair[] {
  try {
    const v = JSON.parse(raw ?? '[]')
    return Array.isArray(v) ? v.filter(p => p && parseHex(p.fg) && parseHex(p.bg)).map(p => ({ fg: p.fg, bg: p.bg })) : []
  } catch { return [] }
}

/** A stroke as its top edge (y-up, font units) and thickness. */
export type Band = { top: number; height: number }

/**
 * Underline from FontForge's upos/uwidth. FontForge keeps upos as the stroke's
 * BOTTOM edge (test_api: upos -120, width 60 compiles to post -90, the centre).
 */
export const underlineBand = (upos: number, uwidth: number): Band => ({ top: upos + uwidth, height: uwidth })

/** Strikeout from OS/2 yStrikeoutPosition (the top of the stroke) and size. */
export const strikeoutBand = (pos: number, size: number): Band => ({ top: pos, height: size })

/** hex -> [h 0-360, s 0-1, v 0-1] */
export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map(v => v / 255)
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b)
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, max === 0 ? 0 : d / max, max]
}

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)) }
  return '#' + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
}
