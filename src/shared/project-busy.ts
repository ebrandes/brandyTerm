import type { Project, Thread } from './types.ts'

/** Whether a project is doing work now, for the main (refusals) and the renderer (disabled menu items). Pure. */

const LIVE = new Set<Thread['state']>(['queued', 'running', 'waiting'])

/** threads still alive (queued, running or waiting for an answer) */
export function liveThreads(p: Pick<Project, 'threads'>): number {
  return p.threads.filter((t) => LIVE.has(t.state)).length
}

/** why destructive actions are blocked now; null when they are allowed */
export function busyReason(p: Pick<Project, 'threads' | 'busy'>): string | null {
  const n = liveThreads(p)
  if (n) return n === 1 ? 'Há 1 thread em execução neste projeto. Espere terminar ou cancele.' : `Há ${n} threads em execução neste projeto. Espere terminar ou cancele.`
  if (p.busy) return 'O coordenador está respondendo neste projeto. Espere terminar.'
  return null
}
