import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Download, RotateCcw } from 'lucide-react'
import { api, type FontInfo, type Location } from './api'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'

type ExportResult = {
  path: string; glyphs: number; tables: string[]
  outline_check?: { glyphs_checked: number; advance_mismatches: { glyph: string; exported: number; preview: number }[] }
}

const DEBOUNCE_MS = 120

/**
 * One slider per fvar axis. The thumb moves instantly; the location the
 * views render at (`onLocation`) only updates after the slider rests for
 * DEBOUNCE_MS, and the backend caches glyph sets per location.
 */
export function VariablePanel({ font, onLocation, pickSave, run }: {
  font: FontInfo
  onLocation: (l: Location | null) => void
  pickSave: (initial: string) => Promise<string | null>
  run: <T>(label: string, f: () => Promise<T>) => Promise<T | undefined>
}) {
  const defaults = Object.fromEntries(font.axes.map(a => [a.tag, a.default]))
  const [values, setValues] = useState<Location>(defaults)
  const timer = useRef(0)

  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const atDefault = font.axes.every(a => Math.abs(values[a.tag] - a.default) < 1e-6)
      onLocation(atDefault ? null : values)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer.current)
  }, [values, font, onLocation])

  const base = font.path.replace(/\.[^.\\/]+$/, '')
  const tag = font.axes.map(a => `${a.tag}${Math.round(values[a.tag])}`).join('-')

  const exportInstance = () => run('Export instance', async () => {
    const path = await pickSave(`${base}-${tag}.ttf`)
    if (!path) return
    const r = await api<ExportResult>('/api/export/instance', { location: values, path })
    const mm = r.outline_check?.advance_mismatches ?? []
    toast.success('Static instance exported and verified', {
      description: `${r.outline_check?.glyphs_checked} outlines match the preview · ${path}`,
    })
    if (mm.length) toast.warning(`${mm.length} advance widths differ from the preview`, {
      description: `The source font's HVAR and gvar disagree for ${mm.map(m => m.glyph).slice(0, 4).join(', ')}. ` +
        'Renderers follow HVAR; the instancer follows gvar.',
      duration: 12000,
    })
  })

  const exportVariable = () => run('Export variable font', async () => {
    const path = await pickSave(`${base}-VF.ttf`)
    if (!path) return
    const r = await api<ExportResult>('/api/export/variable', { path })
    toast.success('Variable font exported and verified', { description: `${r.glyphs} glyphs · fvar present · ${path}` })
  })

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto border-l bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Axes</span>
        <Button size="xs" variant="ghost" onClick={() => setValues(defaults)}><RotateCcw />Default</Button>
      </div>
      <div className="flex flex-col gap-4 p-3">
        {font.axes.map(a => (
          <div key={a.tag} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <span title={a.tag}>{a.name}</span>
              <span className="font-mono text-muted-foreground">{values[a.tag].toFixed(a.max - a.min > 20 ? 0 : 1)}</span>
            </div>
            <Slider min={a.min} max={a.max} step={(a.max - a.min) / 400}
              value={[values[a.tag]]} onValueChange={v => setValues(s => ({ ...s, [a.tag]: v[0] }))}
              onDoubleClick={() => setValues(s => ({ ...s, [a.tag]: a.default }))} />
          </div>
        ))}
      </div>
      {font.instances.length > 0 && (
        <div className="flex flex-col gap-1 border-t p-3">
          <span className="mb-1 text-xs font-medium text-muted-foreground">Instances</span>
          <div className="flex flex-wrap gap-1">
            {font.instances.map(i => (
              <Button key={i.name + JSON.stringify(i.location)} size="xs" variant="outline"
                onClick={() => setValues({ ...defaults, ...i.location })}>{i.name}</Button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1.5 border-t p-3">
        <span className="mb-1 text-xs font-medium text-muted-foreground">Export</span>
        <Button size="sm" variant="secondary" onClick={exportInstance}><Download />Static instance here</Button>
        <Button size="sm" variant="secondary" onClick={exportVariable}><Download />Full variable font</Button>
        <span className="text-[11px] leading-snug text-muted-foreground">
          Both are re-read with fontTools before reporting success. Sidebearing edits apply to the default master
          and are saved with Save; they are not in these exports yet.
        </span>
      </div>
    </aside>
  )
}
