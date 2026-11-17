import { AboutContent } from './AboutContent'
import { useState, type ReactNode } from 'react'
import { Info, Minus, Palette, PenTool, Plus, RotateCcw, Search, Settings2, X } from 'lucide-react'
import { ColorPicker } from './ColorPicker'
import { ScriptPicker } from './ScriptPicker'
import { contrast } from './proof'
import { DEFAULTS, setSettings, UI_SCALE, useSettings, zoomUi, type Settings } from './settings'
import { CUSTOM_PRESETS, deriveTokens } from './theme'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/** A row of choices; the pill look of the other segmented controls in the app. */
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
    <div className="mt-3 space-y-2 rounded-md border p-2.5 text-xs">
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

const CATEGORIES = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'editing', label: 'Editing', icon: PenTool },
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'about', label: 'About', icon: Info },
] as const
type Cat = typeof CATEGORIES[number]['id']

type Item = { id: string; cat: Exclude<Cat, 'about'>; label: string; desc?: string; keywords?: string; body: ReactNode }

/** Preferences for the app itself. Saved on this machine, applied immediately.
 *  Laid out like VS Code's: categories on the left, a search box on top, each setting a title, a line about it, then the control. */
export function SettingsDialog({ open, onOpenChange, fontName, onRefreshUiFont }: {
  open: boolean; onOpenChange: (o: boolean) => void
  fontName: string | null; onRefreshUiFont: () => void
}) {
  const s = useSettings()
  const [cat, setCat] = useState<Cat>('appearance')
  const [q, setQ] = useState('')

  const items: Item[] = [
    { id: 'theme', cat: 'appearance', label: 'Theme', desc: 'Colours of the whole app.', keywords: 'dark light ink custom colour color',
      body: <><Choice k="theme" options={[['dark', 'Dark'], ['light', 'Light'], ['ink', 'Ink'], ['custom', 'Custom']]} />{s.theme === 'custom' && <CustomTheme />}</> },
    { id: 'zoom', cat: 'appearance', label: 'Interface Zoom', desc: 'Ctrl = and Ctrl − (Ctrl Alt in the glyph editor); Ctrl Shift 0 resets.', keywords: 'size scale bigger smaller ui',
      body: <div className="flex items-center gap-2">
        <Button size="icon-xs" variant="outline" aria-label="Zoom out" disabled={s.uiScale <= UI_SCALE.min} onClick={() => zoomUi(-1)}><Minus /></Button>
        <Slider className="w-40" min={UI_SCALE.min} max={UI_SCALE.max} step={5} value={[s.uiScale]} onValueChange={v => setSettings({ uiScale: v[0] })} />
        <Button size="icon-xs" variant="outline" aria-label="Zoom in" disabled={s.uiScale >= UI_SCALE.max} onClick={() => zoomUi(1)}><Plus /></Button>
        <span className="w-10 font-mono text-xs text-muted-foreground">{s.uiScale}%</span>
        <Button size="xs" variant="ghost" disabled={s.uiScale === 100} onClick={() => zoomUi(0)}>Reset</Button>
      </div> },
    { id: 'uifont', cat: 'appearance', label: 'Interface Font', desc: s.uiFont === 'project' && !fontName ? 'Applies once a font is open.' : 'Letters the font lacks fall back to Geist.', keywords: 'typeface menus',
      body: <div className="flex flex-wrap items-center gap-2">
        <Choice k="uiFont" options={[['default', 'Geist'], ['system', 'System'], ['serif', 'Serif'], ['project', fontName ? `This font (${fontName})` : 'The open font']]} />
        {s.uiFont === 'project' && fontName && <Button size="xs" variant="ghost" onClick={onRefreshUiFont} title="Rebuild it from the current outlines (also happens on Save)">Refresh</Button>}
      </div> },

    { id: 'grid', cat: 'editing', label: 'Editor Grid', desc: 'The font-space coordinate grid in the glyph editor.', keywords: 'dots lines',
      body: <Choice k="gridStyle" options={[['dots', 'Dots'], ['lines', 'Lines']]} /> },
    { id: 'snap', cat: 'editing', label: 'Grid Snapping', desc: 'Whether grid intersections count when Smart Guides (S) are active.', keywords: 'snap smart guides',
      body: <Choice k="snapToGrid" options={[[false, 'Smart Guides only'], [true, 'Smart Guides + Grid']]} /> },
    { id: 'nudge', cat: 'editing', label: 'Arrow-Key Nudge', desc: 'How far the arrow keys move points, in font units: plain, then with Shift.', keywords: 'move step',
      body: <div className="flex items-center gap-2">
        <Input type="number" min={1} className="h-7 w-20 font-mono" aria-label="Nudge" value={s.nudge} onChange={e => setSettings({ nudge: Math.max(1, +e.target.value) })} />
        <Input type="number" min={1} className="h-7 w-20 font-mono" aria-label="Nudge with Shift" value={s.nudgeBig} onChange={e => setSettings({ nudgeBig: Math.max(1, +e.target.value) })} />
      </div> },
    { id: 'cells', cat: 'editing', label: 'Glyph Grid Cells', desc: 'The smallest cell size in the glyph grid.', keywords: 'size thumbnails',
      body: <div className="flex items-center gap-2">
        <Slider className="w-40" min={44} max={140} step={4} value={[s.gridCell]} onValueChange={v => setSettings({ gridCell: v[0] })} />
        <span className="w-10 font-mono text-xs text-muted-foreground">{s.gridCell}px</span>
      </div> },

    { id: 'scripts', cat: 'general', label: 'Default Languages', desc: 'The languages a new font starts with in the glyph grid, Latin or not, each named by its OpenType script. Any font can add more later from the grid\'s Languages view.', keywords: 'language latin han kanji arabic hebrew cyrillic greek new font glyph grid writing system',
      body: <ScriptPicker value={s.scripts} onChange={v => setSettings({ scripts: v })} /> },
    { id: 'autosave', cat: 'general', label: 'Autosave', desc: 'Saves .sfd projects in place a few seconds after a change. Other formats are never overwritten.', keywords: 'save backup',
      body: <Choice k="autosave" options={[[true, 'On'], [false, 'Off']]} /> },
    { id: 'start', cat: 'general', label: 'On Start', desc: 'What you see when Scrifts opens.', keywords: 'startup reopen last font home',
      body: <Choice k="reopenLast" options={[[false, 'Show start screen'], [true, 'Reopen last font']]} /> },
    { id: 'ask', cat: 'general', label: 'Warnings', desc: s.skipAsk.length ? `${s.skipAsk.length} question${s.skipAsk.length === 1 ? ' is' : 's are'} no longer asked ("Don't ask again"). Questions about losing unsaved work are always asked.` : 'Every question is asked. Tick "Don\'t ask again" in one to skip it from then on. Questions about losing unsaved work are always asked.', keywords: 'confirm prompt dialog dont ask again warning delete',
      body: <Button size="xs" variant="outline" disabled={!s.skipAsk.length} onClick={() => setSettings({ skipAsk: [] })}>Ask everything again</Button> },
  ]

  const query = q.trim().toLowerCase()
  const shown = query
    ? items.filter(i => `${i.label} ${i.desc ?? ''} ${i.keywords ?? ''} ${i.cat}`.toLowerCase().includes(query))
    : items.filter(i => i.cat === cat)
  const label = (c: string) => CATEGORIES.find(x => x.id === c)!.label

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[34rem] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">Preferences for Scrifts. Saved on this computer and applied right away. None of these change your font.</DialogDescription>

        {/* search, like VS Code's settings page */}
        <div className="border-b p-3 pr-12">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search settings" aria-label="Search settings" className="h-8 pl-8 pr-8" autoFocus />
            {q && <Button size="icon-xs" variant="ghost" aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setQ('')}><X /></Button>}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* left: the categories */}
          <nav aria-label="Settings categories" className="flex w-44 shrink-0 flex-col gap-0.5 border-r p-2">
            {CATEGORIES.map(c => {
              const on = !query && cat === c.id
              return (
                <button key={c.id} type="button" aria-current={on ? 'page' : undefined} onClick={() => { setQ(''); setCat(c.id) }}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}>
                  <c.icon className="size-4 shrink-0" />{c.label}
                </button>
              )
            })}
            <div className="mt-auto">
              <Button size="xs" variant="ghost" className="w-full justify-start text-muted-foreground" onClick={() => setSettings(DEFAULTS)}><RotateCcw />Reset all to defaults</Button>
            </div>
          </nav>

          {/* right: the settings, or the About page */}
          <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
            {query ? (
              <>
                <p className="mb-2 text-xs text-muted-foreground">{shown.length} setting{shown.length === 1 ? '' : 's'} found</p>
                {shown.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches “{q.trim()}”.</p>}
              </>
            ) : cat === 'about' ? null : <h2 className="mb-1 text-lg font-semibold tracking-tight">{label(cat)}</h2>}

            {!query && cat === 'about' ? (
              <AboutContent />
            ) : shown.map(i => (
              <section key={i.id} className="border-b py-4 last:border-b-0">
                <h3 className="text-sm font-semibold">{query && <span className="font-normal text-muted-foreground">{label(i.cat)}: </span>}{i.label}</h3>
                {i.desc && <p className="mb-2.5 mt-0.5 text-xs text-muted-foreground">{i.desc}</p>}
                {!i.desc && <div className="h-2.5" />}
                {i.body}
              </section>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
