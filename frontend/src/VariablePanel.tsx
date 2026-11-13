import { toast } from 'sonner'
import { Download, Layers, Loader2, Pause, Play, RotateCcw } from 'lucide-react'
import { api, type FontInfo } from './api'
import { atKeyframe, AxisTicks, type VariableState } from './VariableBar'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { NumField } from './NumField'

type ExportResult = {
  path: string; glyphs: number; tables: string[]
  outline_check?: { glyphs_checked: number; advance_mismatches: { glyph: string; exported: number; preview: number }[] }
}

/**
 * One slider per fvar axis, sharing its state with the bar above the views (`vv`): the thumb moves instantly, the views
 * follow once it rests (see useVariableState). Also says how a variable font differs from a family of masters.
 */
export function VariablePanel({ font, vv, pickSave, run, onSplit }: {
  font: FontInfo
  vv: VariableState
  pickSave: (initial: string) => Promise<string | null>
  run: <T>(label: string, f: () => Promise<T>) => Promise<T | undefined>
  onSplit: () => void  // the split lives in App: it asks where to save, then opens the family
}) {
  const { values, setValues, setValuesNow, defaults, playing, preparing, togglePlay, stop, keyframes, canPlay } = vv
  const base = font.path.replace(/\.[^.\\/]+$/, '')
  const tag = font.axes.map(a => `${a.tag}${Math.round(values[a.tag] ?? a.default)}`).join('-')

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
        <div className="flex items-center gap-1">
          {canPlay && <Button size="icon-xs" variant={playing || preparing ? 'secondary' : 'ghost'} aria-pressed={playing || preparing} aria-label={playing ? 'Stop the animation' : preparing ? 'Getting ready: click to cancel' : 'Play: sweep the weight'}
            title={playing ? 'Stop' : preparing ? 'Getting every position ready first: click to cancel' : 'Play: gets every position ready, then shows the shapes changing from the lightest to the heaviest and back'} onClick={() => void togglePlay()}>{playing ? <Pause /> : preparing ? <Loader2 className="animate-spin" /> : <Play />}</Button>}
          <Button size="xs" variant="ghost" onClick={() => { stop(); setValuesNow(defaults) }}><RotateCcw />Default</Button>
        </div>
      </div>
      <div className="flex flex-col gap-4 p-3">
        {font.axes.map(a => (
          <div key={a.tag} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <span title={a.tag}>{a.name}</span>
              <div className="w-36"><NumField hideLabel buttons label={a.name} min={a.min} max={a.max} value={Math.round(values[a.tag] ?? a.default)}
                onCommit={n => setValuesNow(s => ({ ...s, [a.tag]: n }))} /></div>
            </div>
            <Slider min={a.min} max={a.max} step={a.max - a.min > 20 ? 1 : (a.max - a.min) / 400}
              value={[values[a.tag] ?? a.default]} onValueChange={v => setValues(s => ({ ...s, [a.tag]: v[0] }))}
              onDoubleClick={() => setValuesNow(s => ({ ...s, [a.tag]: a.default }))} />
            <AxisTicks axis={a} vv={vv} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 border-t p-3">
        <span className="text-xs font-medium text-muted-foreground">Where it was drawn</span>
        <p className="text-[11px] leading-snug text-muted-foreground">
          A variable font is one file with every weight inside. Its designer drew it at the places below, and every position
          between them is calculated. A family of masters is the same idea with each drawing as its own editable font.
        </p>
        <div className="flex flex-wrap gap-1">
          {keyframes.map(k => (
            <Button key={k.name + JSON.stringify(k.location)} size="xs" variant={atKeyframe(vv, k) ? 'secondary' : 'outline'}
              onClick={() => setValuesNow({ ...defaults, ...k.location })} title="The font was drawn here">
              {k.name} <span className="font-mono opacity-60">{font.axes.map(a => Math.round(k.location[a.tag] ?? a.default)).join(' ')}</span>
            </Button>
          ))}
        </div>
      </div>
      {font.instances.length > 0 && (
        <div className="flex flex-col gap-1 border-t p-3">
          <span className="mb-1 text-xs font-medium text-muted-foreground">Named styles</span>
          <div className="flex flex-wrap gap-1">
            {font.instances.map(i => (
              <Button key={i.name + JSON.stringify(i.location)} size="xs" variant="outline"
                onClick={() => setValuesNow({ ...defaults, ...i.location })}>{i.name}</Button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-auto flex flex-col gap-1.5 border-t p-3">
        <span className="mb-1 text-xs font-medium text-muted-foreground">Edit</span>
        <Button size="sm" variant="secondary" onClick={onSplit}><Layers />Edit as masters…</Button>
        <span className="mb-2 text-[11px] leading-snug text-muted-foreground">
          This file can only be looked at and exported. To change its shapes, Scrifts saves a project folder with an editable
          .sfd for each place it was drawn and opens it as a family. Your .ttf is not changed.
        </span>
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
