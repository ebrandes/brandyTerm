import type { Project, Thread } from '../shared/types.ts'
import type { AgentEvent } from './adapters/types.ts'

/** a context limit is not known before the first result; Claude's default window */
const DEFAULT_WINDOW = 200_000
/** a sign of life refreshes the UI at most this often (the card counts the silence) */
const ALIVE_REFRESH_MS = 60_000

/** Applies a live event of a thread run (session, plan, activity) to the thread; true when the UI must refresh. */
export function applyThreadEvent(p: Project, t: Thread, e: AgentEvent): boolean {
  const now = new Date()
  const last = t.aliveAt ? Date.parse(t.aliveAt) : 0
  t.aliveAt = now.toISOString()
  if (e.kind === 'alive') return now.getTime() - last > ALIVE_REFRESH_MS
  if (e.kind === 'context') {
    const used = e.used || t.context?.used || 0
    t.context = { used, limit: e.limit || t.context?.limit || DEFAULT_WINDOW }
    return true
  }
  if (e.kind === 'session') {
    t.sessionId = e.sessionId
    return false
  }
  if (e.kind === 'todos') {
    t.todos = e.items
    const cur = e.items.find((i) => i.status === 'in_progress')
    if (cur) t.note = cur.text
    return true
  }
  if (e.kind === 'activity') {
    const root = (p.path ?? '').replace(/\\/g, '/')
    const short = root ? e.text.replace(/\\/g, '/').split(root).join('.') : e.text
    t.steps.push(short)
    if (t.steps.length > 60) t.steps.shift()
    if (!t.todos.some((i) => i.status === 'in_progress')) t.note = short
    t.updatedAt = new Date().toISOString()
    return true
  }
  return false
}
