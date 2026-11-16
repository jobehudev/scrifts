import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CircleX, FolderOpen, Loader2, Wrench } from 'lucide-react'
import { api, type FontInfo } from './api'
import { stored } from '@/lib/utils'
import type { Family } from './FamilyBar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type Problem = { bit: number; label: string; level: 'error' | 'warning'; fix: string | null; glyphs: string[] }
type Generated = { path: string; size: number; glyphs: number; truetype: boolean; instructed: boolean }

const FORMATS: [string, string][] = [['otf', 'OpenType (.otf)'], ['ttf', 'TrueType (.ttf)'], ['woff2', 'WOFF2 (web)'], ['woff', 'WOFF (older web)']]
const HINTING: [string, string][] = [
  ['keep', "Keep the font's own"],
  ['auto', 'Autohint (and auto-instruct TrueType from quadratic outlines)'],
  ['none', 'No TrueType instructions (CFF keeps its hints)'],
]
const kb = (n: number) => n < 10240 ? `${(n / 1024).toFixed(1)} KB` : `${Math.round(n / 1024)} KB`
const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '')

/** Validation summary: errors first, a count per problem. */
const tally = (ps: Problem[]) => ({
  errors: ps.filter(p => p.level === 'error').reduce((n, p) => n + p.glyphs.length, 0),
  warnings: ps.filter(p => p.level === 'warning').reduce((n, p) => n + p.glyphs.length, 0),
})

/** File ▸ Generate Fonts: FontForge writes each format, fontTools reads each back. */
export function GenerateDialog({ open, onOpenChange, font, onValidate, family }: {
  open: boolean; onOpenChange: (o: boolean) => void; font: FontInfo; onValidate: () => void
  /** When the font is a master: offer the whole family (variable font + static weights). */
  family?: Family | null
}) {
  const multi = !!family && family.masters.length > 1
  const [whole, setWhole] = useState(true)
  const [variable, setVariable] = useState(true)
  const [statics, setStatics] = useState('')
  const [folder, setFolder] = useState(() => localStorage.getItem('scrifts.genFolder') ?? dirOf(font.path))
  const [name, setName] = useState(font.fontname)
  const [formats, setFormats] = useState<string[]>(() => stored('scrifts.genFormats', ['otf', 'ttf', 'woff2']))
  const [hinting, setHinting] = useState(() => localStorage.getItem('scrifts.genHinting') ?? 'keep')
  const [problems, setProblems] = useState<Problem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Generated[] | null>(null)

  useEffect(() => {
    if (!open) return
    setDone(null); setProblems(null)
    setName(multi && whole ? font.familyname.replace(/\s+/g, '') : font.fontname)
    if (family) setStatics(family.masters.map(m => m.weight).join(', '))
    api<Problem[]>('/api/validate').then(setProblems).catch(() => {})
  }, [open, font.fontname, font.familyname, family, multi, whole])

  const family_ = multi && whole
  const weights = statics.split(/[,\s]+/).filter(Boolean).map(Number)
  const weightsOk = weights.every(w => Number.isFinite(w))

  const browse = async () => {
    const r = await api<{ path: string | null }>('/api/pick', { mode: 'folder', initial: folder })
    if (r.path) setFolder(r.path)
  }

  const generate = async () => {
    localStorage.setItem('scrifts.genFolder', folder)
    localStorage.setItem('scrifts.genFormats', JSON.stringify(formats))
    localStorage.setItem('scrifts.genHinting', hinting)
    setBusy(true)
    try {
      const order = FORMATS.map(f => f[0]).filter(f => formats.includes(f))
      setDone(family_
        ? await api<Generated[]>('/api/family/build', { path: family!.path, folder, name, variable, statics: weights, formats: order, hinting })
        : await api<Generated[]>('/api/generate', { folder, name, formats: order, hinting }))
    } catch (e) {
      toast.error('Generate failed', { description: (e as Error).message })
    } finally { setBusy(false) }
  }

  const t = problems && tally(problems)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate Fonts</DialogTitle>
          <DialogDescription>FontForge writes each file; each is then read back table by table to check it.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 text-sm">
          {multi && (
            <div className="grid gap-1.5 rounded-md border p-2">
              <div className="flex gap-4">
                <label className="flex items-center gap-2"><input type="radio" name="gen-what" checked={whole} onChange={() => setWhole(true)} />Whole family</label>
                <label className="flex items-center gap-2"><input type="radio" name="gen-what" checked={!whole} onChange={() => setWhole(false)} />This master only</label>
              </div>
              {whole && <>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={variable} onChange={e => setVariable(e.target.checked)} />
                  Variable font (.otf and .woff2, weight {family!.axes[0]?.min}–{family!.axes[0]?.max})
                </label>
                <div className="flex items-center gap-2">
                  <Label htmlFor="gen-statics" className="shrink-0">Static weights</Label>
                  <Input id="gen-statics" value={statics} onChange={e => setStatics(e.target.value)} placeholder="e.g. 100, 400, 700, 900"
                    className="h-7 font-mono text-xs" aria-invalid={!weightsOk} />
                </div>
                <p className="text-xs text-muted-foreground">Static weights are written in the formats below; in-between ones are blended from the masters.</p>
              </>}
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Folder</Label>
            <div className="flex gap-2">
              <Input value={folder} onChange={e => setFolder(e.target.value)} aria-label="Folder" className="h-8 font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={browse}><FolderOpen />Browse</Button>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gen-name">File name</Label>
            <Input id="gen-name" value={name} onChange={e => setName(e.target.value)} className="h-8" />
          </div>
          <div className="grid gap-1.5">
            <Label>Formats</Label>
            <div className="grid grid-cols-2 gap-1">
              {FORMATS.map(([f, label]) => (
                <label key={f} className="flex items-center gap-2">
                  <input type="checkbox" checked={formats.includes(f)}
                    onChange={e => setFormats(s => e.target.checked ? [...s, f] : s.filter(x => x !== f))} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Hinting</Label>
            {HINTING.map(([h, label]) => (
              <label key={h} className="flex items-center gap-2">
                <input type="radio" name="hinting" checked={hinting === h} onChange={() => setHinting(h)} />
                {label}
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
            {!t ? <><Loader2 className="size-3.5 animate-spin" />Checking the font…</>
              : !t.errors && !t.warnings ? <span className="text-muted-foreground">Validation: no problems found.</span>
              : <>
                {t.errors > 0 && <span className="flex items-center gap-1 text-destructive"><CircleX className="size-3.5" />{t.errors} errors</span>}
                {t.warnings > 0 && <span className="flex items-center gap-1 text-muted-foreground"><AlertTriangle className="size-3.5" />{t.warnings} warnings</span>}
                <span className="flex-1" />
                <Button size="xs" variant="outline" onClick={onValidate}>Review…</Button>
              </>}
          </div>

          {done && (
            <div className="rounded-md border bg-muted/40 p-2 font-mono text-xs">
              {done.map(d => (
                <div key={d.path} className="flex gap-2">
                  <span className="truncate" title={d.path}>{d.path.split(/[\\/]/).pop()}</span>
                  <span className="flex-1" />
                  <span className="text-muted-foreground">{d.glyphs} glyphs · {kb(d.size)}{d.instructed ? ' · instructed' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{done ? 'Close' : 'Cancel'}</Button>
          <Button onClick={generate} disabled={busy || !name.trim() || !folder.trim()
            || (family_ ? !weightsOk || (!variable && (!weights.length || !formats.length)) : !formats.length)}>
            {busy && <Loader2 className="animate-spin" />}Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Font ▸ Validate: FontForge's checks, per problem, with its fix where there is one. */
export function ValidateDialog({ open, onOpenChange, onGlyph, onChanged }: {
  open: boolean; onOpenChange: (o: boolean) => void; onGlyph: (name: string) => void; onChanged: () => void
}) {
  const [problems, setProblems] = useState<Problem[] | null>(null)
  const [fixing, setFixing] = useState<number | null>(null)

  const load = useCallback(() => { setProblems(null); api<Problem[]>('/api/validate').then(setProblems).catch(() => {}) }, [])
  useEffect(() => { if (open) load() }, [open, load])

  const fix = async (p: Problem) => {
    setFixing(p.bit)
    try {
      setProblems(await api<Problem[]>('/api/validate/fix', { bit: p.bit }))
      onChanged()
      toast.success(`${p.label}: fixed`, { description: `${p.glyphs.length} glyphs; each can be undone in the glyph view` })
    } catch (e) {
      toast.error('Fix failed', { description: (e as Error).message })
    } finally { setFixing(null) }
  }

  const sorted = [...(problems ?? [])].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Validate</DialogTitle>
          <DialogDescription>FontForge's own checks. Click a glyph to open it.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto text-sm">
          {!problems && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />Checking…</div>}
          {problems && !problems.length && <div className="text-muted-foreground">No problems found.</div>}
          {sorted.map(p => (
            <div key={p.bit} className="border-b py-2 last:border-0">
              <div className="flex items-center gap-2">
                {p.level === 'error' ? <CircleX className="size-4 text-destructive" /> : <AlertTriangle className="size-4 text-muted-foreground" />}
                <span className="font-medium">{p.label}</span>
                <span className="text-muted-foreground">{p.glyphs.length}</span>
                <span className="flex-1" />
                {p.fix && (
                  <Button size="xs" variant="outline" onClick={() => fix(p)} disabled={fixing !== null}>
                    {fixing === p.bit ? <Loader2 className="animate-spin" /> : <Wrench />}Fix all
                  </Button>
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-1 pl-6">
                {p.glyphs.slice(0, 120).map((g, i) => (
                  <button key={i} onClick={() => { onGlyph(g); onOpenChange(false) }}
                    className="rounded border px-1.5 py-0.5 font-mono text-xs hover:bg-accent">{g}</button>
                ))}
                {p.glyphs.length > 120 && <span className="text-xs text-muted-foreground">+{p.glyphs.length - 120} more</span>}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={load} disabled={!problems}>Check again</Button>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
