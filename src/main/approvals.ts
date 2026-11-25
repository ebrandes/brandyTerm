import { randomUUID } from 'node:crypto'
import type { ApprovalDecision, Thread } from '../shared/types.ts'
import type { ApprovalAsk } from './adapters/types.ts'
import { alwaysLabel, covered, rulesFor } from './allow-rules.ts'

interface Pending {
  id: string
  ask: ApprovalAsk
  done: (d: ApprovalDecision) => void
}

/**
 * Tool calls waiting for the user, per thread. The first pending one is shown on the
 * thread (`t.approval`); answering it shows the next. What the user allows for good
 * ("always" rules, "allow all") lives on the thread itself, so it holds across turns
 * and restarts. Promises die with the app: a restart marks the run interrupted.
 */
export class ThreadApprovals {
  private queue = new Map<string, Pending[]>()
  private touch: () => void

  constructor(touch: () => void) {
    this.touch = touch
  }

  ask(t: Thread, a: ApprovalAsk): Promise<ApprovalDecision> {
    if (t.allowAll || covered(t.allow, a)) return Promise.resolve('allow')
    return new Promise((resolve) => {
      const id = randomUUID()
      const done = (d: ApprovalDecision) => {
        const list = (this.queue.get(t.id) ?? []).filter((x) => x.id !== id)
        if (list.length) this.queue.set(t.id, list)
        else this.queue.delete(t.id)
        if (d === 'always') t.allow = [...new Set([...(t.allow ?? []), ...rulesFor(a)])]
        if (d === 'all') t.allowAll = true
        // calls already queued may be covered now
        if (d === 'always' || d === 'all') for (const x of list.filter((x) => t.allowAll || covered(t.allow, x.ask))) x.done('allow')
        this.show(t)
        resolve(d)
      }
      const list = this.queue.get(t.id) ?? []
      list.push({ id, ask: a, done })
      t.steps.push(`Aguardando aprovação: ${a.summary}`)
      this.queue.set(t.id, list)
      a.signal.addEventListener('abort', () => done('deny'), { once: true })
      this.show(t)
    })
  }

  respond(t: Thread, id: string, d: ApprovalDecision): void {
    this.queue.get(t.id)?.find((x) => x.id === id)?.done(d)
  }

  /** the run ended or was cancelled: deny what it was still waiting for (the thread's rules stay) */
  drop(t: Thread): void {
    for (const x of [...(this.queue.get(t.id) ?? [])]) x.done('deny')
    t.approval = undefined
  }

  private show(t: Thread): void {
    const next = this.queue.get(t.id)?.[0]
    t.approval = next
      ? {
          id: next.id,
          tool: next.ask.tool,
          summary: next.ask.summary,
          detail: next.ask.detail,
          always: alwaysLabel(next.ask),
          createdAt: t.approval?.id === next.id ? t.approval.createdAt : new Date().toISOString()
        }
      : undefined
    this.touch()
  }
}
