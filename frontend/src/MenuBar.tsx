import { AboutContent } from './AboutContent'
import { Fragment, useState } from 'react'
import { command, type Command } from './commands'
import { ago, ext, type Recent } from './recent'
import { TOOLS, VIEWS } from './panels'
import { zoomUi } from './settings'
import { PRESETS, readSaved, writeSaved } from './workspaces'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { CommandPalette } from './CommandPalette'
import { useProps } from './propsStore'
import type { PaletteItem } from './paletteMatch'
import {
  Menubar, MenubarCheckboxItem, MenubarContent, MenubarItem, MenubarMenu, MenubarRadioGroup, MenubarRadioItem, MenubarSeparator,
  MenubarShortcut, MenubarSub, MenubarSubContent, MenubarSubTrigger, MenubarTrigger,
} from '@/components/ui/menubar'

/** Glyph ▸ Filters: each is one FontForge clean-up on the open glyph (one undo step). [command, label, palette keywords] */
const FILTERS: [Command, string, string][] = [
  ['cleanUp', 'Clean Up (stray points, flat shapes)', 'stray points remove illustrator tidy'],
  ['addExtrema', 'Add Extremes', 'extrema points'], ['addInflections', 'Add Inflection Points', 'inflection'],
  ['simplify', 'Simplify (fewer points)', 'reduce points cleanup'], ['balance', 'Balance Handles', 'tunni handles'],
  ['harmonize', 'Harmonize Curves', 'smooth g2 curvature'], ['roundCoords', 'Round to Whole Units', 'integer coordinates'],
  ['bolder', 'Bolder (+10 units)', 'embolden change weight stem'], ['lighter', 'Lighter (−10 units)', 'change weight thinner'],
]

const SHORTCUTS: [string, string][] = [
  ['F11', 'Fill the window with the panel you are in (again to go back)'], ['Ctrl K', 'Command palette: type what you want to do'], ['Ctrl N', 'New font'], ['Ctrl I', 'Font info'], ['Ctrl ,', 'Settings'], ['Ctrl O', 'Open'], ['Ctrl S', 'Save'], ['Ctrl Shift S', 'Save as'],
  ['Ctrl 1–5', 'Glyph, Spacing, Accents, Features, Script'],
  ['V P H Z K', 'Select, Pen, Hand, Zoom, Measure tools'],
  ['M / L / Shift M', 'Rectangle, Oval, Shape Builder (as in Illustrator)'],
  ["Ctrl U / Ctrl ' / Ctrl R / Ctrl ;", 'Toggle smart guides / grid / rulers / guides'],
  ['Space (hold)', 'Pan'], ['Ctrl 0', 'Fit glyph'], ['Ctrl + / Ctrl −', 'Zoom'], ['Ctrl Shift A', 'Deselect'], ['Ctrl Shift V', 'Paste in place'],
  ['Double-click point / path', 'Toggle smooth↔corner / add point on path'],
  ['Ctrl Z / Ctrl Shift Z', 'Undo / redo (glyph)'], ['Ctrl A', 'Select all points'], ['Delete', 'Delete points'],
  ['Arrows / Shift', 'Nudge 1 / 10 units'], ['Alt-drag handle', 'Break a smooth point'],
  ['Enter / Esc', 'End pen path'], ['Spacing: Ctrl/Alt ←→', 'Edit left / right sidebearing'],
]

/** File, Edit, View, Glyph, Font, Help. Same look as the rest of the chrome. */
/** GitHub's mark (lucide no longer ships brand icons). */
export function MenuBar({ hasFont, editing, view, onView, recent, onFontInfo, onFamily, onGenerate, onValidate, onFixNames, onUndoFont, onProof, onSettings, onNew, onOpen, onOpenPath, onClearRecent, onSave, onSaveAs,
  onClose, comparing, onCompare, onExit, busy, openPanels, onTogglePanel, onResetLayout, onWorkspace, onInterpolate, onExportGlyphs, plugins, onRunPlugin, onOpenPlugins, onLoadPlugins, onWelcome, onArtboards, onTrace, onSheet }: {
  hasFont: boolean; editing: boolean; view: string; onView: (v: string) => void
  recent: Recent[]; onFontInfo: () => void; onFamily: () => void; onGenerate: () => void; onValidate: () => void; onFixNames: () => void; onUndoFont: () => void; onProof: () => void; onSettings: () => void; onNew: () => void; onOpen: () => void; onOpenPath: (p: string) => void; onClearRecent: () => void
  onSave: () => void; onSaveAs: () => void; onClose: () => void
  comparing: string | null; onCompare: () => void; onExit?: () => void; busy: boolean
  /** Window menu: which panels are open, show/hide one, put them all back. */
  openPanels: string[]; onTogglePanel: (v: string) => void; onResetLayout: () => void; onWorkspace: (a: { open?: string; save?: string }) => void; onInterpolate: () => void; onExportGlyphs: () => void
  /** Plugins menu: what was found, run one, open the folder, and look again (called when the menu is pressed). */
  plugins: { id: string; name: string; description: string; source: string; error?: string }[]
  onRunPlugin: (id: string) => void; onOpenPlugins: () => void; onLoadPlugins: () => void
  onWelcome: () => void; onArtboards: (m: 'export' | 'import') => void; onTrace: () => void; onSheet: () => void
}) {
  const [dialog, setDialog] = useState<'keys' | 'about' | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const aids = useProps()?.vis
  const trig = 'h-7 px-2 text-sm font-normal'
  const off = !hasFont || busy

  // Ctrl K: everything the menus can do, by name
  const items: PaletteItem[] = []
  const add = (group: string, label: string, run: () => void, o: { on?: boolean; hint?: string; keywords?: string } = {}) =>
    items.push({ id: `${group}/${label}`, group, label, run, enabled: o.on ?? true, hint: o.hint, keywords: o.keywords })
  add('File', 'New Font…', onNew, { on: !busy, hint: 'Ctrl N' })
  add('File', 'Open a Font…', onOpen, { on: !busy, hint: 'Ctrl O', keywords: 'sfd ttf otf ufo glyphs' })
  add('File', 'Save', onSave, { on: !off, hint: 'Ctrl S' })
  add('File', 'Save As…', onSaveAs, { on: !off, hint: 'Ctrl Shift S' })
  add('File', 'Export as Glyphs File…', onExportGlyphs, { on: !off })
  add('File', 'Export for Illustrator…', () => onArtboards('export'), { on: !off, keywords: 'svg artboards' })
  add('File', 'Import from Illustrator…', () => onArtboards('import'), { on: !off, keywords: 'svg artboards' })
  add('File', 'Generate Fonts…', onGenerate, { on: !off, hint: 'Ctrl Shift G', keywords: 'export otf ttf woff variable' })
  add('File', 'Import Outlines into Glyph…', () => command('import'), { on: editing, keywords: 'svg eps pdf' })
  add('File', 'Trace Picture into Glyph…', onTrace, { on: editing, keywords: 'image photo bitmap scan handwriting' })
  add('File', 'Template Sheets (write by hand)…', onSheet, { on: !off, keywords: 'handwriting scan print calligraphr' })
  add('File', 'Print Proof Sheet (or Save as PDF)…', onProof, { on: !off, keywords: 'pdf print waterfall specimen proof' })
  add('File', 'Close Font', onClose, { on: !off })
  add('File', 'Settings…', onSettings, { hint: 'Ctrl ,', keywords: 'theme colour autosave nudge' })
  for (const r of recent) add('Open recent', `${r.name}${ext(r.path)}`, () => onOpenPath(r.path), { on: !busy, keywords: r.path })
  add('Edit', 'Undo', () => command('undo'), { on: editing, hint: 'Ctrl Z' })
  add('Edit', 'Redo', () => command('redo'), { on: editing, hint: 'Ctrl Shift Z' })
  add('Edit', 'Undo Last Font-Wide Change', onUndoFont, { on: !off, hint: 'Ctrl Alt Z', keywords: 'plugin script rename features revert take back' })
  add('Edit', 'Select All Points', () => command('selectAll'), { on: editing, hint: 'Ctrl A' })
  add('Edit', 'Deselect', () => command('deselect'), { on: editing, hint: 'Esc' })
  add('Edit', 'Delete Points', () => command('delete'), { on: editing, hint: 'Del' })
  for (const [v, l, k] of [['glyph', 'Glyph Editor', '1'], ['spacing', 'Spacing', '2'], ['accents', 'Accents', '3'], ['features', 'Features', '4'], ['script', 'Script', '5']]) {
    add('View', `Go to ${l}`, () => onView(v), { on: hasFont, hint: `Ctrl ${k}` })
  }
  add('View', 'Glyph Grid: font glyphs only', () => command('grid:font'), { on: hasFont })
  add('View', 'Glyph Grid: Latin slots', () => command('grid:latin'), { on: hasFont })
  add('View', 'Glyph Grid: all Unicode slots', () => command('grid:unicode'), { on: hasFont })
  add('View', 'Fit Glyph', () => command('fit'), { on: editing, hint: 'Ctrl 0' })
  add('View', 'Zoom Glyph In', () => command('zoomIn'), { on: editing, hint: 'Ctrl +' })
  add('View', 'Zoom Glyph Out', () => command('zoomOut'), { on: editing, hint: 'Ctrl −' })
  add('View', 'Zoom Interface In', () => zoomUi(1), { hint: 'Ctrl =', keywords: 'bigger larger scale size' })
  add('View', 'Zoom Interface Out', () => zoomUi(-1), { hint: 'Ctrl −', keywords: 'smaller scale size' })
  add('View', 'Reset Interface Zoom', () => zoomUi(0), { hint: 'Ctrl Shift 0', keywords: '100%' })
  add('View', 'Toggle Guides', () => command('toggleGuides'), { on: editing })
  add('View', 'Toggle Shadow Letter', () => command('toggleShadow'), { on: editing, keywords: 'spacing compare accent' })
  add('View', 'Toggle Smart Guides', () => command('toggleSmart'), { on: editing, hint: 'Ctrl U' })
  add('View', 'Toggle Grid', () => command('toggleGrid'), { on: editing, hint: "Ctrl '" })
  add('View', 'Toggle Rulers', () => command('toggleRulers'), { on: editing, hint: 'Ctrl R' })
  add('View', comparing ? `Stop Comparing with ${comparing}` : 'Compare with Another Font…', onCompare, { on: !off })
  for (const [t, l, k] of [['object', 'Selection', 'V'], ['select', 'Direct Selection', 'A'], ['pen', 'Pen', 'P'], ['rect', 'Rectangle', 'M'], ['oval', 'Oval', 'L'], ['shaper', 'Shape Builder', 'Shift M'], ['hand', 'Hand', 'H'], ['zoom', 'Zoom', 'Z'], ['measure', 'Measure', 'K']] as const) {
    add('Glyph', `Tool: ${l}`, () => command(`tool:${t}`), { on: editing, hint: k })
  }
  add('Glyph', 'Round Corners', () => command('roundCorners'), { on: editing, keywords: 'radius fillet live corners smooth' })
  add('Glyph', 'Flip Horizontal', () => command('flipH'), { on: editing, keywords: 'mirror' })
  add('Glyph', 'Flip Vertical', () => command('flipV'), { on: editing, keywords: 'mirror' })
  add('Glyph', 'Rotate 90° Left', () => command('rotCCW'), { on: editing })
  add('Glyph', 'Rotate 90° Right', () => command('rotCW'), { on: editing })
  add('Glyph', 'Unite Selected Shapes', () => command('union'), { on: editing, keywords: 'merge pathfinder' })
  add('Glyph', 'Subtract Selected Shapes', () => command('subtract'), { on: editing, keywords: 'pathfinder' })
  add('Glyph', 'Intersect Selected Shapes', () => command('intersect'), { on: editing, keywords: 'pathfinder' })
  add('Glyph', 'Merge All Overlaps', () => command('mergeAll'), { on: editing, keywords: 'remove overlap' })
  add('Glyph', 'Fix Directions', () => command('fixDirection'), { on: editing, keywords: 'winding clockwise' })
  for (const [k, l, kw] of FILTERS) add('Glyph', `Filter: ${l}`, () => command(k), { on: editing, keywords: kw })
  add('Glyph', 'Clear Glyph', () => command('clearGlyph'), { on: editing, keywords: 'empty erase delete outlines components rebuild' })
  add('Glyph', 'Draft from Parts', () => command('draftLigature'), { on: editing, keywords: 'ae oe ij ligature oslash eth stroke' })
  add('Glyph', 'Build from Components', () => command('build'), { on: editing, keywords: 'accents composites' })
  add('Glyph', 'Interpolate Glyphs…', onInterpolate, { on: hasFont })
  add('Glyph', 'Restore to Last Saved', () => command('restore'), { on: editing, keywords: 'revert' })
  add('Font', 'Font Info…', onFontInfo, { on: hasFont, hint: 'Ctrl I', keywords: 'name metrics' })
  add('Font', 'Validate…', onValidate, { on: !off, keywords: 'check problems' })
  add('Font', 'Give Glyphs Their Standard Names', onFixNames, { on: !off, keywords: 'rename glyph74 circumflex ring dotlessi names' })
  add('Font', 'Add Master…', onFamily, { on: !off, keywords: 'family weight variable' })
  add('Font', 'Run Python Script…', () => onView('script'), { on: hasFont })
  for (const p of plugins) add('Plugins', p.name, () => onRunPlugin(p.id), { on: hasFont && !p.error, keywords: p.description })
  add('Plugins', 'Open your plugins folder…', onOpenPlugins)
  for (const [v, label] of [...VIEWS, ...TOOLS]) {
    add('Window', `${openPanels.includes(v) ? 'Hide' : 'Show'} ${label}`, () => onTogglePanel(v), { on: hasFont, keywords: 'panel' })
  }
  for (const n of [...Object.keys(PRESETS), ...Object.keys(readSaved())]) add('Window', `Workspace: ${n}`, () => onWorkspace({ open: n }), { on: hasFont, keywords: 'layout panels' })
  add('Window', 'Reset Layout', onResetLayout, { on: hasFont, keywords: 'panels' })
  add('Help', 'Getting Started', onWelcome)
  add('Help', 'Keyboard Shortcuts', () => setDialog('keys'))
  add('Help', 'About Scrifts', () => setDialog('about'))
  return (
    <>
      <Menubar className="h-auto border-0 bg-transparent p-0 shadow-none">
        <MenubarMenu>
          <MenubarTrigger className={trig}>File</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={onNew} disabled={busy}>New Font…<MenubarShortcut>Ctrl N</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={onOpen} disabled={busy}>Open…<MenubarShortcut>Ctrl O</MenubarShortcut></MenubarItem>
            <MenubarSub>
              <MenubarSubTrigger disabled={!recent.length}>Open Recent</MenubarSubTrigger>
              <MenubarSubContent className="max-w-96">
                {recent.map(r => (
                  <MenubarItem key={r.path} onSelect={() => onOpenPath(r.path)} title={r.path}>
                    <span className="truncate">{r.name}<span className="ml-0.5 font-mono text-[11px] text-muted-foreground">{ext(r.path)}</span></span>
                    <MenubarShortcut>{ago(r.opened)}</MenubarShortcut>
                  </MenubarItem>
                ))}
                <MenubarSeparator />
                <MenubarItem onSelect={onClearRecent}>Clear list</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem onSelect={onSave} disabled={off}>Save<MenubarShortcut>Ctrl S</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={onSaveAs} disabled={off}>Save As…<MenubarShortcut>Ctrl Shift S</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={onExportGlyphs} disabled={off}>Export as Glyphs File…</MenubarItem>
            <MenubarItem onSelect={() => onArtboards('export')} disabled={off}>Export for Illustrator…</MenubarItem>
            <MenubarItem onSelect={() => onArtboards('import')} disabled={off}>Import from Illustrator…</MenubarItem>
            <MenubarItem onSelect={onGenerate} disabled={off}>Generate Fonts…<MenubarShortcut>Ctrl Shift G</MenubarShortcut></MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => command('import')} disabled={!editing}>Import Outlines into Glyph…</MenubarItem>
            <MenubarItem onSelect={onTrace} disabled={!editing}>Trace Picture into Glyph…</MenubarItem>
            <MenubarItem onSelect={onSheet} disabled={off}>Template Sheets (write by hand)…</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={onProof} disabled={off}>Print Proof Sheet (or Save as PDF)…</MenubarItem>
            <MenubarItem onSelect={onClose} disabled={off}>Close Font</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={onSettings}>Settings…<MenubarShortcut>Ctrl ,</MenubarShortcut></MenubarItem>
            {onExit && <MenubarItem onSelect={onExit}>Exit</MenubarItem>}
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={trig}>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => command('undo')} disabled={!editing}>Undo<MenubarShortcut>Ctrl Z</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => command('redo')} disabled={!editing}>Redo<MenubarShortcut>Ctrl Shift Z</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={onUndoFont} disabled={off} title="Takes back the last plugin, script, rename, feature or font info change">Undo Last Font-Wide Change<MenubarShortcut>Ctrl Alt Z</MenubarShortcut></MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => command('selectAll')} disabled={!editing}>Select All Points<MenubarShortcut>Ctrl A</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => command('deselect')} disabled={!editing}>Deselect<MenubarShortcut>Esc</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => command('delete')} disabled={!editing}>Delete Points<MenubarShortcut>Del</MenubarShortcut></MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={trig}>View</MenubarTrigger>
          <MenubarContent>
            <MenubarRadioGroup value={view} onValueChange={onView}>
              {[['glyph', 'Glyph', '1'], ['spacing', 'Spacing', '2'], ['accents', 'Accents', '3'], ['features', 'Features', '4'], ['script', 'Script', '5']].map(([v, l, k]) => (
                <MenubarRadioItem key={v} value={v} disabled={!hasFont}>{l}<MenubarShortcut>Ctrl {k}</MenubarShortcut></MenubarRadioItem>
              ))}
            </MenubarRadioGroup>
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger disabled={!hasFont}>Glyph Grid</MenubarSubTrigger>
              <MenubarSubContent>
                <MenubarItem onSelect={() => command('grid:font')}>Font glyphs only</MenubarItem>
                <MenubarItem onSelect={() => command('grid:latin')}>Latin slots</MenubarItem>
                <MenubarItem onSelect={() => command('grid:unicode')}>All Unicode slots</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem onSelect={() => command('fit')} disabled={!editing}>Fit Glyph<MenubarShortcut>Ctrl 0</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => command('zoomIn')} disabled={!editing}>Zoom Glyph In<MenubarShortcut>Ctrl +</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => command('zoomOut')} disabled={!editing}>Zoom Glyph Out<MenubarShortcut>Ctrl −</MenubarShortcut></MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => zoomUi(1)}>Zoom Interface In<MenubarShortcut>Ctrl =</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => zoomUi(-1)}>Zoom Interface Out<MenubarShortcut>Ctrl −</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={() => zoomUi(0)}>Reset Interface Zoom<MenubarShortcut>Ctrl Shift 0</MenubarShortcut></MenubarItem>
            <MenubarSeparator />
            <MenubarCheckboxItem checked={!!aids?.guides} onCheckedChange={() => command('toggleGuides')} disabled={!editing}>Guides<MenubarShortcut>Ctrl ;</MenubarShortcut></MenubarCheckboxItem>
            <MenubarCheckboxItem checked={!!aids?.shadow} onCheckedChange={() => command('toggleShadow')} disabled={!editing}>Shadow Letter</MenubarCheckboxItem>
            <MenubarCheckboxItem checked={!!aids?.smart} onCheckedChange={() => command('toggleSmart')} disabled={!editing}>Smart Guides<MenubarShortcut>Ctrl U</MenubarShortcut></MenubarCheckboxItem>
            <MenubarCheckboxItem checked={!!aids?.grid} onCheckedChange={() => command('toggleGrid')} disabled={!editing}>Grid<MenubarShortcut>Ctrl '</MenubarShortcut></MenubarCheckboxItem>
            <MenubarCheckboxItem checked={!!aids?.rulers} onCheckedChange={() => command('toggleRulers')} disabled={!editing}>Rulers<MenubarShortcut>Ctrl R</MenubarShortcut></MenubarCheckboxItem>
            <MenubarSeparator />
            <MenubarItem onSelect={onCompare} disabled={off}>{comparing ? `Stop Comparing with ${comparing}` : 'Compare with Another Font…'}</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={trig}>Glyph</MenubarTrigger>
          <MenubarContent>
            <MenubarSub>
              <MenubarSubTrigger disabled={!editing}>Tool</MenubarSubTrigger>
              <MenubarSubContent>
                {([['object', 'Selection', 'V'], ['select', 'Direct Selection', 'A'], ['pen', 'Pen', 'P'], ['rect', 'Rectangle', 'M'], ['oval', 'Oval', 'L'], ['shaper', 'Shape Builder', 'Shift M'], ['hand', 'Hand', 'H'], ['zoom', 'Zoom', 'Z'], ['measure', 'Measure', 'K']] as const).map(([t, l, k]) => (
                  <MenubarItem key={t} onSelect={() => command(`tool:${t}`)}>{l}<MenubarShortcut>{k}</MenubarShortcut></MenubarItem>
                ))}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarSeparator />
            <MenubarItem onSelect={() => command('flipH')} disabled={!editing}>Flip Horizontal</MenubarItem>
            <MenubarItem onSelect={() => command('flipV')} disabled={!editing}>Flip Vertical</MenubarItem>
            <MenubarItem onSelect={() => command('rotCCW')} disabled={!editing}>Rotate 90° Left</MenubarItem>
            <MenubarItem onSelect={() => command('rotCW')} disabled={!editing}>Rotate 90° Right</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => command('union')} disabled={!editing}>Unite Selected Shapes</MenubarItem>
            <MenubarItem onSelect={() => command('subtract')} disabled={!editing}>Subtract Selected Shapes</MenubarItem>
            <MenubarItem onSelect={() => command('intersect')} disabled={!editing}>Intersect Selected Shapes</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => command('mergeAll')} disabled={!editing}>Merge All Overlaps</MenubarItem>
            <MenubarItem onSelect={() => command('fixDirection')} disabled={!editing}>Fix Directions</MenubarItem>
            <MenubarSub>
              <MenubarSubTrigger disabled={!editing}>Filters</MenubarSubTrigger>
              <MenubarSubContent>
                {FILTERS.map(([k, l]) => <MenubarItem key={k} onSelect={() => command(k)}>{l}</MenubarItem>)}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarItem onSelect={() => command('clearGlyph')} disabled={!editing}>Clear Glyph</MenubarItem>
            <MenubarItem onSelect={() => command('build')} disabled={!editing}>Build from Components</MenubarItem>
            <MenubarItem onSelect={() => command('draftLigature')} disabled={!editing}>Draft from Parts</MenubarItem>
            <MenubarItem onSelect={onInterpolate} disabled={!hasFont}>Interpolate Glyphs…</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => command('restore')} disabled={!editing}>Restore to Last Saved</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={trig}>Font</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={onFontInfo} disabled={!hasFont}>Font Info…<MenubarShortcut>Ctrl I</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={onValidate} disabled={off}>Validate…</MenubarItem>
            <MenubarItem onSelect={onFixNames} disabled={off}>Give Glyphs Their Standard Names</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={onFamily} disabled={off}>Add Master…</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={() => onView('accents')} disabled={!hasFont}>Accents &amp; Composites…</MenubarItem>
            <MenubarItem onSelect={() => onView('script')} disabled={!hasFont}>Run Python Script…</MenubarItem>
            <MenubarSeparator />
            <MenubarItem onSelect={onCompare} disabled={off}>{comparing ? `Stop Comparing with ${comparing}` : 'Compare with Another Font…'}</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={trig} onPointerDown={onLoadPlugins}>Plugins</MenubarTrigger>
          <MenubarContent>
            {plugins.length === 0 && <MenubarItem disabled>No plugins found</MenubarItem>}
            {['bundled', 'yours'].map(src => {
              const group = plugins.filter(p => p.source === src)
              return group.length > 0 && (
                <div key={src}>
                  <div className="px-2 py-1 text-[10px] font-medium text-muted-foreground">{src === 'bundled' ? 'Included with Scrifts' : 'Yours'}</div>
                  {group.map(p => (
                    <MenubarItem key={p.id} disabled={!hasFont || !!p.error} title={p.error ? `Can't run: ${p.error}` : p.description} onSelect={() => onRunPlugin(p.id)}>
                      {p.name}{p.error && <span className="ml-2 text-destructive">broken</span>}
                    </MenubarItem>
                  ))}
                </div>
              )
            })}
            <MenubarSeparator />
            <MenubarItem onSelect={onOpenPlugins}>Open your plugins folder…</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={trig}>Window</MenubarTrigger>
          <MenubarContent>
            {[VIEWS, TOOLS].map((group, gi) => (
              <div key={gi}>
                {gi > 0 && <MenubarSeparator />}
                {group.map(([v, label]) => (
                  <MenubarCheckboxItem key={v} checked={openPanels.includes(v)} disabled={!hasFont} onCheckedChange={() => onTogglePanel(v)}>{label}</MenubarCheckboxItem>
                ))}
              </div>
            ))}
            <MenubarSeparator />
            <MenubarSub>
              <MenubarSubTrigger disabled={!hasFont}>Workspace</MenubarSubTrigger>
              <MenubarSubContent>
                {[...Object.keys(PRESETS), ...Object.keys(readSaved())].map((n, i) => <MenubarItem key={n} onSelect={() => onWorkspace({ open: n })}>{n}{i < 10 && <MenubarShortcut>Ctrl Alt {(i + 1) % 10}</MenubarShortcut>}</MenubarItem>)}
                <MenubarSeparator />
                <MenubarItem onSelect={() => { const n = window.prompt('Name this layout')?.trim(); if (n && (!(n in readSaved()) || window.confirm(`Replace the saved layout “${n}”?`))) onWorkspace({ save: n }) }}>Save Layout As…</MenubarItem>
                {Object.keys(readSaved()).map(n => <MenubarItem key={n} onSelect={() => { const { [n]: _, ...rest } = readSaved(); writeSaved(rest) }}>Delete “{n}”</MenubarItem>)}
              </MenubarSubContent>
            </MenubarSub>
            <MenubarItem onSelect={onResetLayout} disabled={!hasFont}>Reset Layout</MenubarItem>
          </MenubarContent>
        </MenubarMenu>

        <MenubarMenu>
          <MenubarTrigger className={trig}>Help</MenubarTrigger>
          <MenubarContent>
            <MenubarItem onSelect={() => setPaletteOpen(true)}>Command Palette…<MenubarShortcut>Ctrl K</MenubarShortcut></MenubarItem>
            <MenubarItem onSelect={onWelcome}>Getting Started</MenubarItem>
            <MenubarItem onSelect={() => setDialog('keys')}>Keyboard Shortcuts</MenubarItem>
            <MenubarItem onSelect={() => setDialog('about')}>About Scrifts</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={items} />
      <Dialog open={dialog === 'keys'} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Glyph-view keys work when the canvas has focus (click it first).</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {SHORTCUTS.map(([k, d]) => <Fragment key={k}><Kbd className="justify-self-start">{k}</Kbd><span>{d}</span></Fragment>)}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'about'} onOpenChange={o => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="sr-only"><DialogTitle>Scrifts</DialogTitle><DialogDescription>About Scrifts</DialogDescription></DialogHeader>
          <AboutContent />
        </DialogContent>
      </Dialog>
    </>
  )
}
