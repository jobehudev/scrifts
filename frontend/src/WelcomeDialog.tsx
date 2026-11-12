import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** The first thing a new person sees, and what Help → Getting Started shows again. */
export function WelcomeDialog({ open, onClose, onSample, onNew, onOpen, busy }: {
  open: boolean; onClose: () => void; onSample: () => void; onNew: () => void; onOpen: () => void; busy: boolean
}) {
  const go = (f: () => void) => () => { onClose(); f() }
  const rows: [string, string, () => void][] = [
    ['Try the sample font', 'A few letters to poke at', onSample],
    ['New font', 'Start from an empty font', onNew],
    ['Open a font', '.sfd, .ttf, .otf, .ufo, .glyphs or an .svg drawing', onOpen],
  ]
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome to Scrifts</DialogTitle>
          <DialogDescription>Draw letters, space them, make a font.</DialogDescription>
        </DialogHeader>
        <div className="-mx-2 flex flex-col">
          {rows.map(([title, text, fn]) => (
            <button key={title} type="button" disabled={busy} onClick={go(fn)}
              className="flex flex-col items-start rounded-lg px-3 py-2.5 text-left hover:bg-accent disabled:opacity-50">
              <span className="text-base font-medium">{title}</span>
              <span className="text-xs text-muted-foreground">{text}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
