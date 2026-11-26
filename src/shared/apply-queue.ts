// Deferred apply of a worktree to the project folder: types and pure rules. The main process owns
// the git side and the persistence (main/apply-queue.ts).

export type ApplyStatus = 'approval' | 'pending' | 'applying' | 'applied' | 'failed' | 'cancelled'

export interface ApplyItem {
  id: string
  projectId: string
  /** the thread that asked for it */
  threadId?: string
  title: string
  worktree: string
  branch: string
  /** the patch is `base..head`: head is pinned at enqueue, so the approval covers exactly that */
  base: string
  head: string
  files: string[]
  status: ApplyStatus
  /** applied without asking the user: it does not restart BrandyTerm (see apply-auto.ts) */
  auto?: boolean
  error?: string
  createdAt: string
  appliedAt?: string
}

export interface ApplyQueueView {
  items: ApplyItem[]
  /** coordinators, threads and reports running in all projects */
  running: number
}

/** nothing running for this long before applying: covers the gap between a thread and its synthesis */
export const IDLE_WINDOW_MS = 5_000
/** after the app starts, and between two applies (the restart of one must happen before the next) */
export const SETTLE_MS = 20_000
/** applied and discarded items kept in the file */
const KEEP_DONE = 5

const done = (i: ApplyItem) => i.status === 'applied' || i.status === 'cancelled'

function prune(items: ApplyItem[]): ApplyItem[] {
  const drop = new Set(items.filter(done).slice(0, -KEEP_DONE).map((i) => i.id))
  return drop.size ? items.filter((i) => !drop.has(i.id)) : items
}

const change = (items: ApplyItem[], id: string, from: ApplyStatus[], patch: Partial<ApplyItem>): ApplyItem[] =>
  prune(items.map((i) => (i.id === id && from.includes(i.status) ? { ...i, ...patch } : i)))

/** A new request for a worktree replaces its earlier one that has not been applied. */
export function enqueue(items: ApplyItem[], item: ApplyItem): ApplyItem[] {
  const same = (i: ApplyItem) => i.projectId === item.projectId && i.worktree === item.worktree && !done(i)
  if (items.some((i) => same(i) && i.status === 'applying')) throw new Error('Esta worktree está sendo aplicada agora.')
  return prune([...items.filter((i) => !same(i)), item])
}

export const approve = (items: ApplyItem[], id: string): ApplyItem[] => change(items, id, ['approval'], { status: 'pending' })

/** releases a waiting request that, by the current rule, never needed the approval */
export const release = (items: ApplyItem[], id: string): ApplyItem[] => change(items, id, ['approval'], { status: 'pending', auto: true })

export const retry = (items: ApplyItem[], id: string): ApplyItem[] => change(items, id, ['failed'], { status: 'pending', error: undefined })

/** Cancels what has not been applied; on an applied (or cancelled) item it dismisses the entry. */
export function cancel(items: ApplyItem[], id: string): ApplyItem[] {
  const item = items.find((i) => i.id === id)
  if (item && done(item)) return items.filter((i) => i.id !== id)
  return change(items, id, ['approval', 'pending', 'failed'], { status: 'cancelled', error: undefined })
}

export const settle = (items: ApplyItem[], id: string, patch: Partial<ApplyItem>): ApplyItem[] =>
  change(items, id, ['pending', 'applying'], patch)

export interface ApplyTimes {
  /** since when nothing has been running; null while something is */
  idleSince: number | null
  lastApplyAt: number | null
  bootAt: number
}

export type WaitReason = 'empty' | 'applying' | 'failed' | 'running' | 'settling'
export type ApplyAction = { apply: string } | { wait: WaitReason }

/**
 * One at a time, in order. Unapproved requests do not hold the ones behind; a failed one does,
 * until the user retries or discards it (what comes next may depend on it).
 */
export function nextAction(items: ApplyItem[], running: number, now: number, t: ApplyTimes): ApplyAction {
  if (items.some((i) => i.status === 'applying')) return { wait: 'applying' }
  const head = items.find((i) => i.status === 'pending' || i.status === 'failed')
  if (!head) return { wait: 'empty' }
  if (head.status === 'failed') return { wait: 'failed' }
  if (running > 0 || t.idleSince === null) return { wait: 'running' }
  const early = now - t.idleSince < IDLE_WINDOW_MS || now - t.bootAt < SETTLE_MS
  if (early || (t.lastApplyAt !== null && now - t.lastApplyAt < SETTLE_MS)) return { wait: 'settling' }
  return { apply: head.id }
}

export const waitingLabel = (running: number): string =>
  running > 0 ? `aguardando threads terminarem (${running} rodando)` : 'aplicando em instantes'

/** what the panel lists: everything but the discarded */
export const visibleItems = (items: ApplyItem[]): ApplyItem[] => items.filter((i) => i.status !== 'cancelled')
