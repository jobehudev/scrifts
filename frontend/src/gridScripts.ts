import { SCRIPTS, scriptName } from './scripts'

/** The characters an OpenType script's slots cover in the glyph grid (Basic Multilingual Plane, as the grid is). Keyed by script tag. */
export const BLOCKS: Record<string, [number, number][]> = {
  latn: [[0x20, 0x7e], [0xa0, 0xff], [0x100, 0x17f], [0x180, 0x24f], [0x1e00, 0x1eff], [0x2000, 0x206f], [0x20a0, 0x20bf]],
  cyrl: [[0x400, 0x4ff], [0x500, 0x52f]],
  grek: [[0x370, 0x3ff], [0x1f00, 0x1fff]],
  arab: [[0x600, 0x6ff], [0x750, 0x77f], [0x8a0, 0x8ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]],
  hebr: [[0x590, 0x5ff], [0xfb1d, 0xfb4f]],
  armn: [[0x530, 0x58f]],
  geor: [[0x10a0, 0x10ff]],
  hani: [[0x3000, 0x303f], [0x3400, 0x4dbf], [0x4e00, 0x9fff]],
  kana: [[0x3040, 0x309f], [0x30a0, 0x30ff]],
  hang: [[0x1100, 0x11ff], [0x3130, 0x318f], [0xac00, 0xd7a3]],
  dev2: [[0x900, 0x97f]],
  bng2: [[0x980, 0x9ff]],
  taml: [[0xb80, 0xbff]],
  thai: [[0xe00, 0xe7f]],
  khmr: [[0x1780, 0x17ff]],
  tibt: [[0xf00, 0xfff]],
}

/** The scripts the grid can show slots for. */
export const GRID_SCRIPTS = SCRIPTS.filter(s => BLOCKS[s.tag])
export const shortName = (tag: string) => scriptName(tag).split(' (')[0]
export const slotCount = (tag: string) => (BLOCKS[tag] ?? []).reduce((n, [a, b]) => n + b - a + 1, 0)

/** The slots of these scripts, as sorted, merged ranges. */
export function rangesFor(tags: string[]): [number, number][] {
  const all = tags.flatMap(t => BLOCKS[t] ?? []).sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const [a, b] of all) {
    const last = out.at(-1)
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** Which of the grid's scripts have at least one glyph in the font. */
export function scriptsInFont(glyphs: { unicode: number }[]): string[] {
  return GRID_SCRIPTS.map(s => s.tag).filter(t => BLOCKS[t].some(([a, b]) => glyphs.some(g => g.unicode >= a && g.unicode <= b)))
}

const key = (family: string) => `forge.scripts.${family}`
/** The scripts picked for this font family; the settings' default for one that was never set. */
export function loadScripts(family: string, fallback: string[]): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(family)) ?? 'null')
    if (Array.isArray(v)) return v.filter((t): t is string => typeof t === 'string' && !!BLOCKS[t])
  } catch { /* fall through */ }
  return fallback
}
export const saveScripts = (family: string, tags: string[]) => localStorage.setItem(key(family), JSON.stringify(tags))
