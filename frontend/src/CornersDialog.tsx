import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { CORNER_KINDS, type CornerKind } from './corners'

/** Illustrator's Corners dialog (double-click a corner widget): the corner type and the radius, with a live preview while it is open. */
export function CornersDialog({ open, onClose, kind, radius, onPreview, onApply }: {
  open: boolean; onClose: () => void; kind: CornerKind; radius: number
  onPreview: (kind: CornerKind, radius: number) => void; onApply: (kind: CornerKind, radius: number) => void
}) {
  const [k, setK] = useState(kind), [r, setR] = useState(radius)
  const change = (nk: CornerKind, nr: number) => { setK(nk); setR(nr); onPreview(nk, nr) }
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader><DialogTitle>Corners</DialogTitle></DialogHeader>
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (r > 0) onApply(k, r) }}>
          <div className="grid gap-1.5">
            <Label htmlFor="cd-kind">Corner type</Label>
            <Select id="cd-kind" value={k} onChange={e => change(e.target.value as CornerKind, r)} className="h-8">
              {CORNER_KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cd-radius">Radius (font units)</Label>
            <Input id="cd-radius" type="number" min={0} autoFocus className="h-8 font-mono" value={r} onChange={e => change(k, Math.max(0, Number(e.target.value) || 0))} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={r <= 0}>OK</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
