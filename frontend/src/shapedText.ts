/** Longest stretch sent to the shaper in one piece (the backend reads at most 500 characters). */
export const CHUNK = 400

/** Right-to-left scripts: Hebrew, Arabic, Syriac, Thaana, N'Ko and their presentation forms. */
export const isRtl = (ch: string) => /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(ch)
/** Scripts that cannot be set one glyph per character: right-to-left ones, and the Indic and South-East Asian ones, which reorder and join. */
export const isComplex = (ch: string) => isRtl(ch) || /[ऀ-෿฀-໿ༀ-࿿က-႟ក-៿]/.test(ch)
export type Dir = 'rtl' | 'cplx' | 'ltr' | 'neutral'
/** The kind of run a character belongs to: right-to-left, an Indic or South-East Asian script (shaped together, left to right), or plain letters.
 *  Spaces, digits and punctuation are 'neutral' and take the run they are in. */
export const dirOf = (ch: string): Dir => (isRtl(ch) ? 'rtl' : isComplex(ch) ? 'cplx' : /\p{L}/u.test(ch) ? 'ltr' : 'neutral')

/**
 * The stretches of plain characters in a Spacing text: the parts the font's features and the shaper can act on.
 * "/glyphname" (a glyph named on purpose) and line breaks stand alone and split the text, the way `parse` reads it; so does a
 * change of direction (Latin words inside Arabic are shaped apart from it). `complexOnly`: just the stretches that need shaping
 * to be set at all (right-to-left, Indic ...).
 */
export function literalChunks(text: string, glyphNames: Set<string>, complexOnly = false): string[] {
  const out: string[] = []
  let buf = '', dir: Dir | null = null
  const flush = () => { if (buf.trim() && (!complexOnly || [...buf].some(isComplex))) out.push(buf); buf = ''; dir = null }
  for (let i = 0; i < text.length;) {
    if (text[i] === '\n') { flush(); i++; continue }
    if (text[i] === '/') {
      const m = /^\/([^\s/]+) ?/.exec(text.slice(i))
      if (m && glyphNames.has(m[1])) { flush(); i += m[0].length; continue }
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    const d = dirOf(ch)
    if (d !== 'neutral') { if (dir && d !== dir) flush(); dir = d }
    buf += ch
    i += ch.length
    if (buf.length >= CHUNK) {  // long text: cut at the last space so a word is never split
      const cut = buf.lastIndexOf(' ')
      if (cut > 0) { const tail = buf.slice(cut + 1), keep: Dir | null = dir; buf = buf.slice(0, cut + 1); flush(); buf = tail; dir = keep } else flush()
    }
  }
  flush()
  return out
}
