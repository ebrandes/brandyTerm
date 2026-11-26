import { useEffect, useState } from 'react'
import type { ContextUse, Thread } from './types.ts'

/** a running thread silent for this long shows as "parada" on its card */
export const STALL_MS = 4 * 60_000

/** Current time, refreshed every `ms` (for "há X min" labels). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** Minutes a running thread has been silent, when that looks stuck; undefined otherwise. */
export function stalledMinutes(t: Thread, now: number): number | undefined {
  if (t.state !== 'running' || t.approval) return undefined
  const since = Date.parse(t.aliveAt ?? t.updatedAt)
  if (!since || now - since < STALL_MS) return undefined
  return Math.floor((now - since) / 60_000)
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace('.', ',')} mil`
  return String(n)
}

/** Share of the context window in use, 0..1. */
export function contextShare(c: ContextUse | undefined): number {
  return c && c.limit ? Math.min(1, c.used / c.limit) : 0
}

/** "45 mil de 200 mil (23%)" */
export function contextLabel(c: ContextUse): string {
  return `${formatTokens(c.used)} de ${formatTokens(c.limit)} (${Math.round(contextShare(c) * 100)}%)`
}
