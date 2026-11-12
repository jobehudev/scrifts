import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check as CheckIcon, FilePlus2, FolderOpen, FolderSearch, Layers2, Loader2, X } from 'lucide-react'
import { RecentPreview } from './RecentPreview'
import { api, bench, cancelAll, lastCancel, OutlineStore, outlines, session, type FontInfo, type Location, type Reference } from './api'
import type { DockHandle } from './Dock'
import { PRESETS } from './workspaces'
import { pointFocus } from './pointFocus'
import type { PluginInfo } from './PluginDialog'
import { MenuBar } from './MenuBar'
import { propsStore } from './propsStore'
import { latestOnly } from './latestOnly'
import type { NewFont } from './NewFontDialog'
import { AxisDialog, type Brace, CheckDialog, EditMasterDialog, FamilyDialog, MasterBar, RemoveMasterDialog, SoloMasterBar, samePath, type BlendGlyph, type Check, type Family, type Master, type MasterOps } from './FamilyBar'
import { useSettings, zoomUi } from './settings'
import { addRecent, ago, clearRecent, ext, loadRecent, removeRecent } from './recent'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// Only the start screen is needed at first. The dock, the views, the panels and the dialogs load when they are first used.
const Dock = lazy(() => import('./Dock').then(m => ({ default: m.Dock })))
const GlyphGrid = lazy(() => import('./GlyphGrid').then(m => ({ default: m.GlyphGrid })))
const GlyphView = lazy(() => import('./GlyphView').then(m => ({ default: m.GlyphView })))
const SpacingView = lazy(() => import('./SpacingView').then(m => ({ default: m.SpacingView })))
const AccentView = lazy(() => import('./AccentView').then(m => ({ default: m.AccentView })))
const FeaturesView = lazy(() => import('./FeaturesView').then(m => ({ default: m.FeaturesView })))
const ScriptView = lazy(() => import('./ScriptView').then(m => ({ default: m.ScriptView })))
const VariablePanel = lazy(() => import('./VariablePanel').then(m => ({ default: m.VariablePanel })))
const SmartPanel = lazy(() => import('./SmartPanel').then(m => ({ default: m.SmartPanel })))
const PropertiesPanel = lazy(() => import('./PropertiesPanel').then(m => ({ default: m.PropertiesPanel })))
const ComparePanel = lazy(() => import('./ComparePanel').then(m => ({ default: m.ComparePanel })))
const SnapshotsPanel = lazy(() => import('./SnapshotsPanel').then(m => ({ default: m.SnapshotsPanel })))
const PrimitivesPanel = lazy(() => import('./PrimitivesPanel').then(m => ({ default: m.PrimitivesPanel })))
const GlyphInfoPanel = lazy(() => import('./GlyphInfoPanel').then(m => ({ default: m.GlyphInfoPanel })))
const SettingsDialog = lazy(() => import('./SettingsDialog').then(m => ({ default: m.SettingsDialog })))
const FontInfoDialog = lazy(() => import('./FontInfoDialog').then(m => ({ default: m.FontInfoDialog })))
const GenerateDialog = lazy(() => import('./GenerateDialog').then(m => ({ default: m.GenerateDialog })))
const ValidateDialog = lazy(() => import('./GenerateDialog').then(m => ({ default: m.ValidateDialog })))
const WelcomeDialog = lazy(() => import('./WelcomeDialog').then(m => ({ default: m.WelcomeDialog })))
const TraceDialog = lazy(() => import('./TraceDialog').then(m => ({ default: m.TraceDialog })))
const SheetDialog = lazy(() => import('./SheetDialog').then(m => ({ default: m.SheetDialog })))
const ArtboardDialog = lazy(() => import('./ArtboardDialog').then(m => ({ default: m.ArtboardDialog })))
const PluginDialog = lazy(() => import('./PluginDialog').then(m => ({ default: m.PluginDialog })))
const InterpolateDialog = lazy(() => import('./InterpolateDialog').then(m => ({ default: m.InterpolateDialog })))
const NewFontDialog = lazy(() => import('./NewFontDialog').then(m => ({ default: m.NewFontDialog })))

/** While the start screen is showing, fetch what opening a font needs (quietly, after the first paint), so opening one doesn't wait for the download. */
function usePrefetchWorkspace() {
  useEffect(() => {
    const id = window.setTimeout(() => {
      void import('./Dock'); void import('./GlyphView'); void import('./GlyphGrid'); void import('./SpacingView')
    }, 400)
    return () => window.clearTimeout(id)
  }, [])
}

/** True from the first time `open` is true: a dialog's code is fetched when it is first wanted, then kept. */
function useEver(open: boolean) {
  const ever = useRef(false)
  if (open) ever.current = true
  return ever.current
}

type Ghost = Reference & { label: string; path: string }

const pick = (mode: 'open' | 'save', initial?: string) =>
  api<{ path: string | null }>('/api/pick', { mode, initial }).then(r => r.path)

type TauriWindow = {
  minimize: () => void
  toggleMaximize: () => void
  isMaximized: () => Promise<boolean>
  close: () => void
  startDragging: () => void
}

const getTauriWindow = (): TauriWindow | undefined =>
  (window as unknown as { __TAURI__?: { window?: { getCurrentWindow?: () => TauriWindow } } })
    .__TAURI__?.window?.getCurrentWindow?.()

/** Minimise, maximise/restore and close, drawn the way Windows 11 draws them: 46 px wide, the full height of
 * the bar, Segoe's own caption glyphs, and red only behind close. */
function CaptionButtons({ win }: { win: TauriWindow }) {
  const [max, setMax] = useState(false)
  useEffect(() => {
    const check = () => { void win.isMaximized().then(setMax).catch(() => {}) }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [win])
  // Snap Layouts: Windows only offers them on its own maximize button, so hovering ours for a moment asks
  // for them the way Win+Z does (tauri-plugin-decorum's command), like Windows' own delay
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tauri = (window as unknown as { __TAURI__?: { core?: { invoke: (cmd: string) => Promise<unknown> }; window?: { getCurrentWindow?: () => { setFocus: () => Promise<void> } } } }).__TAURI__
  const snapSoon = () => {
    snapTimer.current = setTimeout(() => {
      void (tauri?.window?.getCurrentWindow?.().setFocus() ?? Promise.resolve()).then(() => tauri?.core?.invoke('plugin:decorum|show_snap_overlay')).catch(() => {})
    }, 620)
  }
  const snapCancel = () => { if (snapTimer.current) clearTimeout(snapTimer.current); snapTimer.current = null }
  const btn = 'inline-flex w-[46px] items-center justify-center self-stretch text-[10px] text-foreground/90 transition-colors'
  const glyph = { fontFamily: "'Segoe Fluent Icons', 'Segoe MDL2 Assets'" }
  return (
    <div className="-my-1 flex self-stretch">
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => win.minimize()} className={`${btn} hover:bg-foreground/10`} style={glyph}>{''}</button>
      <button type="button" aria-label={max ? 'Restore' : 'Maximize'} title={max ? 'Restore down' : 'Maximize'} onClick={() => { snapCancel(); win.toggleMaximize() }} onMouseEnter={snapSoon} onMouseLeave={snapCancel}
        className={`${btn} hover:bg-foreground/10`} style={glyph}>{max ? '' : ''}</button>
      <button type="button" aria-label="Close" title="Close" onClick={() => win.close()} className={`${btn} hover:bg-[#c42b1c] hover:text-white`} style={glyph}>{''}</button>
    </div>
  )
}

function Tip({ label, keys, children }: { label: string; keys?: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}{keys && <Kbd className="ml-2">{keys}</Kbd>}</TooltipContent>
    </Tooltip>
  )
}

export default function App() {
  const [font, setFont] = useState<FontInfo | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [loc, setLoc] = useState<Location | null>(null)
  const [guides, setGuidesState] = useState<number[]>([])
  const [vguides, setVGuidesState] = useState<number[]>([])
  const [reference, setReference] = useState<Reference | null>(null)
  const [family, setFamily] = useState<Family | null>(null)
  const [familyDialog, setFamilyDialog] = useState<'new' | 'add' | 'blend'>('add')
  const [weight, setWeight] = useState<number | null>(null)
  const [axisVals, setAxisVals] = useState<Record<string, number>>({})  // preview position on the axes after Weight
  const [axisOpen, setAxisOpen] = useState(false)
  const [blend, setBlend] = useState<{ name: string; weight: number; glyph: BlendGlyph | null } | null>(null)
  const [blendRev, setBlendRev] = useState(0)
  const [familyOpen, setFamilyOpen] = useState(false)
  /** The family's other masters, kept open: drawn as ghosts, and holding their unsaved edits. */
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const ghostsRef = useRef<Ghost[]>([])
  const [check, setCheck] = useState<Check | null>(null)
  const [checkOpen, setCheckOpen] = useState(false)
  const [removing, setRemoving] = useState<Master | null>(null)
  const [editingMaster, setEditingMaster] = useState<Master | null>(null)

  // Scrifts has its own right-click menus; the browser's (Back, Reload, Inspect…) is only kept in text fields
  useEffect(() => {
    const f = (e: MouseEvent) => { if (!(e.target as Element).closest?.('input, textarea, [contenteditable="true"]')) e.preventDefault() }
    document.addEventListener('contextmenu', f)
    return () => document.removeEventListener('contextmenu', f)
  }, [])
  const checkTimer = useRef(0)
  const [busy, setBusy] = useState<string | null>(null)
  const busyRef = useRef<string | null>(null)
  const staleWarned = useRef(false)
  useEffect(() => { busyRef.current = busy })
  const [view, setView] = useState(() => localStorage.getItem('forge.view') ?? 'glyph')
  const [status, setStatus] = useState('')
  const [recent, setRecent] = useState(loadRecent)
  const [newOpen, setNewOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [genOpen, setGenOpen] = useState(false)
  const [validateOpen, setValidateOpen] = useState(false)
  const [interpOpen, setInterpOpen] = useState(false)
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [pluginOpen, setPluginOpen] = useState<string | null>(null)
  const [artMode, setArtMode] = useState<'export' | 'import' | null>(null)
  const [traceOpen, setTraceOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const everTrace = useEver(traceOpen), everSheet = useEver(sheetOpen)
  // a first run (nothing opened before, never closed the welcome) starts with it; Help > Getting Started brings it back
  const [missing, setMissing] = useState<string[] | null>(null)
  const titledFont = font ? (font.familyname || font.fontname) : null
  useEffect(() => { document.title = titledFont ? `${titledFont} · Scrifts` : 'Scrifts' }, [titledFont])  // the window and its taskbar button say which font is open
  useEffect(() => {
    if (font || !recent.length) return
    let alive = true
    api<{ missing: string[] }>('/api/missing', { paths: recent.map(r => r.path) }).then(r => { if (alive) setMissing(r.missing) }).catch(() => { if (alive) setMissing([]) })
    return () => { alive = false }
  }, [font, recent])
  const [welcomeOpen,setWelcomeOpen] = useState(() => !localStorage.getItem('forge.welcomed') && loadRecent().length === 0)
  const closeWelcome = useCallback(() => { localStorage.setItem('forge.welcomed', '1'); setWelcomeOpen(false) }, [])
  const loadPlugins = useCallback(() => { void api<{ plugins: PluginInfo[] }>('/api/plugins').then(r => setPlugins(r.plugins)).catch(() => {}) }, [])
  useEffect(() => { loadPlugins() }, [loadPlugins])
  usePrefetchWorkspace()
  const everInfo = useEver(infoOpen), everInterp = useEver(interpOpen), everGen = useEver(genOpen), everValidate = useEver(validateOpen)
  const everNew = useEver(newOpen), everSettings = useEver(settingsOpen)
  const [uiFontRev, setUiFontRev] = useState(0)  // bump to rebuild the UI font from the current outlines
  const settings = useSettings()
  // the start screen wordmark: the lighter of the theme's background and accent, so it always belongs to the theme
  const [logoColour, setLogoColour] = useState('#fff')
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement)
    const picks = [cs.getPropertyValue('--background'), cs.getPropertyValue('--primary')].map(c => c.trim()).filter(Boolean)
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!ctx || !picks.length) return
    const light = (c: string) => {  // relative luminance, whatever notation the theme uses (oklch, hex)
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    setLogoColour(picks.reduce((a, b) => (light(b) > light(a) ? b : a)))
  }, [settings.theme, settings.custom])
  const dockRef = useRef<DockHandle | null>(null)
  const [openPanels, setOpenPanels] = useState<string[]>([])
  const hasAxes = (font?.axes.length ?? 0) > 0
  // a variable font needs its axes panel; open it if the saved layout has none
  const axesEnsured = useRef<string | null>(null)  // once per font, so closing the panel by hand sticks
  useEffect(() => {
    if (!hasAxes || !openPanels.length || !font || axesEnsured.current === font.path) return
    axesEnsured.current = font.path
    dockRef.current?.ensure('variable')
  }, [hasAxes, font, openPanels])
  // the first time the pen is picked, make sure the Properties panel is there: that is where its settings are
  useEffect(() => propsStore.subscribe(() => {
    if (propsStore.get()?.tool !== 'pen' || localStorage.getItem('forge.propsShown')) return
    localStorage.setItem('forge.propsShown', '1')
    dockRef.current?.ensure('properties')
  }), [])
  const [layersEl, setLayersEl] = useState<HTMLElement | null>(null)  // the dock's Layers panel, which the glyph editor draws into
  /** Bring a view forward in the dock (opening it if it isn't there). */
  useEffect(() => { if (font && sel) localStorage.setItem('forge.lastGlyph:' + font.path, sel) }, [font, sel])
  const switchView = useCallback((v: string) => { localStorage.setItem('forge.view', v); if (dockRef.current) dockRef.current.show(v); else setView(v) }, [])


  const run = useCallback(async <T,>(label: string, f: () => Promise<T>) => {
    setBusy(label)
    const t0 = performance.now()
    try {
      const r = await f()
      setStatus(`${label} · ${Math.round(performance.now() - t0)} ms`)
      return r
    } catch (e) {
      const msg = (e as Error).message
      setStatus(`${label} failed`)
      if ((e as Error).name !== 'AbortError') toast.error(`${label} failed`, { description: msg })
    } finally {
      setBusy(null)
    }
  }, [])

  /** Open (or create) a font and make it this page's font. */
  const adopt = useCallback(async (load: () => Promise<FontInfo & { fid: number }>, keepSel?: string | null) => {
    outlines.clear()
    setLoc(null)
    Object.assign(bench, { start: performance.now(), opened: 0, firstPaint: 0 })
    const old = session.fid
    session.fid = 0  // the open call itself is not addressed to a font
    let f: FontInfo & { fid: number }
    try {
      f = await load()
    } catch (e) {
      session.fid = old  // keep showing (and addressing) the previous font
      throw e
    }
    session.fid = f.fid
    if (old) void fetch('/api/close', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fid: old }) })
    bench.opened = performance.now() - bench.start
    localStorage.setItem('forge.path', f.path)
    setRecent(addRecent({ path: f.path, name: f.familyname || f.fontname, glyphs: f.glyphs.length, opened: Date.now() }))
    setFont(f)
    setGuidesState(await api<number[]>('/api/guides'))
    setVGuidesState(await api<number[]>('/api/vguides'))
    const want = keepSel ?? localStorage.getItem('forge.lastGlyph:' + f.path)  // the glyph you were on when you last had this font open
    setSel(want && f.glyphs.some(g => g.name === want) ? want
      : f.glyphs.find(g => g.unicode === 0x61)?.name ?? f.glyphs[0]?.name ?? null)
  }, [])

  const openPath = useCallback((path: string) => run('Open', async () => {
    if (path.toLowerCase().endsWith('.glyphs')) {
      // a Glyphs file becomes a Scrifts project folder next to it (one .sfd per master + a .designspace); the file itself is not touched
      const r = await api<{ designspace: string | null; default: string; masters: string[]; skipped: string[]; braces?: number; reused: boolean; folder: string }>('/api/import/glyphs', { path })
      if (r.designspace) localStorage.setItem('forge.family', r.designspace)
      toast.success(r.reused ? 'Reopened your Glyphs project' : `Imported ${r.masters.length} master${r.masters.length > 1 ? 's' : ''}${r.braces ? ` and ${r.braces} intermediate layer${r.braces > 1 ? 's (as brace layers)' : ' (as a brace layer)'}` : ''} from the Glyphs file`, {
        description: `${r.folder}${r.skipped.length ? `
Not imported: ${r.skipped.join(', ')}.` : ''}`,
      })
      path = r.default
    }
    if (path.toLowerCase().endsWith('.designspace')) {
      // a family: open its default master; the others come up as tabs
      const fam = await api<Family>(`/api/family?path=${encodeURIComponent(path)}`)
      localStorage.setItem('forge.family', fam.path)
      const def = fam.masters.find(m => m.weight === fam.axes[0]?.default) ?? fam.masters[0]
      path = def.path
    }
    await adopt(() => api<FontInfo & { fid: number }>('/api/open', { path }))
  }), [run, adopt])

  /** Open the masters that should be ghosts; close the rest (only when `close`). */
  const syncGhosts = useCallback(async (fam: Family | null, active: string | null, close: boolean) => {
    const want = fam && active ? fam.masters.filter(m => !samePath(m.path, active)) : []
    const cur = ghostsRef.current
    const keep = close ? cur.filter(g => want.some(m => samePath(m.path, g.path))) : cur
    for (const g of cur) if (!keep.includes(g)) void api('/api/close', { fid: g.fid }).catch(() => {})
    const add = await Promise.all(want.filter(m => !keep.some(g => samePath(g.path, m.path))).map(async m => {
      const info = await api<FontInfo & { fid: number }>('/api/open', { path: m.path })
      return { fid: info.fid, info, store: new OutlineStore(info.fid), label: m.name, path: m.path }
    }))
    ghostsRef.current = [...keep, ...add]
    setGhosts(ghostsRef.current)
  }, [])

  // which family (if any) the open font is a master of
  useEffect(() => {
    if (!font) { setFamily(null); return }
    // found from the font itself: a .designspace next to it that lists it
    api<Family | null>(`/api/family/of?font=${encodeURIComponent(font.path)}`)
      .then(f => { setFamily(f); if (f) localStorage.setItem('forge.family', f.path) })
      .catch(() => setFamily(null))
  }, [font?.path])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void syncGhosts(family, font?.path ?? null, true).catch(() => {}) }, [family, font?.path, syncGhosts])

  const runCheck = useCallback((fam: Family | null) => {
    if (!fam || fam.masters.length < 2) { setCheck(null); return }
    setCheck(null)
    api<Check>(`/api/family/check?path=${encodeURIComponent(fam.path)}`).then(setCheck).catch(() => {})
  }, [])
  useEffect(() => { runCheck(family) }, [family, runCheck])
  /** After an outline edit: check again once the editing pauses. */
  const recheckSoon = useCallback(() => {
    setBlendRev(r => r + 1)
    clearTimeout(checkTimer.current)
    checkTimer.current = window.setTimeout(() => runCheck(family), 700)
  }, [family, runCheck])
  // the selected glyph blended at the slider's weight
  // (one request at a time, for the newest weight: see SpacingView)
  const blendWanted = useRef({ family, weight, axisVals, sel })
  const blendPump = useRef(latestOnly(async () => {
    const w = blendWanted.current
    if (!w.family || w.weight === null || !w.sel || w.family.masters.length < 2) return
    const r = await api<Record<string, BlendGlyph | null>>('/api/family/blend', { path: w.family.path, weight: w.weight, location: w.axisVals, names: [w.sel] })
    if (blendWanted.current.weight === null) return  // the preview was switched off meanwhile
    setBlend({ name: w.sel, weight: w.weight, glyph: r[w.sel] ?? null })
  }))
  useEffect(() => {
    blendWanted.current = { family, weight, axisVals, sel }
    if (!family || weight === null || !sel || family.masters.length < 2) { setBlend(null); return }
    blendPump.current()
  }, [family, weight, axisVals, sel, blendRev])

  const marks = useMemo(() => new Set(check?.glyphs.map(g => g.name)), [check])

  const goMaster = useCallback(async (fam: Family, m: Master) => {
    // the master we leave stays open as a ghost first, so its unsaved edits stay in memory
    await syncGhosts(fam, m.path, false)
    await adopt(() => api<FontInfo & { fid: number }>('/api/open', { path: m.path }), sel)
  }, [syncGhosts, adopt, sel])

  /** Copy glyphs between masters; then every view of the masters involved is stale. */
  const masterOps = useMemo<MasterOps | undefined>(() => family && font && family.masters.length > 1 ? {
    current: font.path,
    others: family.masters.filter(m => !samePath(m.path, font.path)).map(m => ({ label: m.name, path: m.path })),
    copy: async (source, targets, names) => {
      await api('/api/family/copy-glyph', { source, targets, names })
      for (const g of ghostsRef.current) g.store.clear()
      if (targets.some(t => samePath(t, font.path))) outlines.clear()
      runCheck(family)
      setBlendRev(r => r + 1)
    },
  } : undefined, [family, font, runCheck])

  const removeMaster = useCallback((m: Master) => { if (family) run(`Remove ${m.name}`, async () => {
    setRemoving(null)
    if (font && samePath(m.path, font.path)) {
      // removing the master being edited: edit the nearest other one first
      const next = family.masters.filter(x => x !== m).sort((a, b) => Math.abs(a.weight - m.weight) - Math.abs(b.weight - m.weight))[0]
      await goMaster(family, next)
    }
    setFamily(await api<Family>('/api/family/remove', { path: family.path, master: m.path }))
  }) }, [family, font, run, goMaster])  // eslint-disable-line react-hooks/exhaustive-deps

  const editMaster = useCallback((style: string, w: number) => { if (family && font) run('Edit master', async () => {
    setFamily(await api<Family>('/api/family/edit-master', { family: family.path, master: font.path, style, weight: w }))
    setEditingMaster(null)
    setWeight(null)
    setBlendRev(r => r + 1)
    void refresh()
  }) }, [family, font, run])  // eslint-disable-line react-hooks/exhaustive-deps

  // choosing a master ends any weight preview: that master is now what is on screen, and it can be edited
  const switchMaster = useCallback((m: Master) => { if (family) { setWeight(null); run(`Master ${m.name}`, () => goMaster(family, m)) } }, [family, run, goMaster])

  const addAxis = useCallback((a: { name: string; tag: string; min: number; default: number; max: number }) => { if (family) run('Add axis', async () => {
    setFamily(await api<Family>('/api/family/axis', { family: family.path, ...a }))
    setAxisOpen(false)
  }) }, [family, run])

  const addBrace = useCallback(() => { if (family && sel && weight !== null) run('Add brace layer', async () => {
    const fam = await api<Family>('/api/family/brace', { path: family.path, glyph: sel, weight, location: axisVals })
    setFamily(fam)
    setWeight(null)
    const b = fam.braces.find(x => x.glyphs.includes(sel) && x.weight === weight && Object.entries(axisVals).every(([k, v]) => x.location[k] === v))
    if (b) await goMaster(fam, b)
  }) }, [family, sel, weight, axisVals, run, goMaster])

  const removeBrace = useCallback((b: Brace, glyph?: string) => { if (family) run('Remove brace layer', async () => {
    const fam = await api<Family>('/api/family/brace/remove', { path: family.path, brace: b.path, glyph })
    setFamily(fam)
    setBlendRev(r => r + 1)
    if (font && samePath(font.path, b.path) && !fam.braces.some(x => samePath(x.path, b.path))) {
      const def = fam.masters.find(m => fam.axes.every(a => (m.location[a.name] ?? a.default) === a.default)) ?? fam.masters[0]
      await goMaster(fam, def)
    }
  }) }, [family, font, run, goMaster])

  const familySubmit = useCallback((style: string, weight: number, thisWeight: number | undefined, location: Record<string, number>) => { if (font) run('Add master', async () => {
    if (familyDialog === 'new') {
      // this font becomes the family's first master, then the new one is added to it
      const path = `${font.path.replace(/[\\/][^\\/]*$/, '')}\\${font.familyname.replace(/\s+/g, '')}.designspace`
      const first = await api<Family>('/api/family/new', { path, weight: thisWeight ?? 400 })
      localStorage.setItem('forge.family', first.path)
      const fam = await api<Family>('/api/family/add', { family: first.path, style, weight })
      setFamily(fam)
      await goMaster(fam, fam.masters.find(m => m.name === style)!)
    } else if (family && familyDialog === 'blend') {
      const r = await api<{ family: Family; copied: string[] }>('/api/family/blend-master', { path: family.path, style, weight, location })
      setFamily(r.family)
      setWeight(null)
      if (r.copied.length) toast.warning(`${r.copied.length} glyphs copied, not blended`, { description: `Their masters don't match: ${r.copied.slice(0, 12).join(' ')}${r.copied.length > 12 ? ' …' : ''}` })
      await goMaster(r.family, r.family.masters.find(m => m.name === style)!)
    } else if (family) {
      const fam = await api<Family>('/api/family/add', { family: family.path, style, weight, location })
      setFamily(fam)
      await goMaster(fam, fam.masters.find(m => m.name === style)!)
    }
    setFamilyOpen(false)
  }) }, [font, family, familyDialog, run, goMaster])


  const newFont = useCallback((spec: NewFont) => {
    setNewOpen(false)
    run('New font', async () => {
      const dir = recent[0]?.path.replace(/[\\/][^\\/]*$/, '') ?? ''
      const name = `${spec.family}-${spec.style}`.replace(/\s+/g, '') + '.sfd'
      const path = await pick('save', dir ? `${dir}\\${name}` : name)
      if (!path) return
      await adopt(() => api<FontInfo & { fid: number }>('/api/new', { path, ...spec }))
      setGuidesState([])
      if (view !== 'glyph') switchView('glyph')
      localStorage.setItem('forge.grid', 'latin')  // a new font is all empty slots: show them
      window.dispatchEvent(new CustomEvent('forge:cmd', { detail: 'grid:latin' }))
    })
  }, [run, adopt, recent, view])

  /** Re-read the glyph list after a script or a new glyph; drop cached outlines. */
  /** Font-wide guides live in FontForge's guide layer, so they are saved with the font. */
  const setGuides = useCallback((ys: number[]) => {
    setGuidesState(ys)
    api<number[]>('/api/guides', { ys }).then(setGuidesState).catch(() => {})
  }, [])

  const setVGuides = useCallback((xs: number[]) => {
    setVGuidesState(xs)
    api<number[]>('/api/vguides', { xs }).then(setVGuidesState).catch(() => {})
  }, [])

  /** A second font, opened read-only, to compare alignment against. */
  const compare = useCallback(async () => {
    if (reference) {
      void api('/api/close', { fid: reference.fid })
      setReference(null)
      return
    }
    const path = await pick('open', font?.path)
    if (!path) return
    run('Open reference', async () => {
      const info = await api<FontInfo & { fid: number }>('/api/open', { path })
      setReference({ fid: info.fid, info, store: new OutlineStore(info.fid) })
    })
  }, [reference, font, run])

  const refresh = useCallback(async () => {
    const info = await api<FontInfo>(`/api/info`)
    outlines.clear()
    setFont(f => f && { ...f, glyphs: info.glyphs })
  }, [])

  /** After something changed many glyphs at once (a plugin, an import, a trace): forget what was drawn and look again. */
  const afterBulkEdit = useCallback(() => {
    outlines.clear(); for (const g of ghostsRef.current) g.store.clear(); void refresh(); setBlendRev(r => r + 1)
  }, [refresh])

  /** Ctrl Alt Z: the last plugin, script, rename or other change across the font, taken back (the worker kept a copy from just before it). */
  const undoFont = useCallback(() => run('Undo', async () => {
    const r = await api<{ undone: string; left: number }>('/api/undo-font', {})
    afterBulkEdit()
    toast.success(`Took back ${r.undone}`, { description: r.left ? `${r.left} more font-wide change${r.left > 1 ? 's' : ''} can be taken back.` : undefined })
  }), [run, afterBulkEdit])

  const create = useCallback((unicode: number) => run('Create glyph', async () => {
    const g = await api<{ name: string }>('/api/create', { unicode })
    await refresh()
    setSel(g.name)
    switchView('glyph')
  }), [run, refresh])

  useEffect(() => {
    const f = (e: Event) => { const n = (e as CustomEvent<string>).detail; void refresh().then(() => setSel(n)) }
    window.addEventListener('forge:new-glyph', f)
    return () => window.removeEventListener('forge:new-glyph', f)
  }, [refresh])

  /** Write the family (or the open font) as a Glyphs file. Masters go as they are in memory, unsaved edits included. */
  const exportGlyphs = useCallback(() => font && run('Export', async () => {
    const stem = font.path.replace(/\.[^.\/]+$/, '')
    let path = await pick('save', `${stem}.glyphs`)
    if (!path) return
    if (!path.toLowerCase().endsWith('.glyphs')) path += '.glyphs'
    await api('/api/export/glyphs', family ? { path, family: family.path } : { path, fid: session.fid })
    toast.success('Exported as a Glyphs file', { description: path })
  }), [font, family, run])

  /** Save everything that can be saved in place; true if something unsaved is still left (a binary font). */
  const flushSaves = useCallback(async () => {
    let left = false
    for (const fid of [session.fid, ...ghostsRef.current.map(g => g.fid)]) {
      if (!fid) continue
      const r = await api<{ saved: boolean; changed: boolean }>('/api/autosave', { fid }).catch(() => null)
      if (r?.changed) left = true
    }
    return left
  }, [])

  const closeFont = useCallback(() => {
    if (session.fid) void api('/api/close', { fid: session.fid })
    if (reference) void api('/api/close', { fid: reference.fid })
    session.fid = 0
    outlines.clear()
    setReference(null)
    setFont(null)
    setSel(null)
    setStatus('')
  }, [reference])

  // Closing the window (its button, Alt F4, the taskbar): save what can be saved in place first, and ask before
  // dropping what cannot. The desktop app stops the background service right after, so nothing is saved later.
  useEffect(() => {
    const w = getTauriWindow() as unknown as { onCloseRequested?: (f: (e: { preventDefault: () => void }) => Promise<void>) => Promise<() => void> } | undefined
    if (!w?.onCloseRequested) return
    const un = w.onCloseRequested(async e => {
      if (!session.fid) return
      // never hold the window open for long: a save stuck behind a long job gives up after ten seconds
      const left = await Promise.race([flushSaves(), new Promise<boolean>(r => setTimeout(() => r(false), 10000))])
      if (left && !window.confirm('This font has changes that can only be kept with Save As. Close without saving?')) e.preventDefault()
    })
    return () => { void un.then(f => f()).catch(() => {}) }
  }, [flushSaves])

  /** The Scrifts name takes you back to the start screen, after saving what can be saved in place. */
  const goHome = useCallback(async () => {
    if (!font) return
    const left = await flushSaves()
    if (left && !window.confirm(font.path.toLowerCase().endsWith('.svg') ? 'This drawing has changes you have not saved (Ctrl S). Leave without saving?' : 'This font has changes that can only be saved with Save As (it is not an .sfd project). Leave without saving?')) return
    closeFont()
  }, [font, flushSaves, closeFont])

  /** Go back to a snapshot: close the project's fonts (so nothing writes over the restored files), restore, reopen. */
  const restoreSnapshot = useCallback(async (id: string, label: string) => {
    if (!font) return
    if (!window.confirm(`Go back to “${label}”?\n\nYour work as it is now is saved as a snapshot first, so you can come back to it.`)) return
    const path = font.path
    try {
      for (const fid of [session.fid, reference?.fid, ...ghostsRef.current.map(g => g.fid)]) if (fid) await api('/api/close', { fid }).catch(() => {})
      session.fid = 0
      ghostsRef.current = []
      setGhosts([])
      closeFont()
      await api('/api/snapshots/restore', { path, id })
      toast.success('Restored', { description: `Back to “${label}”. What you had before is in Snapshots as “Before restoring”.` })
    } catch (e) {
      toast.error('Could not restore', { description: (e as Error).message })
    }
    openPath(path)
  }, [font, reference, closeFont, openPath])

  // Autosave: every few seconds, .sfd projects with changes are saved in place (the font's own format; never a re-export).
  const [saveUi, setSaveUi] = useState<{ phase: 'saving' | 'saved'; at: string } | null>(null)
  const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  useEffect(() => {
    if (!font || !settings.autosave) return
    let alive = true, running = false
    // Nothing changes without you doing something, so only look while you are active: for about twelve seconds after
    // the last click or key (an edit can take a moment to land), and while Scrifts is busy. Idle, it asks nothing at all.
    let quiet = 0
    let last = 0  // saving a big font takes a while and FontForge does one thing at a time, so never while you are still working
    const touch = () => { quiet = 0; last = Date.now() }
    window.addEventListener('pointerdown', touch, true)
    window.addEventListener('pointerup', touch, true)
    window.addEventListener('keyup', touch, true)
    const tick = async () => {
      if (running) return
      if (busyRef.current) { quiet = 0; return }
      if (Date.now() - last < 2500) return
      if (quiet >= 3) return
      quiet++
      running = true
      const t0 = performance.now()
      let saved = false
      try {
        const fids = [session.fid, ...ghostsRef.current.map(g => g.fid)].filter(Boolean)  // one request for all of them
        if (fids.length) {
          const r = await api<{ saved: boolean }>('/api/autosave/all', { fids }).catch((e: Error) => {
            if (e.message === 'Not Found' && !staleWarned.current) {  // the running backend is older than this window
              staleWarned.current = true
              toast.error('Autosave is off: restart Scrifts', { description: 'The background service is older than this window and does not know autosave yet.' })
            } else if (e.message !== 'Not Found' && !staleWarned.current) {  // e.g. a folder Windows will not let us write to: say so once
              staleWarned.current = true
              toast.error('Autosave could not save', { description: e.message })
            }
            return null
          })
          if (r?.saved) saved = true
        }
        if (saved && alive) {
          setSaveUi(s => ({ phase: 'saving', at: s?.at ?? '' }))
          await new Promise(r => setTimeout(r, Math.max(0, 700 - (performance.now() - t0))))  // long enough to be seen
          if (alive) setSaveUi({ phase: 'saved', at: clock() })
          // a checkpoint every ten minutes of work (the server decides if it is time)
          void api<{ made: boolean }>('/api/snapshots/auto', { path: font.path }).then(r => { if (r.made) window.dispatchEvent(new Event('forge-snapshots')) }).catch(() => {})
        }
      } finally { running = false }
    }
    const id = setInterval(() => void tick(), 4000)
    return () => { alive = false; clearInterval(id); window.removeEventListener('pointerdown', touch, true); window.removeEventListener('pointerup', touch, true); window.removeEventListener('keyup', touch, true) }
  }, [font?.path, settings.autosave])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    session.onGone = () => {
      if (!font?.path) { closeFont(); return }
      session.fid = 0
      ghostsRef.current = []
      setGhosts([])
      // say what happened and what you are looking at now: the file as it was last saved, not what was on screen
      const cancelled = Date.now() - lastCancel.at < 60000
      void adopt(async () => {
        const f = await api<FontInfo & { fid: number }>('/api/open', { path: font.path })
        const at = f.mtime ? new Date(f.mtime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
        toast[cancelled ? 'message' : 'error'](cancelled ? 'Stopped' : 'FontForge crashed', {
          description: `Reopened ${f.familyname || f.fontname}${at ? ` from the save of ${at}` : ''}. Anything changed after that save is gone.`,
          duration: cancelled ? 6000 : Infinity, closeButton: true,
        })
        return f
      }, sel).catch(() => closeFont())
    }
    return () => { session.onGone = null }
  }, [font?.path, sel, adopt, closeFont])

  const open = useCallback(async () => {
    const path = await pick('open', font?.path ?? localStorage.getItem('forge.path') ?? undefined)
    if (path) openPath(path)
  }, [font, openPath])

  const save = useCallback((as: boolean) => font && run(as ? 'Save as' : 'Save', async () => {
    const path = as ? await pick('save', font.path) : font.path
    if (!path) return
    await api('/api/save', { path })
    const others = as ? [] : ghostsRef.current  // Save writes every master of the family
    for (const g of others) await api('/api/save', { fid: g.fid })
    setSaveUi({ phase: 'saved', at: clock() })
    toast.success('Saved', { description: others.length ? `${path} and ${others.length} other master${others.length > 1 ? 's' : ''}` : path })
    setUiFontRev(r => r + 1)
  }), [font, run])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11' && font) { e.preventDefault(); dockRef.current?.maximize(); return }
      if (!(e.ctrlKey || e.metaKey)) return
      // interface zoom: Ctrl = / Ctrl -, unless the glyph canvas took the key for its own zoom (Ctrl Alt = / - always zoom the interface)
      if ((e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_') && (e.altKey || !e.defaultPrevented)) {
        e.preventDefault(); zoomUi(e.key === '-' || e.key === '_' ? -1 : 1); return
      }
      if (e.shiftKey && !e.altKey && (e.key === '0' || e.key === ')')) { e.preventDefault(); zoomUi(0); return }
      if (e.altKey && font && e.key.toLowerCase() === 'z') { e.preventDefault(); void undoFont(); return }
      if (e.altKey && font && /^[0-9]$/.test(e.key)) { e.preventDefault(); const n = Object.keys(PRESETS)[e.key === '0' ? 9 : +e.key - 1]; if (n) dockRef.current?.workspace(n); return }  // Ctrl Alt 1-9, 0: the presets
      if (e.key === 'o') { e.preventDefault(); open() }
      if (e.key === 'n') { e.preventDefault(); setNewOpen(true) }
      if (e.key === ',') { e.preventDefault(); setSettingsOpen(true) }
      if (e.key === 'i' && font) { e.preventDefault(); setInfoOpen(true) }
      if (e.key.toLowerCase() === 'g' && e.shiftKey && font) { e.preventDefault(); setGenOpen(true) }
      if (e.key === 's') { e.preventDefault(); save(e.shiftKey) }
      const v = ({ '1': 'glyph', '2': 'spacing', '3': 'accents', '4': 'features', '5': 'script' } as Record<string, string>)[e.key]
      if (v && font) { e.preventDefault(); switchView(v) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, save, font, switchView, undoFont])

  // Interface font: the open font, compiled by FontForge, loaded as a FontFace.
  // Letters it lacks fall back to Geist through the CSS font stack.
  const uiFace = useRef<FontFace | null>(null)
  useEffect(() => {
    const root = document.documentElement.style
    const drop = () => {
      if (uiFace.current) document.fonts.delete(uiFace.current)
      uiFace.current = null
      root.removeProperty('--ui-font')
    }
    document.documentElement.dataset.uiFont = settings.uiFont
    if (settings.uiFont === 'serif') { drop(); root.setProperty('--ui-font', "'Geist Serif'"); return }
    if (settings.uiFont === 'system') { drop(); root.setProperty('--ui-font', 'system-ui'); return }
    if (settings.uiFont !== 'project' || !font || !session.fid) { drop(); return }
    let stale = false
    fetch(`/api/webfont?fid=${session.fid}`)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.arrayBuffer() })
      .then(buf => new FontFace('ForgeUI', buf).load())
      .then(face => {
        if (stale) return
        drop()
        document.fonts.add(face)
        uiFace.current = face
        root.setProperty('--ui-font', "'ForgeUI'")
      })
      .catch(e => toast.error('Could not use this font for the interface', { description: String(e) }))
    return () => { stale = true }
  }, [settings.uiFont, font?.path, uiFontRev])  // eslint-disable-line react-hooks/exhaustive-deps

  // Startup: reopen the last font
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    if (settings.reopenLast && recent[0]) openPath(recent[0].path)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const tauriWin = getTauriWindow()

  const renderTool = (v: string) => {
    if (!font) return null
    if (v === 'history') return <SnapshotsPanel font={font} onSelect={setSel} onRestore={(id, label) => void restoreSnapshot(id, label)} />
    if (v === 'shapes') return <PrimitivesPanel font={font} sel={sel} editable={!loc} onChanged={() => { setBlendRev(r => r + 1); runCheck(family) }} />
    if (v === 'info') return <GlyphInfoPanel font={font} sel={sel} onSelect={setSel} onChanged={() => { void refresh(); setBlendRev(r => r + 1) }} />
    if (v === 'properties') return <PropertiesPanel />
    if (v === 'compare') return <ComparePanel family={family} sel={sel} rev={blendRev} onSelectGlyph={setSel}
      onEdited={(path, pts) => { if (samePath(path, font.path)) { outlines.putPoints(pts); outlines.invalidateUsers(pts.name) } else for (const g of ghostsRef.current) g.store.clear(); setBlendRev(r => r + 1); runCheck(family) }}
      onPick={(m, ci, pi) => { if (!sel) return; pointFocus.set({ path: m.path, glyph: sel, ci, pi }); switchView('glyph'); if (!samePath(font.path, m.path)) { const target = family?.masters.find(x => samePath(x.path, m.path)); if (target) switchMaster(target) } }} />
    if (v === 'layers') return <div ref={setLayersEl} className="relative h-full min-h-0 overflow-y-auto" />
    if (v === 'grid') return (
      <GlyphGrid font={font} sel={sel} loc={loc} onSelect={setSel}
        onOpen={n => { setSel(n); if (view !== 'accents') switchView('glyph') }} onCreate={create} guides={guides} marks={family ? marks : undefined}
        masterOps={masterOps} onChanged={() => { void refresh(); for (const g of ghostsRef.current) g.store.clear(); runCheck(family); setBlendRev(r => r + 1) }} />
    )
    if (v === 'smart') return sel && !loc
      ? <SmartPanel docked name={sel} onChanged={() => { setBlendRev(r => r + 1); runCheck(family) }} />
      : <p className="p-3 text-xs text-muted-foreground">{loc ? 'Move the axes back to their defaults to edit smart parts.' : 'Select a glyph.'}</p>
    return font.axes.length
      ? <VariablePanel key={font.path} font={font} onLocation={setLoc} pickSave={initial => pick('save', initial)} run={run} />
      : <p className="p-3 text-xs text-muted-foreground">This font has no variable axes.</p>
  }

  const renderView = (v: string) => !font ? null : ['grid', 'layers', 'properties', 'info', 'history', 'shapes', 'smart', 'variable', 'compare'].includes(v) ? renderTool(v) : (
  <div className="relative min-h-0 flex-1">
                  {v === 'glyph' && <GlyphView font={font} name={sel} loc={loc} guides={guides} onGuides={setGuides} vguides={vguides} onVGuides={setVGuides} reference={reference} ghosts={ghosts} blend={blend} masterOps={masterOps} onEdited={family ? recheckSoon : undefined} />}
                  {v === 'spacing' && <SpacingView font={font} loc={loc} sel={sel} onSelect={setSel} guides={guides} reference={reference} family={family} weight={weight} location={axisVals} blendRev={blendRev} onStopPreview={() => setWeight(null)} />}
                  {v === 'accents' && <AccentView font={font} sel={sel} onSelect={setSel} onEditGlyph={n => { setSel(n); switchView('glyph') }} guides={guides} onGuides={setGuides} reference={reference} onFontChanged={refresh} />}
                  {v === 'features' && <FeaturesView font={font} onChanged={refresh} />}
                  {v === 'script' && <ScriptView onChanged={refresh} />}
                </div>
  )

  return (
    <TooltipProvider delayDuration={400}>
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden text-sm">
        <header
          data-tauri-drag-region
          onMouseDown={e => {
            // only the empty parts of the bar move the window. React also sends clicks on the open menus
            // (drawn elsewhere in the page) through here; dragging on those swallowed every menu item click
            const t = e.target as HTMLElement
            if (e.buttons === 1 && (t.hasAttribute('data-tauri-drag-region') || t.getAttribute('role') === 'menubar')) {  // the menu bar's own empty space too
              if (e.detail === 2) tauriWin?.toggleMaximize()
              else tauriWin?.startDragging()
            }
          }}
          className="flex select-none items-center gap-1.5 border-b bg-card pl-2 pr-0 py-1"
        >
          <button type="button" onClick={() => void goHome()} disabled={!font}
            title={font ? 'Back to the start screen (saves first)' : undefined}
            className="rounded px-1.5 font-semibold tracking-tight enabled:hover:bg-accent">Scrifts</button>
          <MenuBar hasFont={!!font} editing={!!font && (view === 'glyph' || view === 'accents')} view={view} onView={switchView}
            recent={recent} onFontInfo={() => setInfoOpen(true)} onFamily={() => { setFamilyDialog(family ? 'add' : 'new'); setFamilyOpen(true) }} onGenerate={() => setGenOpen(true)} onValidate={() => setValidateOpen(true)}
            onUndoFont={() => void undoFont()}
            onProof={() => { if (font) void run('Proof sheet', () => import('./proofSheet').then(m => m.printProof(font))) }}
            onFixNames={() => void api<{ renamed: [string, string][] }>('/api/standard-names', {}).then(r => { void refresh(); toast.success(r.renamed.length ? `Renamed ${r.renamed.length} glyph${r.renamed.length === 1 ? '' : 's'}` : 'All glyphs already have standard names', { description: r.renamed.slice(0, 6).map(([a, b]) => `${a} → ${b}`).join(', ') || undefined }) }).catch(e => toast.error('Could not rename', { description: (e as Error).message }))}
            onSettings={() => setSettingsOpen(true)} onNew={() => setNewOpen(true)} onOpen={open} onOpenPath={openPath} onClearRecent={() => setRecent(clearRecent())}
            onSave={() => save(false)} onSaveAs={() => save(true)} onClose={closeFont}
            comparing={reference?.info.familyname ?? null} onCompare={compare}
            onExit={tauriWin ? () => tauriWin.close() : undefined} busy={!!busy}
            onWelcome={() => setWelcomeOpen(true)} onArtboards={setArtMode} onTrace={() => setTraceOpen(true)} onSheet={() => setSheetOpen(true)} plugins={plugins} onRunPlugin={setPluginOpen} onLoadPlugins={loadPlugins} onOpenPlugins={() => void api('/api/plugins/open-folder', {}).catch(e => toast.error('Could not open the folder', { description: (e as Error).message }))} onInterpolate={() => setInterpOpen(true)} onExportGlyphs={() => void exportGlyphs()} openPanels={openPanels} onTogglePanel={v => dockRef.current?.toggle(v)} onResetLayout={() => dockRef.current?.reset()} onWorkspace={a => (a.save ? dockRef.current?.saveWorkspace(a.save) : dockRef.current?.workspace(a.open!))} />
          {reference && (
            <Tip label={`Click to stop comparing with ${reference.info.familyname}`}>
              <Button size="xs" variant="secondary" onClick={compare}><Layers2 />{reference.info.familyname}</Button>
            </Tip>
          )}
          {busy && (
            <Tip label="Stops the FontForge worker; the open font must be reopened">
              <Button size="sm" variant="outline" onClick={cancelAll}><X />Cancel {busy.toLowerCase()}</Button>
            </Tip>
          )}
          <span data-tauri-drag-region className="flex-1 self-stretch" />
          {font && (
            <span data-tauri-drag-region className="truncate pr-2 font-mono text-xs text-muted-foreground" title={font.path}>
              {font.familyname} · {font.glyphs.length} glyphs · {font.em} upm
            </span>
          )}
          {tauriWin && <CaptionButtons win={tauriWin} />}
        </header>

        {font ? (
          <main className="flex min-h-0 min-w-0 flex-col">
            {!family && font.path.toLowerCase().endsWith('.sfd') && (
              <SoloMasterBar style={font.fontname.includes('-') ? font.fontname.split('-').slice(1).join('-') : 'Regular'}
                canAdd onAdd={() => { setFamilyDialog('new'); setFamilyOpen(true) }} busy={!!busy} />
            )}
            {family && <MasterBar family={family} current={font.path} onSwitch={switchMaster} onRemove={setRemoving} onEdit={setEditingMaster} onAdd={() => { setFamilyDialog('add'); setFamilyOpen(true) }} busy={!!busy}
              check={check} onCheck={() => setCheckOpen(true)}
              weight={weight} onWeight={setWeight} axisVals={axisVals} onAxis={(n, v) => setAxisVals(a => ({ ...a, [n]: v }))} onAddAxis={() => setAxisOpen(true)} glyph={sel} onAddBrace={addBrace} onRemoveBrace={removeBrace} onAddHere={() => { setFamilyDialog('blend'); setFamilyOpen(true) }} />}
            <div className="min-h-0 flex-1"><Suspense fallback={<p className="p-4 text-xs text-muted-foreground">Loading the workspace…</p>}><Dock render={renderView} onActive={setView} onOpen={setOpenPanels} handle={dockRef} axes={font.axes.length > 0} layersEl={layersEl} /></Suspense></div>
          </main>
        ) : (
          <main className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden md:grid-cols-[5fr_7fr]">
            {/* left: the picture, edge to edge, with the name over it */}
            <div className="relative hidden min-h-80 overflow-hidden border-r md:block">
              <img src="/splash.jpg" alt="" draggable={false} className="absolute inset-0 size-full object-cover object-top" />
              {/* darkened, so the name in front reads whatever the picture is */}
              <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/60 to-black/45" />
              <div className="absolute bottom-8 left-8 right-8">
                <h1 aria-label="Scrifts" className="h-12 w-full max-w-md"
                  style={{ background: logoColour, WebkitMask: 'url(/wordmark.svg) left center / contain no-repeat', mask: 'url(/wordmark.svg) left center / contain no-repeat' }} />
                <p className="mt-2 text-sm text-white/70">Open source font editor, built on FontForge</p>
              </div>
            </div>
            {/* right: the two ways to begin, then what you had open */}
            <div className="min-h-0 overflow-y-auto"><div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-5 p-10">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={open} disabled={!!busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <FolderOpen />}Open a font
                </Button>
                <Button variant="secondary" onClick={() => setNewOpen(true)} disabled={!!busy}><FilePlus2 />New font</Button>
                <span className="text-xs text-muted-foreground">.sfd · .ttf · .otf · .ufo · .glyphs · .svg</span>
              </div>
              {recent.length === 0 && <p className="text-sm text-muted-foreground">Fonts you open show up here.</p>}
              {recent.length > 0 && (
                <div className="flex min-w-0 flex-col">
                  <div className="mb-1 flex items-center text-xs font-medium text-muted-foreground">
                    <span className="flex-1">Recent</span>
                    <Button size="xs" variant="ghost" onClick={() => setRecent(clearRecent())}>Clear</Button>
                  </div>
                  {recent.map(r => (
                    <div key={r.path} className={`group flex items-center gap-4 rounded-lg px-3 py-2.5 hover:bg-accent ${(missing ?? []).includes(r.path) ? 'opacity-50' : ''}`}>
                      {missing && !missing.includes(r.path) ? <RecentPreview path={r.path} /> : <div className="size-[104px] shrink-0 rounded-lg border bg-background" aria-hidden />}
                      <button type="button" className="flex min-w-0 flex-1 flex-col items-start text-left" disabled={!!busy || (missing ?? []).includes(r.path)}
                        onClick={() => openPath(r.path)} title={(missing ?? []).includes(r.path) ? `${r.path} (not found, moved or deleted)` : r.path}>
                        <span className="flex w-full items-baseline gap-0.5">
                          <span className="truncate text-base font-medium">{r.name}</span>
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{ext(r.path)}</span>
                        </span>
                        <span className="w-full truncate font-mono text-[11px] text-muted-foreground">{r.path}</span>
                      </button>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {(missing ?? []).includes(r.path) ? 'not found' : <>{r.glyphs ? `${r.glyphs} glyphs · ` : ''}{ago(r.opened)}</>}
                      </span>
                      <Button size="icon-xs" variant="ghost" aria-label={`Show ${r.name} in its folder`} title="Show in folder" disabled={(missing ?? []).includes(r.path)}
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => void api('/api/reveal', { path: r.path }).catch(e => toast.error('Could not open the folder', { description: (e as Error).message }))}><FolderSearch /></Button>
                      <Button size="icon-xs" variant="ghost" aria-label={`Remove ${r.name} from recent`} title="Remove from this list"
                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setRecent(removeRecent(r.path))}><X /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div></div>
          </main>
        )}

        <footer className="flex items-center gap-2 border-t bg-card px-3 py-1 font-mono text-[11px] text-muted-foreground">
          {busy && <Loader2 className="size-3 animate-spin" />}
          {busy ? `${busy}…` : status}
          {saveUi && (
            <span className="ml-2 flex items-center gap-1 border-l pl-3" role="status">
              {saveUi.phase === 'saving' ? <><Loader2 className="size-3 animate-spin" />Autosaving…</> : <><CheckIcon className="size-3" />Autosaved {saveUi.at}</>}
            </span>
          )}
        </footer>
      </div>
      {welcomeOpen && <Suspense fallback={null}><WelcomeDialog open onClose={closeWelcome} busy={!!busy}
        onSample={() => void api<{ path: string }>('/api/sample', {}).then(r => openPath(r.path)).catch(e => toast.error('Could not make the sample font', { description: (e as Error).message }))}
        onNew={() => setNewOpen(true)} onOpen={() => void open()} /></Suspense>}
      {font && everTrace && <Suspense fallback={null}><TraceDialog open={traceOpen} onClose={() => setTraceOpen(false)} font={font} glyph={sel} onDone={afterBulkEdit} /></Suspense>}
      {font && everSheet && <Suspense fallback={null}><SheetDialog open={sheetOpen} onClose={() => setSheetOpen(false)} font={font} onDone={afterBulkEdit} /></Suspense>}
      {font && artMode && <Suspense fallback={null}><ArtboardDialog mode={artMode} font={font} onClose={() => setArtMode(null)} onDone={() => { outlines.clear(); for (const g of ghostsRef.current) g.store.clear(); void refresh(); setBlendRev(r => r + 1) }} /></Suspense>}
      {font && pluginOpen && <Suspense fallback={null}><PluginDialog plugin={plugins.find(p => p.id === pluginOpen) ?? null} sel={sel} onClose={() => setPluginOpen(null)} onRan={() => { outlines.clear(); for (const g of ghostsRef.current) g.store.clear(); void refresh(); setBlendRev(r => r + 1) }} /></Suspense>}
      {font && everInfo && <Suspense fallback={null}><FontInfoDialog open={infoOpen} onOpenChange={setInfoOpen}
        onSaved={(familyname, fontname) => setFont(f => f && { ...f, familyname, fontname })} /></Suspense>}
      {font && everInterp && <Suspense fallback={null}><InterpolateDialog open={interpOpen} onOpenChange={setInterpOpen} font={font} sel={sel} onDone={n => { setSel(n); void refresh() }} /></Suspense>}
      {font && everGen && <Suspense fallback={null}><GenerateDialog open={genOpen} onOpenChange={setGenOpen} font={font} family={family} onValidate={() => { setGenOpen(false); setValidateOpen(true) }} /></Suspense>}
      {font && everValidate && <Suspense fallback={null}><ValidateDialog open={validateOpen} onOpenChange={setValidateOpen} onChanged={refresh}
        onGlyph={n => { setSel(n); setGenOpen(false); switchView('glyph') }} /></Suspense>}
      {font && <FamilyDialog mode={familyDialog} open={familyOpen} onOpenChange={setFamilyOpen}
        family={family} blendWeight={weight} blendAxes={axisVals} fontStyle={font.fontname.includes('-') ? font.fontname.split('-').slice(1).join('-') : 'Regular'} onSubmit={familySubmit} />}
      <AxisDialog open={axisOpen} onOpenChange={setAxisOpen} onSubmit={addAxis} />
      <EditMasterDialog master={editingMaster} others={family?.masters ?? []} onCancel={() => setEditingMaster(null)} onSubmit={editMaster} />
      <RemoveMasterDialog master={removing} onCancel={() => setRemoving(null)} onConfirm={removeMaster} />
      <CheckDialog open={checkOpen} onOpenChange={setCheckOpen} check={check} onRecheck={() => runCheck(family)}
        onGlyph={n => { setSel(n); switchView('glyph') }} />
      {everNew && <Suspense fallback={null}><NewFontDialog open={newOpen} onOpenChange={setNewOpen} onCreate={newFont} /></Suspense>}
      {everSettings && <Suspense fallback={null}><SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} fontName={font?.familyname ?? null}
        onRefreshUiFont={() => setUiFontRev(r => r + 1)} /></Suspense>}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
