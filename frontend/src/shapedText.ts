/** Longest stretch sent to the shaper in one piece (the backend reads at most 500 characters). */
export const CHUNK = 400

/**
 * The stretches of plain characters in a Spacing text: the parts the font's features can act on.
 * "/glyphname" (a glyph named on purpose) and line breaks stand alone and split the text, the way `parse` reads it.
 */
export function literalChunks(text: string, glyphNames: Set<string>): string[] {
  const out: string[] = []
  let buf = ''
  const flush = () => { if (buf.trim()) out.push(buf); buf = '' }
  for (let i = 0; i < text.length;) {
    if (text[i] === '\n') { flush(); i++; continue }
    if (text[i] === '/') {
      const m = /^\/([^\s/]+) ?/.exec(text.slice(i))
      if (m && glyphNames.has(m[1])) { flush(); i += m[0].length; continue }
    }
    const ch = String.fromCodePoint(text.codePointAt(i)!)
    buf += ch
    i += ch.length
    if (buf.length >= CHUNK) {  // long text: cut at the last space so a word is never split
      const cut = buf.lastIndexOf(' ')
      if (cut > 0) { out.push(buf.slice(0, cut + 1)); buf = buf.slice(cut + 1) } else flush()
    }
  }
  flush()
  return out
}
