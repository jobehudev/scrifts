import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, Loader2 } from 'lucide-react'
import { api, type FontInfo } from './api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Report = { glyphs: { file: string; glyph: string; status: 'new' | 'replace' | 'empty' | 'unknown' }[] }
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '')
const canImport = (g: Report['glyphs'][number]) => g.status === 'new' || g.status === 'replace'
const WHAT = { new: 'new glyph', replace: 'replaces the outline', empty: 'nothing drawn, skipped', unknown: 'no such glyph, skipped' }

/** File ▸ Export / Import for Illustrator: one SVG per glyph with metric guides, and back. */
export function ArtboardDialog({ mode, onClose, font, onDone }: {
  mode: 'export' | 'import' | null; onClose: () => void; font: FontInfo; onDone: () => void
}) {
  const [folder, setFolder] = useState('')
  const [template, setTemplate] = useState(false)
  const [square, setSquare] = useState(true)
  const [chars, setChars] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [skip, setSkip] = useState<Set<string>>(new Set())  // files left unticked
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!mode) return
    // oxlint-disable-next-line react/set-state-in-effect -- start each opening from a clean report and the last folder
    setReport(null)
    setFolder(localStorage.getItem('forge.artFolder') ?? `${dirOf(font.path)}\\${font.fontname} artboards`)
  }, [mode, font.path, font.fontname])

  const browse = async () => {
    const r = await api<{ path: string | null }>('/api/pick', { mode: 'folder', initial: folder })
    if (r.path) { setFolder(r.path); setReport(null) }
  }
  const fail = (title: string) => (e: unknown) => toast.error(title, { description: (e as Error).message })

  const doExport = async () => {
    localStorage.setItem('forge.artFolder', folder)
    setBusy(true)
    try {
      const r = await api<{ files: string[] }>('/api/artboards/export', { folder, chars, template, square, ...(template && !chars ? { names: [] } : {}) })
      toast.success(`${r.files.length} artboards written`, { description: folder })
      onClose()
    } catch (e) { fail('Export failed')(e) } finally { setBusy(false) }
  }
  const check = async () => {
    localStorage.setItem('forge.artFolder', folder)
    setBusy(true)
    try { setSkip(new Set()); setReport(await api<Report>('/api/artboards/import', { folder })) } catch (e) { fail('Could not read the folder')(e) } finally { setBusy(false) }
  }
  const apply = async () => {
    setBusy(true)
    try {
      const files = report!.glyphs.filter(g => canImport(g) && !skip.has(g.file)).map(g => g.file)
      // a safety net first: importing replaces outlines
      await api('/api/snapshots', { path: font.path, label: 'Before importing from Illustrator' })
        .then(() => window.dispatchEvent(new Event('forge-snapshots'))).catch(() => {})
      await api<Report>('/api/artboards/import', { folder, apply: true, files })
      const n = files.length
      toast.success(`${n} glyph${n === 1 ? '' : 's'} imported`, { description: 'Undo (Ctrl Z) works per glyph.' })
      onDone(); onClose()
    } catch (e) { fail('Import failed')(e) } finally { setBusy(false) }
  }

  const ready = report?.glyphs.filter(canImport) ?? []
  const todo = ready.filter(g => !skip.has(g.file)).length
  const toggle = (f: string) => setSkip(s => { const n = new Set(s); if (!n.delete(f)) n.add(f); return n })
  return (
    <Dialog open={!!mode} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === 'export' ? 'Export for Illustrator' : 'Import from Illustrator'}</DialogTitle>
          <DialogDescription>
            {mode === 'export'
              ? 'One SVG per glyph, as wide as the glyph, with guides for the baseline, heights and edges on a "Metrics" layer. Draw on the "Outline" layer.'
              : 'Reads the "Outline" layer of every SVG in the folder into the glyph its file name stands for. The "Metrics" layer is ignored.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="grid gap-1.5">
            <Label>Folder</Label>
            <div className="flex gap-2">
              <Input value={folder} onChange={e => { setFolder(e.target.value); setReport(null) }} className="h-8 font-mono text-xs" />
              <Button variant="secondary" size="sm" onClick={browse}><FolderOpen />Browse</Button>
            </div>
          </div>
          {mode === 'export' && <>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={square} onChange={e => setSquare(e.target.checked)} />
              Square artboards, 1 em wide (the glyph's width is the "right-edge" guide)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={template} onChange={e => setTemplate(e.target.checked)} />
              Template: guides only, no outlines
            </label>
            <div className="grid gap-1.5">
              <Label htmlFor="art-chars">Also include these characters</Label>
              <Input id="art-chars" value={chars} onChange={e => setChars(e.target.value)} placeholder="ABCDEFGHIJKLMNOPQRSTUVWXYZ" className="h-8 font-mono text-xs" />
              <p className="text-xs text-muted-foreground">Glyphs the font does not have yet get an empty artboard.</p>
            </div>
          </>}
          {mode === 'import' && report && (
            <div className="grid gap-1">
              {ready.length > 1 && (
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{todo} of {ready.length} ticked</span>
                  <button type="button" className="underline" onClick={() => setSkip(new Set())}>All</button>
                  <button type="button" className="underline" onClick={() => setSkip(new Set(ready.map(g => g.file)))}>None</button>
                </div>
              )}
              <div className="max-h-56 overflow-y-auto rounded-md border text-xs">
                {report.glyphs.length === 0 && <p className="p-2 text-muted-foreground">No .svg files in that folder.</p>}
                {report.glyphs.map(g => (
                  <label key={g.file} className="flex items-center gap-2 px-2 py-1 even:bg-muted/40">
                    <input type="checkbox" disabled={!canImport(g)} checked={canImport(g) && !skip.has(g.file)} onChange={() => toggle(g.file)} />
                    <span className="w-24 shrink-0 truncate font-mono">{g.glyph}</span>
                    <span className={canImport(g) ? '' : 'text-muted-foreground'}>{WHAT[g.status]}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {mode === 'export' && <Button onClick={doExport} disabled={busy || !folder}>{busy && <Loader2 className="animate-spin" />}Export</Button>}
          {mode === 'import' && !report && <Button onClick={check} disabled={busy || !folder}>{busy && <Loader2 className="animate-spin" />}Check folder</Button>}
          {mode === 'import' && report && <Button onClick={apply} disabled={busy || !todo}>{busy && <Loader2 className="animate-spin" />}Import {todo} glyph{todo === 1 ? '' : 's'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
