import { useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, Loader2 } from 'lucide-react'
import { api, type FontInfo } from './api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const DEFAULT_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;!?\'"-()&@'
const PER_PAGE = 48
type Cell = { char: string; d: string; w: number; h: number; glyph?: string }
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '')
const pageCount = (chars: string) => Math.max(1, Math.ceil(new Set([...chars].filter(c => c.trim())).size / PER_PAGE))

/** File ▸ Template Sheet: print pages to write letters on, then read a scan or photo of them back into glyphs. */
export function SheetDialog({ open, onClose, font, onDone }: { open: boolean; onClose: () => void; font: FontInfo; onDone: () => void }) {
  const [tab, setTab] = useState<'make' | 'read'>('make')
  const [chars, setChars] = useState(() => localStorage.getItem('scrifts.sheetChars') ?? DEFAULT_CHARS)
  const [folder, setFolder] = useState(() => localStorage.getItem('scrifts.sheetFolder') ?? `${dirOf(font.path)}\\${font.familyname} sheets`)
  const [made, setMade] = useState<{ pdf: string; files: string[] } | null>(null)
  const [scan, setScan] = useState('')
  const [page, setPage] = useState(1)
  const [threshold, setThreshold] = useState(140)
  const [cells, setCells] = useState<Cell[] | null>(null)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const pages = pageCount(chars)
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: (e as Error).message })

  const browseFolder = async () => {
    const r = await api<{ path: string | null }>('/api/pick', { mode: 'folder', initial: folder })
    if (r.path) setFolder(r.path)
  }
  const make = async () => {
    localStorage.setItem('scrifts.sheetChars', chars); localStorage.setItem('scrifts.sheetFolder', folder)
    setBusy(true)
    try { setMade(await api('/api/sheet/make', { chars, folder, title: font.familyname })) } catch (e) { fail('Could not make the sheets')(e) } finally { setBusy(false) }
  }
  const browseScan = async () => {
    const r = await api<{ path: string | null }>('/api/pick', { mode: 'image' })
    if (r.path) { setScan(r.path); setCells(null) }
  }
  const body = { path: scan, chars, page, threshold }
  const check = async () => {
    setBusy(true); setSkip(new Set())
    try { setCells((await api<{ cells: Cell[] }>('/api/sheet/read', body)).cells) } catch (e) { fail('Could not read the scan')(e) } finally { setBusy(false) }
  }
  const apply = async () => {
    setBusy(true)
    try {
      // a safety net first: this replaces the outlines of the glyphs it reads
      await api('/api/snapshots', { path: font.path, label: 'Before reading a template sheet' }).then(() => window.dispatchEvent(new Event('forge-snapshots'))).catch(() => {})
      const keep = [...(cells ?? [])].filter(c => !skip.has(c.char)).map(c => c.char).join('')
      await api('/api/sheet/read', { ...body, apply: true, only: keep })
      toast.success(`${keep.length} glyph${keep.length === 1 ? '' : 's'} traced`, { description: 'Undo (Ctrl Z) works per glyph.' })
      onDone(); onClose()
    } catch (e) { fail('Could not read the sheet')(e) } finally { setBusy(false) }
  }
  const toggle = (c: string) => setSkip(s => { const n = new Set(s); if (!n.delete(c)) n.add(c); return n })
  const todo = (cells ?? []).filter(c => !skip.has(c.char)).length

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Template sheets</DialogTitle>
          <DialogDescription>Print pages, write one letter per box in dark ink, then scan or photograph them. Scrifts straightens the page, cuts the boxes, and traces each letter.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 text-sm">
          {([['make', '1  Make the sheets'], ['read', '2  Read a scan']] as const).map(([k, l]) => (
            <Button key={k} size="sm" variant={tab === k ? 'secondary' : 'ghost'} onClick={() => setTab(k)}>{l}</Button>
          ))}
        </div>
        {tab === 'make' && (
          <div className="grid gap-3 text-sm">
            <div className="grid gap-1.5">
              <Label htmlFor="sheet-chars">Characters ({new Set([...chars].filter(c => c.trim())).size}, on {pages} page{pages === 1 ? '' : 's'} of {PER_PAGE})</Label>
              <textarea id="sheet-chars" value={chars} onChange={e => { setChars(e.target.value); setMade(null) }} rows={3}
                className="rounded-md border bg-background p-2 font-mono text-xs" />
            </div>
            <div className="grid gap-1.5">
              <Label>Folder</Label>
              <div className="flex gap-2">
                <Input value={folder} onChange={e => setFolder(e.target.value)} className="h-8 font-mono text-xs" />
                <Button variant="secondary" size="sm" onClick={browseFolder}><FolderOpen />Browse</Button>
              </div>
            </div>
            {made && (
              <p className="rounded-md border p-2 text-xs">
                Written to <span className="font-mono break-all">{folder}</span>: <span className="font-mono">sheets.pdf</span> to print, and one PNG per page.
                Print at 100% (no “fit to page”) on A4, and keep all four black corner squares in the scan.
              </p>
            )}
          </div>
        )}
        {tab === 'read' && (
          <div className="grid gap-3 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              <Button variant="secondary" size="sm" onClick={browseScan}><FolderOpen />{scan ? 'Another scan…' : 'Pick the scan…'}</Button>
              <div className="grid gap-1"><Label htmlFor="sheet-page">Page</Label>
                <Input id="sheet-page" type="number" min={1} max={pages} value={page} onChange={e => { setPage(Number(e.target.value) || 1); setCells(null) }} className="h-8 w-16" /></div>
              <div className="grid gap-1"><Label>Ink threshold {threshold}</Label>
                <input type="range" min={60} max={220} value={threshold} onChange={e => { setThreshold(Number(e.target.value)); setCells(null) }} aria-label="Ink threshold" /></div>
            </div>
            {scan && <p className="truncate font-mono text-xs text-muted-foreground">{scan}</p>}
            {cells && (
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground">{cells.length ? `${todo} of ${cells.length} letters ticked. Empty boxes were skipped.` : 'No writing found in the boxes. Try a darker threshold.'}</p>
                <div className="grid max-h-72 grid-cols-6 gap-2 overflow-y-auto sm:grid-cols-8">
                  {cells.map(c => (
                    <label key={c.char} className={`grid cursor-pointer place-items-center gap-0.5 rounded-md border p-1 ${skip.has(c.char) ? 'opacity-40' : ''}`}>
                      <svg viewBox={`0 0 ${c.w} ${c.h}`} className="h-14 w-full"><path d={c.d} fillRule="evenodd" className="fill-foreground" /></svg>
                      <span className="flex items-center gap-1 font-mono text-xs"><input type="checkbox" checked={!skip.has(c.char)} onChange={() => toggle(c.char)} />{c.char}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {tab === 'make' && <Button onClick={make} disabled={busy || !chars.trim() || !folder}>{busy && <Loader2 className="animate-spin" />}Make sheets</Button>}
          {tab === 'read' && !cells && <Button onClick={check} disabled={busy || !scan}>{busy && <Loader2 className="animate-spin" />}Find the letters</Button>}
          {tab === 'read' && cells && <Button onClick={apply} disabled={busy || !todo}>{busy && <Loader2 className="animate-spin" />}Trace {todo} letter{todo === 1 ? '' : 's'} into the font</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
