import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api, type FontInfo } from './api'
import { ask } from './confirm'
import { ago } from './recent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Snap = { id: string; label: string; kind: 'manual' | 'auto' | 'restore'; time: number; size: number; files: string[] }
type Diff = { changed: string[]; added: string[]; removed: string[] }
const KIND = { manual: 'Yours', auto: 'Automatic', restore: 'Before a restore' } as const
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`)

/** Dispatch this when a snapshot may have been made elsewhere (autosave does), so the list updates. */
export const SNAPSHOTS_CHANGED = 'forge-snapshots'

/**
 * Checkpoints of the project: take one, see which glyphs changed since, go back to one.
 * Restoring first saves the present as a snapshot of its own, so it can be taken back too.
 */
export function SnapshotsPanel({ font, onSelect, onRestore }: { font: FontInfo; onSelect: (name: string) => void; onRestore: (id: string, label: string) => void }) {
  const [items, setItems] = useState<Snap[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [diff, setDiff] = useState<{ id: string; d: Diff } | null>(null)

  const load = useCallback(() => {
    api<{ items: Snap[] }>(`/api/snapshots?path=${encodeURIComponent(font.path)}`)
      .then(r => { setItems(r.items); setProblem(null) })
      .catch(e => { setItems(null); setProblem((e as Error).message) })
  }, [font.path])
  useEffect(() => {
    load()
    window.addEventListener(SNAPSHOTS_CHANGED, load)
    return () => window.removeEventListener(SNAPSHOTS_CHANGED, load)
  }, [load])

  const take = async () => {
    setBusy(true)
    try {
      await api('/api/snapshots', { path: font.path, label: label.trim() || 'Snapshot' })
      setLabel(''); load()
      toast.success('Snapshot saved', { description: 'Everything in the project, as it is now.' })
    } catch (e) { toast.error('Could not take a snapshot', { description: (e as Error).message }) } finally { setBusy(false) }
  }
  const compare = async (id: string) => {
    if (diff?.id === id) { setDiff(null); return }
    try { setDiff({ id, d: await api<Diff>(`/api/snapshots/compare?path=${encodeURIComponent(font.path)}&id=${id}`) }) } catch (e) { toast.error('Could not compare', { description: (e as Error).message }) }
  }
  const remove = async (s: Snap) => {
    if (!await ask('This cannot be undone.', { title: `Delete the snapshot “${s.label || s.id}”?`, ok: 'Delete' })) return
    try { await api('/api/snapshots/delete', { path: font.path, id: s.id }); load() } catch (e) { toast.error('Could not delete', { description: (e as Error).message }) }
  }

  if (problem) return <p className="p-3 text-xs text-muted-foreground">{problem}</p>
  return (
    <div className="h-full overflow-y-auto text-xs">
      <section className="space-y-2 border-b p-3">
        <p className="text-muted-foreground">A snapshot is a copy of your whole project at one moment. Take one before something risky; Scrifts also takes one every ten minutes while you work.</p>
        <div className="flex gap-1.5">
          <Input className="h-7" placeholder="Name it (optional)" value={label} onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void take() }} />
          <Button size="sm" disabled={busy} onClick={() => void take()}>Take snapshot</Button>
        </div>
      </section>
      <ul className="divide-y">
        {items === null && <li className="p-3 text-muted-foreground">Loading…</li>}
        {items?.length === 0 && <li className="p-3 text-muted-foreground">No snapshots yet.</li>}
        {items?.map(s => (
          <li key={s.id} className="space-y-1.5 p-3">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{s.label || 'Snapshot'}</span>
              <span className="shrink-0 text-muted-foreground" title={new Date(s.time * 1000).toLocaleString()}>{ago(s.time * 1000)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span className="rounded bg-secondary px-1.5 py-0.5">{KIND[s.kind] ?? s.kind}</span>
              <span>{s.files.length} file{s.files.length > 1 ? 's' : ''} · {size(s.size)}</span>
              <span className="flex-1" />
              <Button size="xs" variant={diff?.id === s.id ? 'secondary' : 'ghost'} onClick={() => void compare(s.id)}>What changed?</Button>
              <Button size="xs" variant="ghost" onClick={() => onRestore(s.id, s.label || 'this snapshot')}>Restore</Button>
              <Button size="xs" variant="ghost" aria-label="Delete this snapshot" onClick={() => void remove(s)}>×</Button>
            </div>
            {diff?.id === s.id && (
              <div className="space-y-1 rounded-md bg-muted p-2">
                {(['changed', 'added', 'removed'] as const).map(k => diff.d[k].length > 0 && (
                  <div key={k} className="flex flex-wrap items-center gap-1">
                    <span className="w-14 shrink-0 capitalize text-muted-foreground">{k} {diff.d[k].length}</span>
                    {diff.d[k].slice(0, 40).map(n => (
                      <Button key={n} size="xs" variant="outline" disabled={k === 'removed'} className="font-mono" onClick={() => onSelect(n)}>{n}</Button>
                    ))}
                    {diff.d[k].length > 40 && <span>+{diff.d[k].length - 40} more</span>}
                  </div>
                ))}
                {!diff.d.changed.length && !diff.d.added.length && !diff.d.removed.length && <p className="text-muted-foreground">Nothing is different from this snapshot.</p>}
                <p className="text-[10px] text-muted-foreground">Compared for the font you have open ({font.familyname}).</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
