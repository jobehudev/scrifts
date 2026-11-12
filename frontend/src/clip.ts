// Scrifts' own clipboard for outlines. Kept in memory, and also put on the
// system clipboard as JSON so it survives between windows/tabs of Scrifts.

export type P3 = [number, number, number]
export type GlyphData = { width: number; contours: P3[][]; closed: boolean[]; refs: [string, number[]][]; anchors: unknown[] }
export type Clip =
  | { kind: 'contours'; contours: P3[][]; closed: boolean[]; quadratic: boolean; em?: number }
  | { kind: 'glyph'; name: string; data: GlyphData; quadratic: boolean; em?: number }

let clip: Clip | null = null

export function setClip(c: Clip) {
  clip = c
  navigator.clipboard?.writeText(JSON.stringify({ forge: 1, ...c })).catch(() => {})
}

/** Ours; else the system clipboard if it holds Scrifts outlines (copied in another window). */
export async function getClip(): Promise<Clip | null> {
  if (clip) return clip
  try {
    const j = JSON.parse(await navigator.clipboard.readText())
    if (j?.forge === 1 && (j.kind === 'contours' || j.kind === 'glyph')) return j as Clip
  } catch { /* no permission, or not ours */ }
  return clip
}

export const hasClip = () => clip !== null

/** Contours of any clip, for pasting into an outline. */
export const clipContours = (c: Clip) => c.kind === 'contours' ? { contours: c.contours, closed: c.closed } : { contours: c.data.contours, closed: c.data.closed }
