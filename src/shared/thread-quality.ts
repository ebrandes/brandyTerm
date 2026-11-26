import { extractQuestion } from './ask-question.ts'
import type { Thread } from './types.ts'
import type { QualityRow } from './usage-report.ts'

/** Practical quality of the threads: did the first delivery hold, or did the work have to be redone? */

const RANK = ['leve', 'padrao', 'pesado', 'pesado+']

/** 'leve' | 'padrao' | 'pesado' | 'pesado+'; undefined for a thread outside /rota. */
export function tierOf(t: Pick<Thread, 'tier' | 'boost'>): string | undefined {
  return t.tier && t.boost ? `${t.tier}+` : t.tier
}

// as in the router: a thread without a tier counts as padrao
const rankOf = (t: Pick<Thread, 'tier' | 'boost'>) => RANK.indexOf(tierOf(t) ?? 'padrao')

/**
 * Times someone came back to a delivered answer: a message (not a slash command) sent after a final
 * reply. Answers to a PERGUNTA:, plan approvals and retries after a failure do not count.
 * A new request typed in the same thread counts too: the text alone cannot tell them apart.
 */
export function corrections(t: Pick<Thread, 'messages'>): number {
  let delivered = false
  let count = 0
  for (const m of t.messages) {
    if (m.author === 'agent' && !m.plan) delivered = !extractQuestion(m.text)
    else if (m.author === 'system' && m.isError) delivered = false
    else if (m.author === 'user' && delivered && !m.text.trimStart().startsWith('/')) {
      count++
      delivered = false
    }
  }
  return count
}

/** Replaced by a thread of a higher tier. */
export function escalated(t: Thread, byId: Map<string, Thread>): boolean {
  const next = t.retired?.by ? byId.get(t.retired.by) : undefined
  return !!next && rankOf(next) > rankOf(t)
}

export const isFinished = (t: Thread) => !['queued', 'running', 'waiting'].includes(t.state)

/** Delivered and not set aside afterwards. */
export const isResolved = (t: Thread) => t.state === 'done' && !t.retired

/** Delivered with no replacement, correction or tier escalation. */
export const isClean = (t: Thread, byId: Map<string, Thread>) => isResolved(t) && !corrections(t) && !escalated(t, byId)

/** New tokens (input outside the cache plus output) over the whole life of the thread. */
export function threadTokens(t: Pick<Thread, 'agent' | 'usage'>): number {
  const u = t.usage
  return (t.agent === 'codex' ? Math.max(0, u.input - u.cached) : u.input) + u.output
}

export const percent = (part: number, whole: number): number | null => (whole ? Math.round((part / whole) * 1000) / 10 : null)

/**
 * `byId` must hold every thread (any month), so a replacement made later is still found.
 * Tokens per resolved thread includes what the unresolved and replaced ones spent.
 */
export function qualityRow(tier: string, threads: Thread[], byId: Map<string, Thread>): QualityRow {
  const finished = threads.filter(isFinished)
  const resolved = finished.filter(isResolved).length
  const clean = finished.filter((t) => isClean(t, byId)).length
  const tokens = finished.reduce((n, t) => n + threadTokens(t), 0)
  return {
    tier,
    open: threads.length - finished.length,
    finished: finished.length,
    resolved,
    clean,
    cleanPct: percent(clean, finished.length),
    replaced: threads.filter((t) => t.retired?.reason === 'superseded').length,
    corrections: threads.reduce((n, t) => n + corrections(t), 0),
    escalations: threads.filter((t) => escalated(t, byId)).length,
    tokensPerResolved: resolved ? Math.round(tokens / resolved) : null
  }
}

/** one row per tier present, cheapest first; threads outside /rota last */
export function qualityByTier(threads: Thread[], byId: Map<string, Thread>): QualityRow[] {
  return [...RANK, 'sem tier']
    .map((tier) => ({ tier, list: threads.filter((t) => (tierOf(t) ?? 'sem tier') === tier) }))
    .filter((g) => g.list.length)
    .map((g) => qualityRow(g.tier, g.list, byId))
}
