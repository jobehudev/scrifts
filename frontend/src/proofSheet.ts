// A proof sheet to print or save as PDF: the sample text at a run of sizes, then every drawn glyph.
// The letters are the font's own outlines (vector), placed by HarfBuzz through /api/shape, so kerning and
// features are what the generated font will do. It goes through the system's print dialog ("Save as PDF" is a
// printer there), so no PDF library is needed.
import type { FontInfo } from './api'

type Raw = { d: string; refs?: { ref: string; t: number[]; d: Raw }[] }
type RawOutline = Raw & { name: string; width: number }
type Shaped = { name: string; ax: number; dx: number; dy: number }[]

const W = 595, H = 842, M = 42  // A4 in points, and the margin
const SIZES = [72, 48, 36, 24, 18, 14, 12, 10, 8]
const DEFAULT_TEXT = 'Hamburgefontsiv The quick brown fox jumps over the lazy dog 0123456789'
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const paths = (raw: Raw): string =>
  (raw.d.trim() ? `<path d="${raw.d}"/>` : '') + (raw.refs ?? []).map(r => `<g transform="matrix(${r.t.join(' ')})">${paths(r.d)}</g>`).join('')

/** The pages as SVG (one per page). Exported for the test; `printProof` is what the menu calls. */
export function proofPages(font: FontInfo, shaped: Shaped, outlines: Map<string, RawOutline>, text: string, when: string): string[] {
  const pages: string[] = []
  let body = '', y = 0
  const head = (n: number) => `<text x="${M}" y="${M - 14}" class="h">${esc(font.familyname || font.fontname)} · ${esc(font.fontname)} · ${esc(when)}</text>`
    + `<text x="${W - M}" y="${M - 14}" class="h" text-anchor="end">${n}</text>`
  const flush = () => {
    pages.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}pt" height="${H}pt">${head(pages.length + 1)}${body}</svg>`)
    body = ''; y = M
  }
  const need = (h: number) => { if (y + h > H - M) flush() }
  const glyph = (name: string, x: number, base: number, s: number) => {
    const o = outlines.get(name)
    return o ? `<g transform="translate(${x.toFixed(2)} ${base.toFixed(2)}) scale(${s} ${-s})">${paths(o)}</g>` : ''
  }
  y = M

  // the sample at every size; a line that does not fit is cut at the margin, as a waterfall is
  for (const size of SIZES) {
    const s = size / font.em, line = size * 1.25
    need(line + 10)
    body += `<text x="${M}" y="${y + 7}" class="l">${size} pt</text>`
    let x = M
    const base = y + 10 + font.ascent * s
    for (const g of shaped) {
      if (x + g.ax * s > W - M) break
      body += glyph(g.name, x + g.dx * s, base - g.dy * s, s)
      x += g.ax * s
    }
    y += line + 14
  }

  // every drawn glyph, in the font's order, with its name
  const size = 26, s = size / font.em, cell = 43, rowH = 56, cols = Math.floor((W - 2 * M) / cell)
  const drawn = font.glyphs.filter(g => { const o = outlines.get(g.name); return o && (o.d.trim() || o.refs?.length) })
  need(rowH + 24)
  body += `<text x="${M}" y="${y + 8}" class="l">${drawn.length} glyphs</text>`
  y += 18
  drawn.forEach((g, i) => {
    const c = i % cols
    if (c === 0 && i) y += rowH
    if (c === 0) need(rowH)
    const o = outlines.get(g.name)!
    const x = M + c * cell
    body += glyph(g.name, x + (cell - o.width * s) / 2, y + 6 + font.ascent * s, s)
    body += `<text x="${x + cell / 2}" y="${y + rowH - 6}" class="n" text-anchor="middle">${esc(g.name.length > 9 ? g.name.slice(0, 8) + '…' : g.name)}</text>`
  })
  if (body) flush()
  void text
  return pages
}

/** Build the proof of the open font and hand it to the print dialog. */
export async function printProof(font: FontInfo, sample?: string): Promise<number> {
  // the Spacing view's text if it is plain text (its /name tokens are not something HarfBuzz reads)
  const kept = sample ?? localStorage.getItem('forge.spacing') ?? ''
  const text = (kept && !kept.includes('/') ? kept : DEFAULT_TEXT).slice(0, 200)
  const { api } = await import('./api')  // not at the top: the page builder above is tested without a browser
  const shaped = await api<Shaped>('/api/shape', { text, features: {} })
  const names = font.glyphs.map(g => g.name)
  const raw = await api<RawOutline[]>('/api/outlines', { names, location: null })
  const pages = proofPages(font, shaped, new Map(raw.map(o => [o.name, o])), text, new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(font.fontname)} proof</title><style>
@page { size: A4; margin: 0 } html, body { margin: 0 } svg { display: block; page-break-after: always; break-after: page }
.h { font: 7pt system-ui, sans-serif; fill: #666 } .l { font: 6pt system-ui, sans-serif; fill: #888 } .n { font: 5pt ui-monospace, monospace; fill: #666 }
</style></head><body>${pages.join('')}</body></html>`
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  frame.srcdoc = html
  await new Promise<void>(done => { frame.onload = () => done(); document.body.appendChild(frame) })
  const w = frame.contentWindow!
  w.addEventListener('afterprint', () => frame.remove())
  w.focus()
  w.print()
  return pages.length
}
