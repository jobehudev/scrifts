import { SquaresExclude, SquaresIntersect, SquaresUnite } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarTrigger } from '@/components/ui/menubar'

/** Letters drafted from parts: two letters joined (æ Æ œ Œ ĳ Ĳ) or a letter with a bar or slash (Ø ø Ð Đ đ Ħ ħ). */
export const LIGATURES = new Set([0xe6, 0xc6, 0x153, 0x152, 0x133, 0x132, 0xd8, 0xf8, 0xd0, 0x110, 0x111, 0x126, 0x127])

/** Control bar along the top of the glyph view: what acts on the selection, as a few written-out groups (no bare icons). */
export function ActionsBar({ hasSelection, shapes, hasUnicode, transform, pathfinder, edit, build, onImport }: {
  hasSelection: boolean; shapes: number; hasUnicode: boolean
  transform: (k: 'flipH' | 'flipV' | 'rotCW' | 'rotCCW') => void
  pathfinder: (m: 'union' | 'subtract' | 'intersect') => void
  edit: (kind: string) => void
  build: () => void
  onImport: () => void
}) {
  const on = hasSelection ? 'the selection' : 'the whole glyph'
  const Item = ({ label, title, onSelect, disabled }: { label: string; title?: string; onSelect: () => void; disabled?: boolean }) =>
    <MenubarItem title={title} disabled={disabled} onSelect={onSelect}>{label}</MenubarItem>
  const Group = ({ name, children }: { name: string; children: React.ReactNode }) =>
    <MenubarMenu><MenubarTrigger className="text-xs">{name} ▾</MenubarTrigger><MenubarContent>{children}</MenubarContent></MenubarMenu>
  const Pf = ({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: React.ReactNode }) =>
    <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button></TooltipTrigger><TooltipContent className="max-w-64">{label}</TooltipContent></Tooltip>
  return (
    <Menubar className="h-auto rounded-none border-0 border-b bg-transparent px-1.5 py-0.5 shadow-none">
      <span className="mr-1 shrink-0 text-xs text-muted-foreground">{hasSelection ? 'Selection' : 'Glyph'}</span>
      <Group name="Transform">
        <Item label="Flip Horizontally" title={`Flip ${on} horizontally`} onSelect={() => transform('flipH')} />
        <Item label="Flip Vertically" title={`Flip ${on} vertically`} onSelect={() => transform('flipV')} />
        <Item label="Rotate 90° Left" title={`Rotate ${on} 90° left`} onSelect={() => transform('rotCCW')} />
        <Item label="Rotate 90° Right" title={`Rotate ${on} 90° right`} onSelect={() => transform('rotCW')} />
      </Group>
      <Pf label="Unite the selected shapes" disabled={shapes < 2} onClick={() => pathfinder('union')}><SquaresUnite /></Pf>
      <Pf label="Subtract: the earliest selected shape minus the others" disabled={shapes < 2} onClick={() => pathfinder('subtract')}><SquaresExclude /></Pf>
      <Pf label="Intersect the selected shapes" disabled={shapes < 2} onClick={() => pathfinder('intersect')}><SquaresIntersect /></Pf>
      <Group name="Clean up">
        <Item label="Remove Overlap" title="Merge all overlaps in the glyph (FontForge Remove Overlap)" onSelect={() => edit('remove_overlap')} />
        <Item label="Correct Direction" title="Fix directions so outsides and holes are right (FontForge Correct Direction)" onSelect={() => edit('correct_direction')} />
        <Item label="Add Extrema" title="Add horizontal and vertical extremum points (FontForge Add Extrema)" onSelect={() => edit('add_extrema')} />
        {hasUnicode && <Item label="Rebuild from Parts" title="Replace this letter’s outlines with its parts: base letter + accent, e.g. À from A + grave (FontForge Build Accented). Ctrl Z undoes it." onSelect={build} />}
      </Group>
      <Button size="xs" variant="ghost" title="Import an SVG, EPS or PDF into this glyph (directions fixed on import)" onClick={onImport}>Import vector</Button>
    </Menubar>
  )
}
