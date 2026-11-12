import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, outlines, type FontInfo, type Points } from './api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'

/** A glyph between two others (a thin and a bold stem, say): needs the same contours and points in both. */
export function InterpolateDialog({ open, onOpenChange, font, sel, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; font: FontInfo; sel: string | null; onDone: (name: string) => void
}) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [name, setName] = useState('')
  const [t, setT] = useState(0.5)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start each time from the selected glyph
    if (open) { setA(sel ?? ''); setB(''); setName(''); setT(0.5) }
  }, [open, sel])

  const names = new Set(font.glyphs.map(g => g.name))
  const problem = !names.has(a) ? 'The first glyph is not in the font.' : !names.has(b) ? 'The second glyph is not in the font.'
    : !name.trim() ? 'Name the glyph that gets the result.' : name === a || name === b ? 'The result needs its own glyph.' : null

  const run = async () => {
    setBusy(true)
    try {
      const res = await api<Points>('/api/interpolate', { a, b, t, name: name.trim() })
      outlines.putPoints(res)
      outlines.put(res, null)
      outlines.invalidateUsers(res.name)
      toast.success(`${name.trim()} is ${Math.round((1 - t) * 100)}% ${a} and ${Math.round(t * 100)}% ${b}`)
      onDone(res.name)
      onOpenChange(false)
    } catch (e) {
      toast.error('Could not interpolate', { description: (e as Error).message })
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Interpolate Glyphs</DialogTitle>
          <DialogDescription>
            Makes a glyph between two others. They need exactly the same contours and points, as masters do. An existing result glyph is overwritten (Ctrl Z in the editor undoes it).
          </DialogDescription>
        </DialogHeader>
        <datalist id="interp-glyphs">{font.glyphs.map(g => <option key={g.name} value={g.name} />)}</datalist>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="grid gap-1.5"><Label htmlFor="ip-a">From (0)</Label><Input id="ip-a" list="interp-glyphs" className="h-8 font-mono" value={a} onChange={e => setA(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ip-b">To (1)</Label><Input id="ip-b" list="interp-glyphs" className="h-8 font-mono" value={b} onChange={e => setB(e.target.value)} /></div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="w-16 shrink-0">Amount</span>
          <Slider min={0} max={1} step={0.01} value={[t]} onValueChange={v => setT(v[0])} />
          <span className="w-10 text-right font-mono">{t.toFixed(2)}</span>
        </div>
        <div className="grid gap-1.5 text-sm"><Label htmlFor="ip-name">Result glyph</Label>
          <Input id="ip-name" list="interp-glyphs" className="h-8 font-mono" value={name} placeholder="e.g. a.mid" onChange={e => setName(e.target.value)} /></div>
        {problem && <p className="text-xs text-muted-foreground">{problem}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!!problem || busy} onClick={() => void run()}>Interpolate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
