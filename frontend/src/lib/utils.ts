export { cn } from "cn"

/** A JSON value kept in localStorage; `init` when it is missing or not readable. */
export function stored<T>(key: string, init: T): T {
  try { const v = localStorage.getItem(key); return v === null ? init : JSON.parse(v) as T } catch { return init }
}
