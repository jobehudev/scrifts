import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { matches, type PaletteItem } from './paletteMatch'

/** The search box and the list. It exists only while the palette is open, so every opening starts empty. */
function Body({ items, close }: { items: PaletteItem[]; close: () => void }) {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => items.filter(i => i.enabled !== false && matches(i, query)).slice(0, 60), [items, query])
  const current = Math.min(at, Math.max(0, shown.length - 1))
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [current, shown])

  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    close()
    window.setTimeout(item.run, 0)  // after the palette has closed, so a dialog it opens gets the focus
  }

  return (
    <>
      <Input autoFocus value={query} placeholder="What do you want to do?" aria-label="Search commands"
        onChange={e => { setQuery(e.target.value); setAt(0) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(shown.length - 1, current + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(0, current - 1)) }
          else if (e.key === 'Enter') { e.preventDefault(); run(shown[current]) }
        }} />
      <div ref={list} role="listbox" className="max-h-80 overflow-y-auto">
        {shown.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">Nothing matches “{query}”.</p>}
        {shown.map((it, i) => (
          <div key={it.id} role="option" aria-selected={i === current} onMouseMove={() => setAt(i)} onClick={() => run(it)}
            className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${i === current ? 'bg-accent text-accent-foreground' : ''}`}>
            <span className="w-16 shrink-0 text-[10px] text-muted-foreground">{it.group}</span>
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.hint && <Kbd>{it.hint}</Kbd>}
          </div>
        ))}
      </div>
    </>
  )
}

/** Ctrl K: type what you want to do. Disabled things are left out, so everything listed works right now. */
export function CommandPalette({ open, onOpenChange, items }: { open: boolean; onOpenChange: (o: boolean) => void; items: PaletteItem[] }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); onOpenChange(!open) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[20%] translate-y-0 gap-2 p-2 sm:max-w-lg">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Type to find a command, then press Enter.</DialogDescription>
        <Body items={items} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}
