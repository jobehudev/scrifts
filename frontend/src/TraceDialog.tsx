import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, Loader2 } from 'lucide-react'
import { api, type FontInfo } from './api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'

type Preview = { width: number; height: number; threshold: number; d: string; box: [number, number, number, number] | null; contours: number }

/** File ▸ Trace Picture into Glyph: a photo or scan of a letter becomes an outline. */
export function TraceDialog({ open, onClose, font, glyph, onDone }: {
  open: boolean; onClose: () => void; font: FontInfo; glyph: string | null; onDone: () => void
}) {
  const [path, setPath] = useState('')
  const [auto, setAuto] = useState(true)
  const [threshold, setThreshold] = useState(128)
  const [invert, setInvert] = useState(false)
  const [tidy, setTidy] = useState(true)
  const [speck, setSpeck] = useState(4)
  const [smooth, setSmooth] = useState(1)
  const [prev, setPrev] = useState<Preview | null>(null)
  const [base, setBase] = useState(0)       // picture rows of the baseline and the top line
  const [top, setTop] = useState(0)
  const [topKind, setTopKind] = useState('cap')
  const [busy, setBusy] = useState(false)
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<'base' | 'top' | null>(null)

  // FontForge reports a height that is not set as about -1e23: then a usual proportion of the em stands in
  const cap = font.capheight > 0 ? font.capheight : Math.round(font.em * 0.7)
  const xh = font.xheight > 0 ? font.xheight : Math.round(font.em * 0.5)
  const topUnits = { cap, x: xh, asc: font.ascent, em: font.em }[topKind] ?? cap
  const unit = prev ? Math.max(prev.width, prev.height) / 150 : 1  // line and text sizes, in picture pixels, that look the same on any picture
  const params = { path, invert, speck, smooth, ...(auto ? {} : { threshold }) }
  const key = JSON.stringify(params)

  // a fresh preview whenever the picture or a setting changes (after the slider stops moving)
  useEffect(() => {
    if (!open || !path) return
    let stale = false
    const t = window.setTimeout(() => {
      api<Preview>('/api/trace/preview', params).then(p => {
        if (stale) return
        setPrev(old => {
          if (!old || old.width !== p.width || old.height !== p.height) { // a new picture: guides at the ink's own bottom and top
            setBase(p.box ? p.box[3] : p.height * 0.8); setTop(p.box ? p.box[1] : p.height * 0.2)
          }
          return p
        })
        if (auto) setThreshold(p.threshold)
      }).catch(e => { if (!stale) toast.error('Could not read the picture', { description: (e as Error).message }) })
    }, 250)
    return () => { stale = true; window.clearTimeout(t) }
  }, [open, key])  // eslint-disable-line react-hooks/exhaustive-deps

  const browse = async () => {
    const r = await api<{ path: string | null }>('/api/pick', { mode: 'image' })
    if (r.path) { setPath(r.path); setPrev(null) }
  }
  const rowAt = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return Math.max(0, Math.min(prev!.height, ((e.clientY - r.top) / r.height) * prev!.height))
  }
  const trace = async () => {
    if (!glyph) return
    setBusy(true)
    try {
      await api('/api/trace/apply', { ...params, name: glyph, baseline_y: base, top_y: top, top_units: topUnits, tidy })
      toast.success(`Traced into ${glyph}`, { description: 'Undo (Ctrl Z) brings the old outline back.' })
      onDone(); onClose()
    } catch (e) { toast.error('Could not trace', { description: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Trace a picture into {glyph ?? 'a glyph'}</DialogTitle>
          <DialogDescription>
            Pick a photo or scan of one letter, dark ink on light paper works best. The outline in the preview becomes the glyph.
            Drag the two lines to the baseline and to the top of the letter.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm md:grid-cols-[1fr_15rem]">
          <div className="grid min-h-60 place-items-center rounded-md border bg-muted/30 p-1">
            {!path && <Button variant="secondary" onClick={browse}><FolderOpen />Pick a picture…</Button>}
            {path && prev && (
              // the wrapper is exactly as big as the picture, so the outline lines up with it however it is scaled
              <div className="relative inline-block max-w-full leading-none">
                <img alt="" src={`/api/trace/image?path=${encodeURIComponent(path)}`} draggable={false}
                  className="block max-h-[60vh] max-w-full select-none" style={{ imageRendering: prev.width < 500 ? 'pixelated' : 'auto' }} />
                <svg ref={svg} viewBox={`0 0 ${prev.width} ${prev.height}`} className="absolute inset-0 h-full w-full touch-none"
                  onPointerMove={e => { if (drag === 'base') setBase(rowAt(e)); else if (drag === 'top') setTop(rowAt(e)) }}
                  onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
                  <path d={prev.d} fillRule="evenodd" fill="rgba(80,140,255,.4)" stroke="rgb(80,140,255)" strokeWidth={unit / 6} />
                  {([['base', base, 'baseline'], ['top', top, 'top']] as const).map(([k, y, label]) => (
                    <g key={k} className="cursor-ns-resize" onPointerDown={e => { (e.target as Element).setPointerCapture(e.pointerId); setDrag(k) }}>
                      <line x1={0} x2={prev.width} y1={y} y2={y} stroke="rgb(255,90,90)" strokeWidth={unit / 6} strokeDasharray={`${unit} ${unit * 0.6}`} />
                      <line x1={0} x2={prev.width} y1={y} y2={y} stroke="transparent" strokeWidth={unit * 2.5} />
                      <text x={unit / 2} y={y - unit / 2} fill="rgb(255,90,90)" fontSize={unit * 1.6}>{label}</text>
                    </g>
                  ))}
                </svg>
              </div>
            )}
            {path && !prev && <Loader2 className="animate-spin text-muted-foreground" />}
          </div>
          <div className="grid content-start gap-3">
            <Button variant="secondary" size="sm" onClick={browse}><FolderOpen />{path ? 'Another picture…' : 'Pick a picture…'}</Button>
            <div className="grid gap-1">
              <Label className="flex justify-between"><span>Ink threshold</span>
                <label className="flex items-center gap-1 font-normal"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />automatic</label></Label>
              <input type="range" min={20} max={235} value={threshold} disabled={auto} onChange={e => setThreshold(Number(e.target.value))} aria-label="Ink threshold" />
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={invert} onChange={e => setInvert(e.target.checked)} />Light ink on dark paper</label>
            <div className="grid gap-1">
              <Label>Ignore specks up to {speck} px</Label>
              <input type="range" min={0} max={60} value={speck} onChange={e => setSpeck(Number(e.target.value))} aria-label="Ignore specks" />
            </div>
            <div className="grid gap-1">
              <Label>Smoothness: {smooth <= 0.05 ? 'corners' : smooth >= 1.3 ? 'rounded' : smooth.toFixed(2)}</Label>
              <input type="range" min={0} max={1.33} step={0.01} value={smooth} onChange={e => setSmooth(Number(e.target.value))} aria-label="Smoothness" />
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={tidy} onChange={e => setTidy(e.target.checked)} />Fewer points (FontForge simplifies)</label>
            <div className="grid gap-1">
              <Label htmlFor="trace-top">The top line is the…</Label>
              <Select id="trace-top" value={topKind} onChange={e => setTopKind(e.target.value)}>
                <option value="cap">cap height ({cap})</option>
                <option value="x">x-height ({xh})</option>
                <option value="asc">ascender ({font.ascent})</option>
                <option value="em">full em ({font.em})</option>
              </Select>
            </div>
            {prev && <p className="text-xs text-muted-foreground">{prev.contours} shape{prev.contours === 1 ? '' : 's'} found.{prev.contours === 0 && ' Try another threshold.'}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={trace} disabled={busy || !glyph || !prev || prev.contours === 0}>{busy && <Loader2 className="animate-spin" />}Trace into {glyph ?? '…'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
