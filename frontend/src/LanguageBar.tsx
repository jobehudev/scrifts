import { Plus, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import { shortName, slotCount, useLanguages } from './gridScripts'
import { scriptName } from './scripts'
import { ScriptPicker } from './ScriptPicker'
import { Button } from '@/components/ui/button'
import type { FontInfo } from './api'

/**
 * The languages of this font (Latin, Greek, Han, Arabic ...), each named by its OpenType script tag. One list for the whole app:
 * the glyph grid shows their slots, and Features registers its swaps for them, so the two cannot disagree.
 */
export function LanguageBar({ font, label }: { font: FontInfo; label?: string }) {
  const { chosen, inFont, active, setChosen } = useLanguages(font.familyname, font.glyphs)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {label && <span className="mr-0.5 text-xs font-medium">{label}</span>}
      {active.map(t => (
        <span key={t} title={`${scriptName(t)} · OpenType script ${t} · ${slotCount(t).toLocaleString()} slots`}
          className="flex items-center gap-0.5 rounded border bg-muted/40 py-0.5 pl-1.5 pr-0.5 text-[11px]">
          {shortName(t)} <span className="font-mono text-[10px] text-muted-foreground">{t}</span>
          {inFont.includes(t)
            ? <span className="px-0.5 text-muted-foreground" title="The font has glyphs in this language">•</span>
            : <button type="button" aria-label={`Remove ${shortName(t)}`} className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setChosen(chosen.filter(x => x !== t))}><X className="size-3" /></button>}
        </span>
      ))}
      <Popover.Root>
        <Popover.Trigger asChild><Button size="xs" variant="outline"><Plus />Language</Button></Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={6} className="z-50 w-80 space-y-2 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md">
            <p className="text-muted-foreground">The languages this font is for, each named by its OpenType script. Any mix is fine, Latin or not. The glyph grid shows their slots, and the Features page registers its swaps for them.</p>
            <ScriptPicker value={chosen} onChange={setChosen} locked={inFont} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
