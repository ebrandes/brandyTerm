import type { Thread } from '../shared/types.ts'

export type ThreadMatch = { thread: Thread } | { error: 'missing' | 'ambiguous'; candidates: Thread[] }

/** shortest prefix accepted as a title: below it a match would be a guess */
const MIN_PREFIX = 8

const norm = (s: string) =>
  s.replace(/(…|\.{3})\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Finds the thread the coordinator named, among those `ok` accepts. Exact title first
 * (case and spacing ignored), then a unique prefix either way: the coordinator may cut a
 * long title, or repeat in full one that was stored cut. Several hits are ambiguous.
 */
export function matchThread(threads: Thread[], title: string, ok: (t: Thread) => boolean): ThreadMatch {
  const given = norm(title)
  const pool = threads.filter(ok)
  const exact = pool.filter((t) => norm(t.title) === given)
  if (exact.length === 1) return { thread: exact[0] }
  if (exact.length > 1) return { error: 'ambiguous', candidates: exact }
  if (given.length < MIN_PREFIX) return { error: 'missing', candidates: [] }
  const prefix = pool.filter((t) => {
    const own = norm(t.title)
    return own.startsWith(given) || (own.length >= MIN_PREFIX && given.startsWith(own))
  })
  if (prefix.length === 1) return { thread: prefix[0] }
  return prefix.length ? { error: 'ambiguous', candidates: prefix } : { error: 'missing', candidates: [] }
}
