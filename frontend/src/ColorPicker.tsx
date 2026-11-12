import { useRef, useState } from 'react'
import { Popover } from 'radix-ui'
import { Input } from '@/components/ui/input'
import { hexToHsv, hsvToHex, parseHex } from './proof'

/** In-app colour picker: saturation/value square, hue bar, hex field. Replaces the OS dialog of <input type="color">. */
export function ColorPicker({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const drag = useRef<'sv' | 'h' | null>(null)
  const [h, s, v] = hsv
  const apply = (n: [number, number, number]) => { setHsv(n); const hex = hsvToHex(...n); setText(hex); onChange(hex) }
  const pos = (e: React.PointerEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (e.clientY - b.top) / b.height))]
  }
  return (
    <Popover.Root open={open} onOpenChange={o => { setOpen(o); if (o) { setHsv(hexToHsv(value)); setText(value) } }}>
      <Popover.Trigger aria-label={label} title={label} className="h-5 w-6 cursor-pointer rounded border" style={{ background: value }} />
      <Popover.Portal>
        <Popover.Content sideOffset={6} className="z-50 w-52 space-y-2 rounded-lg border bg-popover p-2 shadow-md">
          <div className="relative h-32 cursor-crosshair rounded" style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${hsvToHex(h, 1, 1)})` }}
            onPointerDown={e => { drag.current = 'sv'; e.currentTarget.setPointerCapture(e.pointerId); const [x, y] = pos(e); apply([h, x, 1 - y]) }}
            onPointerMove={e => { if (drag.current === 'sv') { const [x, y] = pos(e); apply([h, x, 1 - y]) } }}
            onPointerUp={() => { drag.current = null }}>
            <span className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
          </div>
          <div className="relative h-3 cursor-pointer rounded" style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
            onPointerDown={e => { drag.current = 'h'; e.currentTarget.setPointerCapture(e.pointerId); apply([pos(e)[0] * 360, s, v]) }}
            onPointerMove={e => { if (drag.current === 'h') apply([pos(e)[0] * 360, s, v]) }}
            onPointerUp={() => { drag.current = null }}>
            <span className="pointer-events-none absolute top-0 h-3 w-1.5 -translate-x-1/2 rounded-sm border border-white bg-black/40" style={{ left: `${h / 3.6}%` }} />
          </div>
          <Input value={text} className="h-7 font-mono" aria-label={`${label} hex`} spellCheck={false}
            onChange={e => { setText(e.target.value); const t = e.target.value.trim(); if (parseHex(t) && t.length > 4) apply(hexToHsv(t)) }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
