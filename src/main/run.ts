import type { Usage } from '../shared/types.ts'
import type { AgentAdapter, AgentEvent, RunHandle, RunOpts } from './adapters/types.ts'
import { claudeAuth } from './adapters/auth.ts'

export interface RunResult {
  done?: Extract<AgentEvent, { kind: 'done' }>
  sessionId?: string
  usage: { input: number; output: number; cached: number; costUsd: number }
  /** context of the last model call (Claude only) */
  context?: { used: number; limit?: number }
}

/** Folds a context event into what is known: `used` comes per call, `limit` with the result. */
export function mergeContext(cur: { used: number; limit?: number } | undefined, e: { used: number; limit?: number }): { used: number; limit?: number } {
  return { used: e.used || cur?.used || 0, limit: e.limit || cur?.limit }
}

const CONTINUE = 'A conta anterior atingiu o limite e você foi retomado em outra. Continue de onde parou, sem refazer o que já foi feito, e termine a resposta no formato pedido.'

export function addUsage(target: Usage, u: { input: number; output: number; cached: number; costUsd?: number }): void {
  target.input += u.input
  target.output += u.output
  target.cached += u.cached
  if (u.costUsd) target.costUsd = (target.costUsd ?? 0) + u.costUsd
  target.measured = true
}

/**
 * Runs one agent turn, collecting session id, usage and the final event. When a Claude
 * run hits the subscription limit and another account takes over, the same turn runs
 * again there (sessions live in the shared ~/.claude, so the context carries over).
 */
export function runOnce(adapter: AgentAdapter, opts: RunOpts, onEvent?: (e: AgentEvent) => void): { handle: RunHandle; result: Promise<RunResult> } {
  const r: RunResult = { usage: { input: 0, output: 0, cached: 0, costUsd: 0 } }
  let cancelled = false
  let current: RunHandle
  let runOpts = opts
  const attempt = (left: number): Promise<void> => {
    let retry = false
    current = adapter.run(runOpts, (e) => {
      if (e.kind === 'session') r.sessionId = e.sessionId
      else if (e.kind === 'context') r.context = mergeContext(r.context, e)
      else if (e.kind === 'usage') {
        r.usage.input += e.input
        r.usage.output += e.output
        r.usage.cached += e.cached
        r.usage.costUsd += e.costUsd ?? 0
      } else if (e.kind === 'done') {
        const next = e.limited && e.account && left > 0 && !cancelled ? claudeAuth().failover(e.account) : null
        if (next) {
          retry = true
          onEvent?.({ kind: 'activity', text: `Limite da conta atingido; continuando na conta ${next.label}` })
          return
        }
        r.done = e
      }
      onEvent?.(e)
    })
    return current.done.then(() => {
      if (!retry || cancelled) return
      // the session already holds the request (and whatever was done): continue it instead of repeating it
      if (r.sessionId) runOpts = { ...opts, sessionId: r.sessionId, prompt: CONTINUE, attachments: [] }
      return attempt(left - 1)
    })
  }
  const done = attempt(adapter.id === 'claude' ? 1 : 0)
  const handle: RunHandle = {
    done,
    cancel: () => {
      cancelled = true
      current.cancel()
    }
  }
  return { handle, result: done.then(() => r) }
}
