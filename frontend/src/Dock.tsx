import { createContext, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewHeaderActionsProps, type IDockviewPanelProps } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { Columns2, Plus, Rows2 } from 'lucide-react'
import { Popover } from 'radix-ui'
import { LayersHost } from './layersHost'
import { TOOLS, VIEWS } from './panels'
import { PRESETS, readSaved, writeSaved } from './workspaces'
import { Button } from '@/components/ui/button'

const title = (v: string) => [...VIEWS, ...TOOLS].find(([k]) => k === v)?.[1] ?? v
const KEY = 'scrifts.dock3'

const Render = createContext<(view: string) => ReactNode>(() => null)
/** Which editor panel feeds the Layers panel (the last glyph or accents editor you used), and where it draws. */
const Owner = createContext<{ id: string | null; el: HTMLElement | null }>({ id: null, el: null })
const isEditor = (v: unknown) => v === 'glyph' || v === 'accents'

function ViewPanel({ params, api }: IDockviewPanelProps<{ view: string }>) {
  const owner = useContext(Owner)
  return (
    <LayersHost.Provider value={api.id === owner.id ? owner.el : null}>
      <div className="flex h-full min-h-0 flex-col"><Suspense fallback={<p className="p-3 text-xs text-muted-foreground">Loading…</p>}>{useContext(Render)(params.view)}</Suspense></div>
    </LayersHost.Provider>
  )
}

let counter = 0
/** A free panel id for this view (two Spacing panels are fine; ids only have to differ). */
const freeId = (api: DockviewApi, view: string) => {
  let id = view
  while (api.getPanel(id)) id = `${view}-${++counter}`
  return id
}

function addView(api: DockviewApi, view: string, where?: { group: string; direction: 'within' | 'right' | 'below' | 'left' }, width?: number) {
  api.addPanel({
    id: freeId(api, view), component: 'view', title: title(view), params: { view }, initialWidth: width,
    position: where ? { referenceGroup: where.group, direction: where.direction } : undefined,
  })
}

/** Next view not on screen yet, for a fresh split. */
const nextView = (api: DockviewApi, current: string) => {
  const open = new Set(api.panels.map(p => p.params?.view as string))
  return VIEWS.map(([k]) => k).find(k => !open.has(k)) ?? current
}

function Actions({ containerApi, group }: IDockviewHeaderActionsProps) {
  const current = (group.activePanel?.params?.view as string) ?? 'glyph'
  return (
    <div className="flex h-full items-center gap-0.5 pr-1">
      <Popover.Root>
        <Popover.Trigger asChild><Button size="icon-xs" variant="ghost" aria-label="Add a view here" title="Add a view as a tab"><Plus /></Button></Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={4} className="z-50 w-36 rounded-lg border bg-popover p-1 text-xs text-popover-foreground shadow-md">
            {[...VIEWS, ...TOOLS].map(([k, label]) => (
              <Popover.Close key={k} asChild>
                <Button size="xs" variant="ghost" className="w-full justify-start" onClick={() => addView(containerApi, k, { group: group.id, direction: 'within' })}>{label}</Button>
              </Popover.Close>
            ))}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Button size="icon-xs" variant="ghost" aria-label="Split to the right" title="Split to the right"
        onClick={() => addView(containerApi, nextView(containerApi, current), { group: group.id, direction: 'right' })}><Columns2 /></Button>
      <Button size="icon-xs" variant="ghost" aria-label="Split below" title="Split below"
        onClick={() => addView(containerApi, nextView(containerApi, current), { group: group.id, direction: 'below' })}><Rows2 /></Button>
    </div>
  )
}

/** Shown when every panel was closed. */
function Empty({ containerApi }: { containerApi: DockviewApi }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
      <span>No views open</span>
      <div className="flex flex-wrap justify-center gap-1">{[...VIEWS, ...TOOLS].map(([k, label]) => <Button key={k} size="xs" variant="outline" onClick={() => addView(containerApi, k)}>{label}</Button>)}</div>
    </div>
  )
}

export type DockHandle = { workspace: (name: string) => void; saveWorkspace: (name: string) => void; show: (view: string) => void; toggle: (view: string) => void; reset: () => void; ensure: (view: string) => void; maximize: () => void }

/**
 * The work area as dockable panels: every view (Glyph, Spacing, ...) is a
 * panel you can drag into tabs or splits, or close. The layout is kept in
 * localStorage. `render` draws a view; `onActive` says which one has focus.
 */
export function Dock({ render, onActive, onOpen, handle, axes, layersEl }: {
  layersEl: HTMLElement | null
  render: (view: string) => ReactNode; onActive: (view: string) => void; handle: { current: DockHandle | null }; axes: boolean
  /** The views that are open, whenever that changes (for the Window menu). */
  onOpen: (views: string[]) => void
}) {
  const api = useRef<DockviewApi | null>(null)
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const active = useRef(onActive)
  const opened = useRef(onOpen)
  useEffect(() => { active.current = onActive; opened.current = onOpen })

  const ready = useCallback((e: DockviewReadyEvent) => {
    const a = e.api
    api.current = a
    let restored = false
    try {
      const saved = localStorage.getItem(KEY)
      if (saved) { a.fromJSON(JSON.parse(saved)); restored = a.panels.length > 0 }
    } catch { /* an old or damaged layout: start over */ }
    // the first layout: glyphs on the left, the editor, layers (and the axes of a variable font) on the right
    /** Build a preset: [view, beside (a view already placed), direction, width]. The first row is the root. */
    const build = (rows: (typeof PRESETS)[string]) => {
      a.clear()
      for (const [view, beside, direction, width] of rows) {
        const ref = beside ? a.panels.find(p => p.params?.view === beside)?.group.id : undefined
        addView(a, view, ref && direction ? { group: ref, direction } : undefined, width)
      }
      a.panels.find(p => p.params?.view === rows[0][0])?.api.setActive()
    }
    const defaults = () => {
      build(PRESETS.Drawing)
      if (axes) addView(a, 'variable', { group: a.getPanel('glyph')!.group.id, direction: 'right' }, 260)
    }
    if (!restored) defaults()
    for (const p of a.panels) { const t = title(p.params?.view as string); if (p.title !== t) p.api.setTitle(t) }  // a saved layout keeps the names of its day
    const report = () => opened.current([...new Set(a.panels.map(p => p.params?.view as string))])
    a.onDidAddPanel(report); a.onDidRemovePanel(report); report()
    a.onDidLayoutChange(() => localStorage.setItem(KEY, JSON.stringify(a.toJSON())))
    const firstEditor = () => a.panels.find(p => isEditor(p.params?.view))?.id ?? null
    a.onDidActivePanelChange(() => {
      const p = a.activePanel, v = p?.params?.view
      if (v) active.current(v as string)
      if (p && isEditor(v)) setOwnerId(p.id)
    })
    a.onDidRemovePanel(p => setOwnerId(o => (o === p.id ? firstEditor() : o)))
    setOwnerId(isEditor(a.activePanel?.params?.view) ? a.activePanel!.id : firstEditor())
    if (a.activePanel?.params?.view) active.current(a.activePanel.params.view as string)
    handle.current = {
      reset: defaults,
      workspace: name => {
        const saved = readSaved()[name]
        if (saved) { try { a.fromJSON(saved as never) } catch { /* damaged: keep what is open */ } }
        else if (PRESETS[name]) build(PRESETS[name])
      },
      saveWorkspace: name => writeSaved({ ...readSaved(), [name]: a.toJSON() }),
      // the panel you are in fills the window, and again to give the layout back
      maximize: () => { const p = a.activePanel; if (!p) return; if (a.hasMaximizedGroup()) a.exitMaximizedGroup(); else p.api.maximize() },
      // open a panel only if it is missing, beside the editor, without taking focus
      ensure: view => {
        if (a.panels.some(p => p.params?.view === view)) return
        const main = a.getPanel('glyph')?.group.id ?? a.activeGroup?.id
        a.addPanel({ id: freeId(a, view), component: 'view', title: title(view), params: { view }, inactive: true, initialWidth: 260,
          position: main ? { referenceGroup: main, direction: 'right' } : undefined })
      },
      toggle: view => {
        const open = a.panels.filter(p => p.params?.view === view)
        if (open.length) open.forEach(p => a.removePanel(p))
        else handle.current?.show(view)
      },
      show: view => {
        const open = a.panels.find(p => p.params?.view === view)
        if (open) open.api.setActive()
        else addView(a, view, a.activeGroup ? { group: a.activeGroup.id, direction: 'within' } : undefined)
      },
    }
  }, [handle, axes])

  return (
    <Render.Provider value={render}>
      <Owner.Provider value={{ id: ownerId, el: layersEl }}>
      <DockviewReact className="dockview-theme-abyss forge-dock h-full" components={{ view: ViewPanel }} onReady={ready}
        rightHeaderActionsComponent={Actions} watermarkComponent={p => <Empty containerApi={p.containerApi} />} />
      </Owner.Provider>
    </Render.Provider>
  )
}
