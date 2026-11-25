import type { ContextUse } from './types.ts'

/**
 * Coordinator context ceiling. Claude reports the model's native window (1M on current models),
 * but the coordinator never goes past this, for cost: the session is replaced before it gets there.
 * Global: projects have no per-project config.
 */
export const coordinatorContextLimit = 300_000
/** share of the limit at which, before a turn, the coordinator starts a new session */
export const COMPACT_RATIO = 0.85
/** cheaper soft rotation: a fresh session plus the project memory costs less per call than a long one */
export const SESSION_CONTEXT = 80_000
/** the Claude CLI refuses an --autocompact window below this */
const MIN_AUTOCOMPACT = 100_000
/** window the agent compacts itself at inside a turn (threads and coordinator) */
export const AUTOCOMPACT = 120_000

/** Limit shown and enforced: the model's window, but never above the coordinator ceiling. */
export function coordinatorLimit(reported?: number, limit = coordinatorContextLimit): number {
  return reported && reported > 0 ? Math.min(reported, limit) : limit
}

/** Tokens at which, before a turn, the session is replaced: the soft rotation or 85% of the limit, whichever comes first. */
export function rotateAt(limit = coordinatorContextLimit): number {
  return Math.min(SESSION_CONTEXT, Math.floor(limit * COMPACT_RATIO))
}

/** The compaction rule checked before each coordinator turn. */
export function shouldCompact(used: number | undefined, limit = coordinatorContextLimit): boolean {
  return (used ?? 0) >= rotateAt(limit)
}

/** Footer warning: the session is about to be replaced (3/4 of the way to `rotateAt`). */
export function coordinatorWarn(used: number, limit = coordinatorContextLimit): boolean {
  return used >= rotateAt(limit) * 0.75
}

/** --autocompact window for the coordinator: compacts inside a long turn, always below the limit. */
export function coordinatorAutocompact(limit = coordinatorContextLimit): number {
  return Math.max(MIN_AUTOCOMPACT, Math.min(AUTOCOMPACT, Math.floor(limit * COMPACT_RATIO)))
}

/** Stores a run's context with the limit clamped to the ceiling (old saves carry the 1M window). */
export function coordinatorContext(run: { used: number; limit?: number }, prev?: ContextUse): ContextUse {
  return { used: run.used, limit: coordinatorLimit(run.limit ?? prev?.limit) }
}
