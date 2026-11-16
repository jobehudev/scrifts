import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, FilePlus2, FolderOpen, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CUSTOM_PRESETS, type Custom } from './theme'
import { Wordmark } from './Wordmark'
import { setSettings, useSettings, type Settings } from './settings'

type Look = { name: string; patch: Partial<Settings>; bg: string; accent: string }

// The same themes Settings offers, as pictures: Dark and Light are the stylesheet's own, the rest come from two colours.
const LOOKS: Look[] = [
  { name: 'Dark', patch: { theme: 'dark' }, bg: '#0b0b0c', accent: '#e8e8ea' },
  { name: 'Light', patch: { theme: 'light' }, bg: '#ffffff', accent: '#1c1c1e' },
  { name: 'Ink', patch: { theme: 'ink' }, bg: '#ecebe4', accent: '#111111' },
  ...CUSTOM_PRESETS.map(p => ({ name: p.name, patch: { theme: 'custom', custom: p.theme } as Partial<Settings>, bg: p.theme.bg, accent: p.theme.accent })),
]

const sameLook = (l: Look, s: { theme: Settings['theme']; custom: Custom }) =>
  l.patch.theme === s.theme && (s.theme !== 'custom' || (l.patch.custom?.bg === s.custom.bg && l.patch.custom?.accent === s.custom.accent))

// The interface fonts Settings offers, minus 'project' (the open font): a new person has no font open yet.
const FONTS: { id: Settings['uiFont']; name: string; family: string }[] = [
  { id: 'default', name: 'Geist', family: "'Geist Variable', sans-serif" },
  { id: 'system', name: 'System', family: 'system-ui, sans-serif' },
  { id: 'serif', name: 'Serif', family: "'Geist Serif', serif" },
]

const STEPS = 3

/** The first thing a new person sees, and what Help → Getting Started shows again: a short run of three screens. */
export function WelcomeDialog({ open, onClose, onSample, onNew, onOpen, busy }: {
  open: boolean; onClose: () => void; onSample: () => void; onNew: () => void; onOpen: () => void; busy: boolean
}) {
  const [step, setStep] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const settings = useSettings()

  // Close with a short fade, then do what was chosen once the screen is gone.
  const finish = useCallback((then?: () => void) => {
    setLeaving(true)
    window.setTimeout(() => { onClose(); then?.() }, 260)
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'Enter' && step < STEPS - 1) setStep(s => s + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step, finish])

  if (!open) return null
  const rows: [typeof Type, string, string, () => void][] = [
    [Type, 'Try the sample font', 'A few letters to poke at', onSample],
    [FilePlus2, 'New font', 'Start from an empty font', onNew],
    [FolderOpen, 'Open a font', '.sfd, .ttf, .otf, .ufo, .glyphs or an .svg drawing', onOpen],
  ]

  return (
    <div role="dialog" aria-modal="true" aria-label="Welcome to Scrifts"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-background text-foreground ${leaving ? 'welcome-out' : 'welcome-fade'}`}>
      <div className="welcome-glow" aria-hidden />
      <button type="button" onClick={() => finish()} className="absolute right-6 top-5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        Skip
      </button>

      {/* the step is the key, so each screen plays its entrance again */}
      <div key={step} className="relative flex w-full max-w-xl flex-col items-center px-8 text-center">
        {step === 0 && (
          <>
            <h1 className="w-[min(38rem,82vw)]"><Wordmark animate className="h-auto w-full text-foreground" /></h1>
            <p className="welcome-rise mt-6 text-lg text-muted-foreground" style={{ ['--d' as string]: '3000ms' }}>Draw letters, space them, make a font.</p>
            <Button size="lg" className="welcome-rise mt-10 gap-2 px-6" style={{ ['--d' as string]: '3200ms' }} onClick={() => setStep(1)} autoFocus>
              Get started <ArrowRight className="size-4" />
            </Button>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="welcome-rise text-2xl font-semibold" style={{ ['--d' as string]: '0ms' }}>Pick a look and a font</h2>
            <p className="welcome-rise mt-2 text-sm text-muted-foreground" style={{ ['--d' as string]: '80ms' }}>You can change both any time in Settings.</p>
            <div className="mt-8 grid w-full grid-cols-4 gap-3">
              {LOOKS.map((l, i) => {
                const on = sameLook(l, settings)
                return (
                  <button key={l.name} type="button" onClick={() => setSettings(l.patch)}
                    className={`welcome-rise group flex flex-col items-center gap-2 rounded-xl border p-2.5 transition-all hover:-translate-y-0.5 ${on ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-muted-foreground'}`}
                    style={{ ['--d' as string]: `${140 + i * 50}ms` }}>
                    <span className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-lg border border-black/10" style={{ background: l.bg }}>
                      <span className="text-3xl font-bold leading-none" style={{ color: l.accent }}>A</span>
                    </span>
                    <span className="text-xs">{l.name}</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-3 grid w-[75%] grid-cols-3 gap-3">
              {FONTS.map((f, i) => (
                <button key={f.id} type="button" onClick={() => setSettings({ uiFont: f.id })}
                  className={`welcome-rise flex items-baseline justify-center gap-2 rounded-xl border px-3 py-2.5 transition-all hover:-translate-y-0.5 ${settings.uiFont === f.id ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-muted-foreground'}`}
                  style={{ ['--d' as string]: `${560 + i * 50}ms` }}>
                  <span className="text-xl" style={{ fontFamily: f.family }}>Aa</span>
                  <span className="text-xs">{f.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-10 flex gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
              <Button className="gap-2 px-6" onClick={() => setStep(2)} autoFocus>Continue <ArrowRight className="size-4" /></Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="welcome-rise text-2xl font-semibold" style={{ ['--d' as string]: '0ms' }}>How do you want to start?</h2>
            <div className="mt-8 flex w-full flex-col gap-2">
              {rows.map(([Icon, title, text, fn], i) => (
                <button key={title} type="button" disabled={busy} onClick={() => finish(fn)}
                  className="welcome-rise flex items-center gap-4 rounded-xl border border-border px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:bg-accent disabled:opacity-50"
                  style={{ ['--d' as string]: `${100 + i * 70}ms` }}>
                  <Icon className="size-5 shrink-0 text-muted-foreground" />
                  <span className="flex flex-col">
                    <span className="text-base font-medium">{title}</span>
                    <span className="text-xs text-muted-foreground">{text}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="welcome-rise mt-8 text-xs text-muted-foreground" style={{ ['--d' as string]: '360ms' }}>
              Tip: press <kbd className="rounded border px-1 font-mono">Ctrl</kbd> <kbd className="rounded border px-1 font-mono">K</kbd> any time to find a command.
            </p>
            <Button variant="ghost" className="mt-2" onClick={() => setStep(1)}>Back</Button>
          </>
        )}
      </div>

      <div className="absolute bottom-8 flex gap-2" aria-hidden>
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-foreground' : 'w-1.5 bg-muted-foreground/40'}`} />
        ))}
      </div>
    </div>
  )
}
