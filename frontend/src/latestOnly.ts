/**
 * Runs `task` one at a time. Asking again while it is running does not start a second one: it remembers to run
 * once more as soon as the first is done (the task reads the newest state itself). So a fast stream of changes,
 * like a weight sweep, costs one request in flight instead of a queue of stale ones.
 */
export function latestOnly(task: () => Promise<void>): () => void {
  let busy = false
  let again = false
  const go = (): void => {
    if (busy) { again = true; return }
    busy = true
    task().catch(() => {}).finally(() => {
      busy = false
      if (again) { again = false; go() }
    })
  }
  return go
}
