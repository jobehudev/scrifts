import { useRef } from 'react'

/**
 * A code box with line numbers, like a terminal editor: a gutter that scrolls with the text, Tab indents,
 * Ctrl Enter runs. `errorLine` (1-based) is marked in the gutter. Lines never wrap, so each number is one line.
 */
export function CodeEditor({ value, onChange, onRun, indent = 4, errorLine, label, className = '' }: {
  value: string; onChange: (v: string) => void
  /** Ctrl Enter */
  onRun?: () => void
  indent?: number; errorLine?: number | null; label: string; className?: string
}) {
  const gutter = useRef<HTMLDivElement>(null)
  const lines = value.split('\n').length
  return (
    <div className={`flex min-h-0 overflow-hidden border bg-background font-mono text-xs leading-5 ${className}`}>
      <div ref={gutter} aria-hidden className="select-none overflow-hidden border-r bg-muted/30 py-2 pb-5 pl-2 pr-2 text-right text-muted-foreground"
        style={{ minWidth: `${String(lines).length + 3}ch` }}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={errorLine === i + 1 ? 'font-bold text-destructive' : ''}>{i + 1}</div>
        ))}
      </div>
      <textarea value={value} onChange={e => onChange(e.target.value)} wrap="off" spellCheck={false} aria-label={label}
        onScroll={e => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop }}
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && onRun) { e.preventDefault(); onRun(); return }
          if (e.key === 'Tab') {  // indent instead of leaving the editor
            e.preventDefault()
            const el = e.currentTarget, a = el.selectionStart, pad = ' '.repeat(indent)
            onChange(value.slice(0, a) + pad + value.slice(el.selectionEnd))
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + indent })
          }
        }}
        className="min-w-0 flex-1 resize-none overflow-auto bg-transparent py-2 pl-3 pr-3 leading-5 outline-none" />
    </div>
  )
}
