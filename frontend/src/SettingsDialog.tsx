import { RotateCcw } from 'lucide-react'
import { ColorPicker } from './ColorPicker'
import { contrast } from './proof'
import { DEFAULTS, setSettings, useSettings, type Settings } from './settings'
import { CUSTOM_PRESETS, deriveTokens } from './theme'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

function Choice<K extends keyof Settings>({ k, options }: { k: K; options: [Settings[K], string][] }) {
  const s = useSettings()
  return (
    <Tabs value={String(s[k])} onValueChange={v => setSettings({ [k]: options.find(o => String(o[0]) === v)![0] } as Partial<Settings>)}>
      <TabsList className="h-7">
        {options.map(([v, l]) => <TabsTrigger key={String(v)} value={String(v)} className="text-xs">{l}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}

/** Two colours make a whole theme; the contrast readout says whether it is easy to read. */
function CustomTheme() {
  const { custom } = useSettings()
  const { vars } = deriveTokens(custom)
  const text = contrast(vars['--foreground'], custom.bg), accent = contrast(vars['--primary'], custom.bg)
  return (
    <div className="mb-1 ml-[162px] space-y-2 rounded-md border p-2.5 text-xs">
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2">Background <ColorPicker label="Background colour" value={custom.bg} onChange={bg => setSettings({ custom: { ...custom, bg } })} /></label>
        <label className="flex items-center gap-2">Accent <ColorPicker label="Accent colour" value={custom.accent} onChange={accent => setSettings({ custom: { ...custom, accent } })} /></label>
      </div>
      <p className="font-mono text-muted-foreground" title="Contrast of text, and of the accent, against the background">text {text.toFixed(1)}:1 · accent {accent.toFixed(1)}:1 contrast</p>
      <div className="flex flex-wrap gap-1">
        {CUSTOM_PRESETS.map(p => (
          <Button key={p.name} size="xs" variant="outline" onClick={() => setSettings({ custom: p.theme })}>
            <span className="inline-block size-3 rounded-full border" style={{ background: p.theme.bg, boxShadow: `inset 0 0 0 3px ${p.theme.accent}` }} />{p.name}
          </Button>
        ))}
      </div>
      <p className="text-muted-foreground">Text, lines and the drawing colours follow from these two. Text is always kept readable; a mid grey background cannot be.</p>
    </div>
  )
}

const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[150px_1fr] items-center gap-3 py-1.5">
    <div>
      <Label>{label}</Label>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
    <div className="flex items-center gap-2">{children}</div>
  </div>
)

/** Preferences for the app itself. Saved on this machine, applied immediately. */
export function SettingsDialog({ open, onOpenChange, fontName, onRefreshUiFont }: {
  open: boolean; onOpenChange: (o: boolean) => void
  fontName: string | null; onRefreshUiFont: () => void
}) {
  const s = useSettings()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Saved on this computer and applied right away. None of these change your font.</DialogDescription>
        </DialogHeader>

        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Appearance</h3>
          <Row label="Theme"><Choice k="theme" options={[['dark', 'Dark'], ['light', 'Light'], ['ink', 'Ink'], ['custom', 'Custom']]} /></Row>
          {s.theme === 'custom' && <CustomTheme />}
          <Row label="Interface size">
            <Slider className="w-40" min={80} max={150} step={5} value={[s.uiScale]} onValueChange={v => setSettings({ uiScale: v[0] })} />
            <span className="w-10 font-mono text-xs text-muted-foreground">{s.uiScale}%</span>
          </Row>
          <Row label="Interface font" hint={s.uiFont === 'project' && !fontName ? 'Applies once a font is open' : 'Letters the font lacks fall back to Geist'}>
            <Choice k="uiFont" options={[['default', 'Geist'], ['system', 'System'], ['serif', 'Serif'], ['project', fontName ? `This font (${fontName})` : 'The open font']]} />
            {s.uiFont === 'project' && fontName && (
              <Button size="xs" variant="ghost" onClick={onRefreshUiFont} title="Rebuild it from the current outlines (also happens on Save)">Refresh</Button>
            )}
          </Row>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Editing</h3>
          <Row label="Editor grid" hint="Font-space coordinate grid in the glyph editor">
            <Choice k="gridStyle" options={[['dots', 'Dots'], ['lines', 'Lines']]} />
          </Row>
          <Row label="Grid snapping" hint="Include grid intersections when Smart Guides (S) are active">
            <Choice k="snapToGrid" options={[[false, 'Smart Guides only'], [true, 'Smart Guides + Grid']]} />
          </Row>
          <Row label="Arrow-key nudge" hint="Font units, plain and with Shift">
            <Input type="number" min={1} className="h-7 w-20 font-mono" value={s.nudge} onChange={e => setSettings({ nudge: Math.max(1, +e.target.value) })} />
            <Input type="number" min={1} className="h-7 w-20 font-mono" value={s.nudgeBig} onChange={e => setSettings({ nudgeBig: Math.max(1, +e.target.value) })} />
          </Row>
          <Row label="Glyph grid cells">
            <Slider className="w-40" min={44} max={140} step={4} value={[s.gridCell]} onValueChange={v => setSettings({ gridCell: v[0] })} />
            <span className="w-10 font-mono text-xs text-muted-foreground">{s.gridCell}px</span>
          </Row>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Startup</h3>
          <Row label="Autosave" hint="Saves .sfd projects in place a few seconds after a change. Other formats are never overwritten."><Choice k="autosave" options={[[true, 'On'], [false, 'Off']]} /></Row>
          <Row label="On start"><Choice k="reopenLast" options={[[false, 'Show start screen'], [true, 'Reopen last font']]} /></Row>
        </section>

        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => setSettings(DEFAULTS)}><RotateCcw />Reset to defaults</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
