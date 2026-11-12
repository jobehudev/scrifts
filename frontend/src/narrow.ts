import { useEffect, useState, type RefObject } from 'react'

/** True while the element's container (the pane it floats over) is narrower than `limit` px. */
export function useNarrow(ref: RefObject<HTMLElement | null>, limit = 560) {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const box = ref.current?.offsetParent as HTMLElement | null
    if (!box) return
    const ro = new ResizeObserver(() => setNarrow(box.clientWidth < limit))
    ro.observe(box)
    return () => ro.disconnect()
  }, [ref, limit])
  return narrow
}
