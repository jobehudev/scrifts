import { useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { clean, stepOf, useScrub } from './numeric'

const round1 = (n: number) => Math.round(n * 10) / 10

/** A number you can type into (it applies on Enter or when you leave the box, Escape puts the old value back),
 *  nudge with the arrow keys (Shift ×10, Alt ×0.1) or drag by its label. */
export function NumField({ label, value, onCommit: commit, disabled, wide, min, max, buttons, hideLabel }: {
  label: string; value: number; onCommit: (n: number) => void; disabled?: boolean; wide?: boolean
  /** Limits the value is held to (typing, arrows, drag and the buttons alike). */
  min?: number; max?: number
  /** Show - and + buttons: one step (1; Shift 10, Alt 0.1) per click. */
  buttons?: boolean
  /** The label is only for screen readers and the drag handle goes away. */
  hideLabel?: boolean
}) {
  const onCommit = (n: number) => commit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)))
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const scrub = useScrub(value, onCommit, { disabled, onClick: () => input.current?.focus() })
  const done = () => {
    if (draft === null) return
    const n = Number(draft.replace(',', '.'))
    setDraft(null)
    if (draft.trim() !== '' && Number.isFinite(n) && n !== value) onCommit(n)
  }
  return (
    <div className="flex items-center gap-2">
      {!hideLabel && <span onPointerDown={scrub.bind.onPointerDown} onPointerMove={scrub.bind.onPointerMove} onPointerUp={scrub.bind.onPointerUp} title={scrub.bind.title}
        className={`${wide ? 'w-14' : 'w-4'} shrink-0 text-muted-foreground ${scrub.bind.className}`}>{label}</span>}
      {buttons && <button type="button" disabled={disabled || (min !== undefined && value <= min)} aria-label={`${label}: one less`} title="One less (Shift: 10, Alt: 0.1)"
        onClick={e => onCommit(clean(value - stepOf(e)))} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><Minus className="size-3" /></button>}
      <Input ref={input} value={scrub.preview !== null ? String(scrub.preview) : draft ?? String(round1(value))} disabled={disabled} inputMode="decimal" aria-label={label}
        onChange={e => setDraft(e.target.value)} onBlur={done} onFocus={e => e.currentTarget.select()}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur() }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {  // a step for every press, applied straight away
            e.preventDefault()
            const typed = draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft.replace(',', '.'))) ? Number(draft.replace(',', '.')) : value
            setDraft(null)
            onCommit(clean(typed + (e.key === 'ArrowUp' ? 1 : -1) * stepOf(e)))
          }
        }}
        className="h-7 px-2 font-mono text-xs md:text-xs" />
      {buttons && <button type="button" disabled={disabled || (max !== undefined && value >= max)} aria-label={`${label}: one more`} title="One more (Shift: 10, Alt: 0.1)"
        onClick={e => onCommit(clean(value + stepOf(e)))} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><Plus className="size-3" /></button>}
    </div>
  )
}
