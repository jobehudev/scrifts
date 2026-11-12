// Themes from two colours. Pure, so the maths can be tested; settings.ts puts the result on <html>.
import { contrast, hexToHsv, hsvToHex, parseHex } from './proof.ts'

export type Custom = { bg: string; accent: string }

const hex2 = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')

/** a moved t of the way towards b, in sRGB */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a) ?? [0, 0, 0], y = parseHex(b) ?? [0, 0, 0]
  return '#' + [0, 1, 2].map(i => hex2(x[i] + (y[i] - x[i]) * t)).join('')
}

/** Mixes `from` towards `to` just far enough to reach `ratio` against `bg`. */
function reach(from: string, to: string, bg: string, ratio: number): string {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(from, to, t)
    if (contrast(c, bg) >= ratio) return c
  }
  return to
}

/** Black or white text, whichever reads better on `bg`. */
export const readableOn = (bg: string) => (contrast('#ffffff', bg) >= contrast('#000000', bg) ? '#ffffff' : '#000000')

export type Derived = { dark: boolean; vars: Record<string, string> }

/**
 * Every colour the interface uses, from a background and an accent. Text and
 * lines are the background pushed towards black or white (tinted by it, so it
 * stays easy on the eyes); each pairing is nudged until it keeps a readable
 * contrast. `mono` drops all hue from the drawing colours (e-ink).
 */
export function deriveTokens({ bg, accent }: Custom, mono = false): Derived {
  const pole = readableOn(bg)  // white on dark backgrounds, black on light ones; on a mid grey, whichever reads better
  const dark = pole === '#ffffff'
  const fg = reach(mix(bg, pole, 0.86), pole, bg, 9)
  const card = mix(bg, pole, dark ? 0.045 : 0.035)
  const soft = mix(bg, pole, dark ? 0.1 : 0.07)
  const muted = reach(mix(fg, bg, 0.45), fg, bg, 4.5)
  const primary = reach(accent, fg, bg, 3)
  const onPrimary = readableOn(primary)
  const border = mix(bg, pole, dark ? 0.16 : 0.14)
  // drawing colours: the accent's hue turned round the wheel, bright on dark and deep on light
  const [h, s] = hexToHsv(primary)
  const draw = (turn: number, sat = Math.max(0.55, s)) => hsvToHex(((h + turn) % 360 + 360) % 360, mono ? 0 : Math.min(1, sat), dark ? 0.92 : 0.62)
  const vars: Record<string, string> = {
    '--background': bg, '--foreground': fg,
    '--card': card, '--card-foreground': fg, '--popover': card, '--popover-foreground': fg,
    '--primary': primary, '--primary-foreground': onPrimary,
    '--secondary': soft, '--secondary-foreground': fg,
    '--muted': soft, '--muted-foreground': muted,
    '--accent': soft, '--accent-foreground': fg,
    '--destructive': dark ? '#f87171' : '#c62828',
    '--border': border, '--input': mix(bg, pole, dark ? 0.22 : 0.2), '--ring': primary,
    '--sidebar': card, '--sidebar-foreground': fg, '--sidebar-primary': primary, '--sidebar-primary-foreground': onPrimary,
    '--sidebar-accent': soft, '--sidebar-accent-foreground': fg, '--sidebar-border': border, '--sidebar-ring': primary,
    '--glyph-fill': mix(bg, pole, dark ? 0.2 : 0.16),
    '--point-start': mono ? fg : primary, '--point-off': draw(70), '--guide': draw(150), '--reference': draw(200), '--shadow': draw(120),
  }
  return { dark, vars }
}

/** Ink: paper and black, no colour, no shades that an e-ink screen would smear. */
export const INK: Custom = { bg: '#ecebe4', accent: '#111111' }
export const inkTokens = () => deriveTokens(INK, true)

/** Starting points for a custom theme that are easy on the eyes. */
export const CUSTOM_PRESETS: { name: string; theme: Custom }[] = [
  { name: 'Midnight', theme: { bg: '#1b2030', accent: '#7aa2f7' } },
  { name: 'Sepia', theme: { bg: '#f1e7d0', accent: '#a0522d' } },
  { name: 'Forest', theme: { bg: '#1c2a22', accent: '#8fd3a4' } },
  { name: 'Dusk', theme: { bg: '#2a2438', accent: '#e0a3d9' } },
  { name: 'Slate', theme: { bg: '#e4e8ee', accent: '#2f5fa8' } },
]
