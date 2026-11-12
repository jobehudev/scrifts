/** Recently opened fonts, newest first. Local to this machine. */
export type Recent = { path: string; name: string; glyphs: number; opened: number }

const KEY = 'forge.recent'
const MAX = 12
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()  // Windows paths

export function loadRecent(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Recent[]
    if (list.length) return list
  } catch { /* corrupt entry: start over */ }
  const old = localStorage.getItem('forge.path')  // the single "last font" before this list existed
  return old ? [{ path: old, name: old.split(/[\\/]/).pop() ?? old, glyphs: 0, opened: 0 }] : []
}

function save(list: Recent[]) {
  localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  return list.slice(0, MAX)
}

export const addRecent = (r: Recent) => save([r, ...loadRecent().filter(x => !same(x.path, r.path))])
export const removeRecent = (path: string) => save(loadRecent().filter(x => !same(x.path, path)))
export const clearRecent = () => save([])

/** ".sfd", ".ufo", ... or '' */
export const ext = (path: string) => /\.[^.\\/]+$/.exec(path)?.[0] ?? ''

export function ago(t: number): string {
  if (!t) return ''
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
