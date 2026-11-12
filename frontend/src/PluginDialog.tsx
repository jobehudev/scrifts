import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from './api'
import { stored } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Option = string | number | { value: string | number; label?: string }
export type Param = { name: string; type: 'number' | 'integer' | 'text' | 'bool' | 'choice'; label: string; default?: unknown; min?: number; max?: number; options?: Option[] }
export type PluginInfo = { id: string; source: string; name: string; description: string; version: string; author: string; params: Param[]; error?: string }

const TRUST = 'forge.pluginTrust'
const trusted = (p: PluginInfo) => p.source === 'bundled' || stored<string[]>(TRUST, []).includes(`${p.id}@${p.version}`)
const opt = (o: Option) => (typeof o === 'object' ? { value: o.value, label: o.label ?? String(o.value) } : { value: o, label: String(o) })

/** A plugin's settings, drawn from its manifest, and the button that runs it. */
export function PluginDialog({ plugin, sel, onClose, onRan }: { plugin: PluginInfo | null; sel: string | null; onClose: () => void; onRan: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string[] | null>(null)

  useEffect(() => {
    if (!plugin) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fresh form each time a plugin is opened
    setValues(Object.fromEntries(plugin.params.map(p => [p.name, p.default ?? (p.type === 'bool' ? false : p.type === 'choice' ? opt(p.options![0]).value : p.type === 'text' ? '' : 0)])))
    setOk(trusted(plugin)); setError(null); setLog(null)
  }, [plugin])

  if (!plugin) return null
  const set = (k: string, v: unknown) => setValues(s => ({ ...s, [k]: v }))

  const run = async () => {
    setBusy(true); setError(null); setLog(null)
    try {
      if (plugin.source !== 'bundled') {
        const t = stored<string[]>(TRUST, [])
        localStorage.setItem(TRUST, JSON.stringify([...new Set([...t, `${plugin.id}@${plugin.version}`])]))
      }
      const r = await api<{ log: string[] }>('/api/plugins/run', { id: plugin.id, params: values, selected: sel })
      setLog(r.log)
      onRan()
      toast.success(`${plugin.name} finished`, { description: r.log.join('\n') || undefined })
    } catch (e) {
      setError((e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plugin.name}</DialogTitle>
          <DialogDescription>{plugin.description || 'No description.'}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto text-sm">
          {plugin.params.map(p => (
            <div key={p.name} className={p.type === 'bool' ? 'flex items-center gap-2' : 'grid gap-1.5'}>
              {p.type === 'bool' ? (
                <>
                  <input id={`pp-${p.name}`} type="checkbox" checked={!!values[p.name]} onChange={e => set(p.name, e.target.checked)} />
                  <Label htmlFor={`pp-${p.name}`}>{p.label}</Label>
                </>
              ) : (
                <>
                  <Label htmlFor={`pp-${p.name}`}>{p.label}{p.min !== undefined && p.max !== undefined ? <span className="ml-1 text-muted-foreground">{p.min}–{p.max}</span> : null}</Label>
                  {p.type === 'choice' ? (
                    <Select id={`pp-${p.name}`} value={String(values[p.name] ?? '')}
                      onChange={e => set(p.name, p.options!.map(opt).find(o => String(o.value) === e.target.value)?.value)}>
                      {p.options!.map(o => <option key={String(opt(o).value)} value={String(opt(o).value)}>{opt(o).label}</option>)}
                    </Select>
                  ) : (
                    <Input id={`pp-${p.name}`} className="h-8" type={p.type === 'text' ? 'text' : 'number'} step={p.type === 'integer' ? 1 : 'any'} value={String(values[p.name] ?? '')}
                      onChange={e => set(p.name, p.type === 'text' ? e.target.value : e.target.value === '' ? '' : +e.target.value)} />
                  )}
                </>
              )}
            </div>
          ))}
          {plugin.params.length === 0 && <p className="text-muted-foreground">This plugin has no settings.</p>}
        </div>
        <p className="text-xs text-muted-foreground">
          {plugin.source === 'bundled' ? 'Ships with Scrifts.' : 'From your plugins folder.'}{plugin.version ? ` Version ${plugin.version}.` : ''}{plugin.author ? ` By ${plugin.author}.` : ''}
          {sel ? ` Selected glyph: ${sel}.` : ''}
        </p>
        {!trusted(plugin) && (
          <label className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={ok} onChange={e => setOk(e.target.checked)} />
            <span>This plugin is code from your own plugins folder and runs with your permissions. I have looked at it, or I trust where it came from.</span>
          </label>
        )}
        {error && <pre className="max-h-40 overflow-auto rounded-md bg-destructive/10 p-2 font-mono text-xs whitespace-pre-wrap text-destructive">{error}</pre>}
        {log && <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">{log.join('\n') || 'Done.'}</pre>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{log ? 'Close' : 'Cancel'}</Button>
          <Button disabled={busy || !ok} onClick={() => void run()}>{busy ? 'Running…' : 'Run'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
