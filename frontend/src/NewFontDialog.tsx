import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type NewFont = { family: string; style: string; em: number; quadratic: boolean }

/** Name, style, units per em, outline type. Where to save is asked next, natively. */
export function NewFontDialog({ open, onOpenChange, onCreate }: {
  open: boolean; onOpenChange: (o: boolean) => void; onCreate: (f: NewFont) => void
}) {
  const [family, setFamily] = useState('')
  const [style, setStyle] = useState('Regular')
  const [em, setEm] = useState(1000)
  const [quadratic, setQuadratic] = useState(false)
  const ok = family.trim().length > 0 && em >= 16 && em <= 16384

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New font</DialogTitle>
          <DialogDescription>Starts with .notdef and space. Add letters from the grid's Latin view.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={e => { e.preventDefault(); if (ok) onCreate({ family: family.trim(), style: style.trim() || 'Regular', em, quadratic }) }}>
          <div className="grid gap-1.5">
            <Label htmlFor="nf-family">Family name</Label>
            <Input id="nf-family" autoFocus value={family} onChange={e => setFamily(e.target.value)} placeholder="My Sans" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nf-style">Style</Label>
            <Input id="nf-style" value={style} onChange={e => setStyle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nf-em">Units per em</Label>
            <div className="flex gap-2">
              <Input id="nf-em" type="number" value={em} onChange={e => setEm(+e.target.value)} className="w-28 font-mono" />
              {[1000, 2048].map(v => (
                <Button key={v} type="button" size="sm" variant={em === v ? 'secondary' : 'ghost'} onClick={() => setEm(v)}>{v}</Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">1000 is usual for OpenType (CFF), 2048 for TrueType.</span>
          </div>
          <div className="grid gap-1.5">
            <Label>Outlines</Label>
            <Tabs value={quadratic ? 'q' : 'c'} onValueChange={v => setQuadratic(v === 'q')}>
              <TabsList className="w-full">
                <TabsTrigger value="c" className="text-xs">Cubic (PostScript / OTF)</TabsTrigger>
                <TabsTrigger value="q" className="text-xs">Quadratic (TrueType)</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!ok}>Create and choose location…</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
