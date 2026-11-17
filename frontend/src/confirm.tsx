import { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { getSettings, setSettings } from './settings'

/** One question at a time; `skip` is the key "Don't ask again" stores under (prompts that can lose work have none). */
type Ask = { title: string; message: string; ok: string; skip?: string; done: (yes: boolean) => void }
let current: Ask | null = null
const subs = new Set<() => void>()
const set = (a: Ask | null) => { current = a; subs.forEach(f => f()) }

/** Scrifts' own yes/no question, instead of the browser's confirm() (which a "don't show more dialogs" tick
 *  silently turns into "no"). With `skip`, the user can tick "Don't ask again"; Settings > General asks again. */
export function ask(message: string, o: { title?: string; ok?: string; skip?: string } = {}): Promise<boolean> {
  if (o.skip && getSettings().skipAsk.includes(o.skip)) return Promise.resolve(true)
  current?.done(false)  // a newer question replaces an open one
  return new Promise(done => set({ title: o.title ?? 'Are you sure?', message, ok: o.ok ?? 'OK', skip: o.skip, done }))
}

/** Mounted once, in App. */
export function AskHost() {
  const a = useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => current)
  const [never, setNever] = useState(false)
  const answer = (yes: boolean) => {
    if (!a) return
    if (yes && never && a.skip) setSettings({ skipAsk: [...new Set([...getSettings().skipAsk, a.skip])] })
    setNever(false)
    set(null)
    a.done(yes)
  }
  return (
    <Dialog open={!!a} onOpenChange={o => { if (!o) answer(false) }}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>{a?.title}</DialogTitle>
        <DialogDescription className="whitespace-pre-line">{a?.message}</DialogDescription>
        <DialogFooter className="sm:items-center">
          {a?.skip && (
            <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={never} onChange={e => setNever(e.target.checked)} />Don't ask again
            </label>
          )}
          <Button variant="outline" onClick={() => answer(false)}>Cancel</Button>
          <Button autoFocus onClick={() => answer(true)}>{a?.ok}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
