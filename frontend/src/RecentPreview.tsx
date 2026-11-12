import { useEffect, useRef, useState } from 'react'
import { toPath, type RawOutline } from './api'
import { useSettings } from './settings'

type Preview = { em: number; ascent: number; descent: number; glyphs: RawOutline[] }
/** why there is no preview: the file can't be read, or the running backend predates this screen */
type Failed = { failed: 'unreadable' | 'old-backend' }

const SIZE = 104  // the tile is square
const cache = new Map<string, Preview>()  // only successes: a failure is tried again next time the screen shows
// previews open fonts one at a time: a long recent list must not make the worker open twenty fonts at once
let queue: Promise<unknown> = Promise.resolve()

const load = (path: string): Promise<Preview | Failed> => {
  if (cache.has(path)) return Promise.resolve(cache.get(path)!)
  if (path.toLowerCase().endsWith('.svg')) return Promise.resolve<Failed>({ failed: 'unreadable' })  // a drawing, not a font: no "Abg" to set
  const job = queue.then(() => fetch('/api/preview?path=' + encodeURIComponent(path))
    .then(async (r): Promise<Preview | Failed> => {
      if (r.ok) return r.json() as Promise<Preview>
      const j = await r.json().catch(() => ({}))
      return { failed: j.detail === 'Not Found' ? 'old-backend' : 'unreadable' }  // FastAPI's own 404 means the route does not exist
    }).catch((): Failed => ({ failed: 'old-backend' }))
    .then(p => { if (!('failed' in p)) cache.set(path, p); return p }))
  queue = job
  return job
}

/** "Abg" set in the font itself, for the start screen. */
export function RecentPreview({ path, size = SIZE }: { path: string; size?: number }) {
  const [p, setP] = useState<Preview | Failed | undefined>(cache.get(path))
  const canvas = useRef<HTMLCanvasElement>(null)
  const { theme, custom } = useSettings()  // redraw when the colours change

  useEffect(() => {
    let stale = false
    if (cache.has(path)) return
    void load(path).then(v => { if (!stale) setP(v) })
    return () => { stale = true }
  }, [path])

  useEffect(() => {
    const c = canvas.current
    if (!c || !p || 'failed' in p) return
    const dpr = window.devicePixelRatio || 1, W = size, H = size
    c.width = W * dpr; c.height = H * dpr
    const ctx = c.getContext('2d')!
    const adv = p.glyphs.reduce((n, g) => n + g.width, 0) || p.em
    const pad = size < 64 ? 6 : 16
    const s = Math.min((W - pad) / adv, (H - pad) / (p.ascent + p.descent))  // the whole word and the whole line fit
    let x = (W - adv * s) / 2
    const base = (H + (p.ascent - p.descent) * s) / 2
    ctx.fillStyle = getComputedStyle(c).color
    for (const g of p.glyphs) {
      ctx.save(); ctx.setTransform(dpr * s, 0, 0, -dpr * s, dpr * x, dpr * base); ctx.fill(toPath(g)); ctx.restore()
      x += g.width * s
    }
  }, [p, theme, custom, size])

  return (
    <div className="grid shrink-0 place-items-center rounded-lg border bg-background text-foreground" style={{ width: size, height: size }} aria-hidden>
      {p === undefined ? <span className="size-3 animate-pulse rounded-full bg-muted" />
        : 'failed' in p ? <span className="px-1 text-center text-[10px] leading-tight text-muted-foreground">{size < 64 ? '' : p.failed === 'old-backend' ? 'restart Scrifts for previews' : 'no preview'}</span>
          : <canvas ref={canvas} style={{ width: size, height: size }} />}
    </div>
  )
}
