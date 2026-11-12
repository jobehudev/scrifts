import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { api, type Points } from './api'
import { compareMarks } from './compareMarks'
import type { Family } from './FamilyBar'
import { CATEGORY_LABEL, diffAll, diffGlyph, insertIndex, type Category, type Diff, type GlyphPts, type GlyphReport, type Row } from './compare'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'

type Fetched = { masters: { name: string; weight: number; path: string; glyph: GlyphPts | null }[] }
type All = { masters: { name: string; path: string; glyphs: Record<string, GlyphPts> }[] }

const COLOUR: Record<Row['status'], string> = {
  same: 'text-muted-foreground', moved: 'text-foreground', kind: 'text-destructive',
  'only-a': 'bg-red-500/15 text-red-600 dark:text-red-400', 'only-b': 'bg-green-500/15 text-green-600 dark:text-green-400',
}
const MARK: Record<Row['status'], string> = { same: ' ', moved: '~', kind: '!', 'only-a': '−', 'only-b': '+' }
/** a row's place among all the rows of its contour (the table may hide the rows that did not move) */
const k0 = (c: { rows: Row[] }, r: Row) => c.rows.indexOf(r)
/** If this row starts a run of two or more unmatched points on one side, the run. */
function runAt(rows: Row[], r: Row): { side: 'a' | 'b'; rows: Row[] } | null {
  if (r.status !== 'only-a' && r.status !== 'only-b') return null
  const i = rows.indexOf(r)
  if (i > 0 && rows[i - 1].status === r.status) return null
  let j = i
  while (j + 1 < rows.length && rows[j + 1].status === r.status) j++
  return j > i ? { side: r.status === 'only-a' ? 'a' : 'b', rows: rows.slice(i, j + 1) } : null
}
const pick = 'cursor-pointer hover:bg-accent hover:text-foreground'
const fmt = (p?: [number, number, number]) => p ? `${p[2] ? '●' : '○'} ${Math.round(p[0] * 10) / 10}, ${Math.round(p[1] * 10) / 10}` : ''

/**
 * Compare masters. With no glyph in front: every glyph of the font that will not blend between two masters (red), and
 * a way to see that all the others are there and match. Click a glyph for its contours, point by point, like a text diff;
 * the arrow (or Left arrow) goes back to the overview.
 */
export function ComparePanel({ family, sel, rev, onPick, onSelectGlyph, onEdited }: {
  family: Family | null; sel: string | null; rev: number
  onPick: (master: { name: string; path: string }, contour: number, point: number) => void
  onSelectGlyph: (name: string) => void
  /** a point was deleted or added in a master: refresh what shows it */
  onEdited: (masterPath: string, points: Points) => void
}) {
  const [ai, setAi] = useState(0), [bi, setBi] = useState(1)
  const [detail, setDetail] = useState(false)  // one glyph, or the whole font
  const [onlyDiff, setOnlyDiff] = useState(true)
  const [showOk, setShowOk] = useState(false)
  const [cat, setCat] = useState<Category | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // choosing a glyph anywhere (the grid, the Spacing text) opens it here
  useEffect(() => { if (sel) setDetail(true) }, [sel])

  const [tick, setTick] = useState(0)
  // ---- one glyph
  const [data, setData] = useState<Fetched | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!detail || !family || !sel || family.masters.length < 2) return
    let stale = false
    api<Fetched>(`/api/family/glyph-points?path=${encodeURIComponent(family.path)}&name=${encodeURIComponent(sel)}`)
      .then(r => { if (!stale) { setData(r); setError(null) } })
      .catch(e => { if (!stale) { setData(null); setError((e as Error).message) } })
    return () => { stale = true }
  }, [detail, family, sel, rev, tick])

  // ---- the whole font (after a pause: every edit bumps `rev`)
  const [all, setAll] = useState<All | null>(null)
  const [busy, setBusy] = useState(false)
  const count = family?.masters.length ?? 1
  const A = family?.masters[Math.min(ai, count - 1)], B = family?.masters[Math.min(bi, count - 1)]
  useEffect(() => {
    if (detail || !family || !A || !B || family.masters.length < 2) return
    let stale = false
    setBusy(true)
    const t = window.setTimeout(() => {
      api<All>(`/api/family/all-points?path=${encodeURIComponent(family.path)}&a=${encodeURIComponent(A.path)}&b=${encodeURIComponent(B.path)}`)
        .then(r => { if (!stale) { setAll(r); setError(null) } })
        .catch(e => { if (!stale) setError((e as Error).message) })
        .finally(() => { if (!stale) setBusy(false) })
    }, all ? 500 : 0)
    return () => { stale = true; clearTimeout(t) }
  }, [detail, family, A?.path, B?.path, rev])  // eslint-disable-line react-hooks/exhaustive-deps
  const reports = useMemo<GlyphReport[]>(() => all ? diffAll(all.masters[0].glyphs, all.masters[1].glyphs) : [], [all])
  const bad = reports.filter(r => !r.ok)

  // tell the glyph editor which points exist in only one master: it draws them red
  const marksKey = detail && data && sel ? JSON.stringify([ai, bi, sel, data.masters.map(m => m.glyph?.contours.map(c => c.length))]) : ''
  useEffect(() => {
    if (!detail || !data || !sel || data.masters.length < 2) { compareMarks.set(null); return }
    const GA = data.masters[Math.min(ai, data.masters.length - 1)], GB = data.masters[Math.min(bi, data.masters.length - 1)]
    if (!GA.glyph || !GB.glyph) { compareMarks.set(null); return }
    const ka = new Set<string>(), kb = new Set<string>()
    for (const c of diffGlyph(GA.glyph, GB.glyph).contours) for (const r of c.rows) {
      if (r.status === 'only-a' && r.ai !== undefined) ka.add(`${c.index}:${r.ai}`)
      if (r.status === 'only-b' && r.bi !== undefined) kb.add(`${c.index}:${r.bi}`)
    }
    compareMarks.set({ glyph: sel, byPath: [{ path: GA.path, keys: ka }, { path: GB.path, keys: kb }] })
  }, [marksKey])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => compareMarks.set(null), [])

  if (!family || family.masters.length < 2) return <p className="p-3 text-xs text-muted-foreground">Needs a family with two or more masters (Masters bar, + to add one).</p>
  if (error) return <p className="p-3 text-xs text-destructive">{error}</p>

  const picker = (value: number, set: (n: number) => void, label: string) => (
    <label className="flex min-w-0 flex-1 items-center gap-1"><span className="text-muted-foreground">{label}</span>
      <Select value={value} onChange={e => set(+e.target.value)} className="h-7 min-w-0 flex-1">
        {family.masters.map((m, i) => <option key={m.path} value={i}>{m.name}</option>)}</Select></label>
  )
  /** Delete a point from the master that has it, or add it to the one that lacks it (a copy at the same place: move it afterwards). */
  const fix = (master: { name: string; path: string }, contour: number, index: number, action: 'delete' | 'insert', pt?: [number, number, number], run?: { count?: number; points?: [number, number, number][] }) => {
    if (!sel) return
    api<Points>('/api/family/point-edit', { family: family.path, master: master.path, glyph: sel, contour, index, action, x: pt?.[0], y: pt?.[1], on: pt?.[2], count: run?.count, points: run?.points })
      .then(r => { onEdited(master.path, r); setTick(t => t + 1) })
      .catch(e => toast.error(action === 'delete' ? 'Could not delete the point' : 'Could not add the point', { description: (e as Error).message }))
  }
  const pickers = <div className="flex items-center gap-2 border-b p-2">{picker(ai, setAi, 'A')}{picker(bi, setBi, 'B')}</div>

  // ---- the overview
  if (!detail) {
    const cats = [...new Set(bad.flatMap(r => r.categories))] as Category[]
    const list = reports.filter(r => (showOk || !r.ok) && (!cat || r.categories.includes(cat)))
    return (
      <div ref={root} className="flex h-full min-h-0 flex-col text-xs outline-none">
        {pickers}
        <div className={`border-b p-2 ${!all ? 'text-muted-foreground' : bad.length ? 'text-destructive' : 'text-green-600 dark:text-green-400'}`}>
          {!all ? 'Reading both masters…'
            : bad.length ? <><b>{bad.length} of {reports.length} glyphs will not blend</b> between {all.masters[0].name} and {all.masters[1].name}.</>
              : `All ${reports.length} glyphs are in both masters and match point for point.`}
          {busy && all && <span className="ml-2 text-muted-foreground">updating…</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
          {cats.map(c => (
            <Button key={c} size="xs" variant={cat === c ? 'secondary' : 'ghost'} onClick={() => setCat(cat === c ? null : c)}>
              {CATEGORY_LABEL[c]} <span className="text-muted-foreground">{bad.filter(r => r.categories.includes(c)).length}</span></Button>
          ))}
          <label className="ml-auto flex items-center gap-1 text-muted-foreground"><input type="checkbox" checked={showOk} onChange={e => setShowOk(e.target.checked)} />also list the {reports.length - bad.length} that match</label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.map(r => (
            <button key={r.name} type="button" onClick={() => { onSelectGlyph(r.name); setDetail(true) }}
              className={`flex w-full items-baseline gap-3 border-b px-2 py-1 text-left hover:bg-accent ${r.ok ? 'text-muted-foreground' : 'bg-red-500/10 text-red-600 dark:text-red-400'}`}>
              <span className="w-24 shrink-0 truncate font-mono font-medium">{r.name}</span>
              <span className="min-w-0 flex-1 truncate">{r.ok ? '✓ matches' : r.problems[0]}</span>
              {!r.ok && r.problems.length > 1 && <span className="shrink-0 text-muted-foreground">+{r.problems.length - 1}</span>}
            </button>
          ))}
          {all && !list.length && <p className="p-3 text-muted-foreground">{bad.length ? 'Nothing in this category.' : 'Nothing to fix.'}</p>}
        </div>
      </div>
    )
  }

  // ---- one glyph
  const next = (dir: 1 | -1) => {
    if (!bad.length) return
    const i = bad.findIndex(r => r.name === sel)
    const to = bad[(i < 0 ? (dir > 0 ? 0 : bad.length - 1) : i + dir + bad.length) % bad.length]
    onSelectGlyph(to.name)
  }
  const header = (
    <div className="flex items-center gap-1 border-b p-1">
      <Button size="icon-xs" variant="ghost" aria-label="Back to the whole font" title="Back to the whole font (Left arrow)" onClick={() => setDetail(false)}><ArrowLeft /></Button>
      <span className="font-mono font-medium">{sel ?? ''}</span>
      <span className="ml-auto flex items-center gap-0.5">
        <Button size="icon-xs" variant="ghost" aria-label="Previous glyph with a problem" title="Previous glyph with a problem (Up arrow)" disabled={!bad.length} onClick={() => next(-1)}><ChevronUp /></Button>
        <Button size="icon-xs" variant="ghost" aria-label="Next glyph with a problem" title="Next glyph with a problem (Down arrow)" disabled={!bad.length} onClick={() => next(1)}><ChevronDown /></Button>
      </span>
    </div>
  )
  const onKey = (e: React.KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'SELECT' || tag === 'INPUT') return
    if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); setDetail(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); next(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); next(-1) }
  }
  if (!sel) return <div className="text-xs text-muted-foreground">{header}<p className="p-3">Select a glyph.</p></div>
  if (!data) return <div ref={root} tabIndex={0} onKeyDown={onKey} className="text-xs outline-none">{header}<p className="p-3 text-muted-foreground">Loading…</p></div>

  const GA = data.masters[Math.min(ai, data.masters.length - 1)], GB = data.masters[Math.min(bi, data.masters.length - 1)]
  const diff: Diff | null = GA.glyph && GB.glyph ? diffGlyph(GA.glyph, GB.glyph) : null

  return (
    <div ref={root} tabIndex={0} onKeyDown={onKey} className="flex h-full min-h-0 flex-col text-xs outline-none">
      {header}
      {pickers}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`border-b p-2 ${!diff ? 'text-destructive' : diff.compatible ? 'text-green-600 dark:text-green-400' : 'text-destructive'}`}>
          {!diff ? `${sel} is missing in ${!GA.glyph ? GA.name : GB.name}`
            : diff.compatible ? `${sel}: ${GA.name} and ${GB.name} match point for point. Width ${diff.width[0]} → ${diff.width[1]}.`
              : <><b>{sel} will not blend between {GA.name} and {GB.name}.</b><ul className="mt-1 list-disc pl-4">{diff.problems.map(p => <li key={p}>{p}</li>)}</ul></>}
        </div>
        {diff && (
          <div className="grid grid-cols-[auto_1fr] gap-x-2 border-b px-2 py-1 text-muted-foreground">
            <span className="font-mono">no. point</span><span><b className="text-foreground">{GA.name}</b> on the left, <b className="text-foreground">{GB.name}</b> on the right, change (B − A) at the far right. Click a point to select it in that master.</span>
            <span className="font-mono">● ○</span><span>on-curve point / curve handle</span>
            <span className="font-mono">~ − + ✕</span><span>moved / only in {GA.name} / only in {GB.name} / stray (almost on top of its neighbour: delete it)</span>
          </div>
        )}
        {diff && (
          <label className="flex items-center gap-2 border-b px-2 py-1 text-muted-foreground">
            <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} />Hide points that did not move
          </label>
        )}
        {diff?.contours.map(c => {
          const rows = onlyDiff ? c.rows.filter(r => r.status !== 'same') : c.rows
          return (
            <section key={c.index} className="border-b">
              <h3 className="flex items-baseline gap-2 bg-muted/40 px-2 py-1 font-medium">Contour {c.index + 1}
                <span className={`font-normal ${c.problems.length ? 'text-destructive' : 'text-muted-foreground'}`}>{c.problems[0] ?? `${c.rows.length} points`}</span></h3>
              {rows.length === 0 ? <p className="px-2 py-1 text-muted-foreground">Every point is where it is in the other master.</p> : (
                <table className="w-full font-mono">
                  <tbody>
                    {rows.map((r, k) => {
                      const dx = r.a && r.b ? r.b[0] - r.a[0] : 0, dy = r.a && r.b ? r.b[1] - r.a[1] : 0
                      return (
                        <tr key={k} className={COLOUR[r.status]}>
                          <td className="w-4 px-1 text-center" title={r.stray ? 'Almost on top of its neighbour: probably a stray point' : undefined}>{r.stray ? '✕' : MARK[r.status]}</td>
                          <td className={`px-1 text-muted-foreground ${r.ai !== undefined ? pick : ''}`} onClick={() => r.ai !== undefined && onPick(GA, c.index, r.ai)} title={r.ai !== undefined ? `Select this point in ${GA.name}` : undefined}>{r.ai !== undefined ? r.ai + 1 : ''}</td>
                          <td className={`px-1 ${r.ai !== undefined ? pick : ''}`} onClick={() => r.ai !== undefined && onPick(GA, c.index, r.ai)} title={r.ai !== undefined ? `Select this point in ${GA.name}` : undefined}>{fmt(r.a)}</td>
                          <td className={`px-1 text-muted-foreground ${r.bi !== undefined ? pick : ''}`} onClick={() => r.bi !== undefined && onPick(GB, c.index, r.bi)} title={r.bi !== undefined ? `Select this point in ${GB.name}` : undefined}>{r.bi !== undefined ? r.bi + 1 : ''}</td>
                          <td className={`px-1 ${r.bi !== undefined ? pick : ''}`} onClick={() => r.bi !== undefined && onPick(GB, c.index, r.bi)} title={r.bi !== undefined ? `Select this point in ${GB.name}` : undefined}>{fmt(r.b)}</td>
                          <td className="whitespace-nowrap px-1 text-right font-sans">
                            {(() => {  // the first row of a run of unmatched points (a cubic curve's two handles): act on the whole run
                              const run = runAt(c.rows, r)
                              if (!run) return null
                              const [from, to, pts] = run.side === 'a' ? [GA, GB, run.rows.map(x => x.a!)] : [GB, GA, run.rows.map(x => x.b!)]
                              const first = run.rows[0]
                              return <>
                                <Button size="xs" variant="outline" title={`Delete these ${run.rows.length} points from ${from.name} together (a cubic curve needs both handles gone)`}
                                  onClick={() => fix(from, c.index, (run.side === 'a' ? first.ai : first.bi)!, 'delete', undefined, { count: run.rows.length })}>Delete {run.rows.length}</Button>
                                <Button size="xs" variant="outline" title={`Add copies of these ${run.rows.length} points to ${to.name}, at the same places`} disabled={!!c.onlyIn}
                                  onClick={() => fix(to, c.index, insertIndex(c.rows, c.rows.indexOf(first), run.side === 'a' ? 'b' : 'a'), 'insert', undefined, { points: pts })}>Add {run.rows.length}</Button>
                              </>
                            })()}
                            {r.status === 'only-a' && r.a && <>
                              <Button size="xs" variant="ghost" title={`Delete this point from ${GA.name}`} onClick={() => fix(GA, c.index, r.ai!, 'delete')}>Delete</Button>
                              <Button size="xs" variant="ghost" title={`Add a copy of this point to ${GB.name}, at the same place`} disabled={c.onlyIn === 'a'} onClick={() => fix(GB, c.index, insertIndex(c.rows, k0(c, r), 'b'), 'insert', r.a)}>Add to {GB.name}</Button>
                            </>}
                            {r.status === 'only-b' && r.b && <>
                              <Button size="xs" variant="ghost" title={`Delete this point from ${GB.name}`} onClick={() => fix(GB, c.index, r.bi!, 'delete')}>Delete</Button>
                              <Button size="xs" variant="ghost" title={`Add a copy of this point to ${GA.name}, at the same place`} disabled={c.onlyIn === 'b'} onClick={() => fix(GA, c.index, insertIndex(c.rows, k0(c, r), 'a'), 'insert', r.b)}>Add to {GA.name}</Button>
                            </>}
                          </td>
                          <td className="px-1 text-right text-muted-foreground">{r.status === 'moved' ? `${dx >= 0 ? '+' : ''}${Math.round(dx * 10) / 10}, ${dy >= 0 ? '+' : ''}${Math.round(dy * 10) / 10}` : ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
