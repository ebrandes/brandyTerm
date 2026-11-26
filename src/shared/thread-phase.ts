import type { Thread } from './types.ts'

/**
 * The model shown on a thread's badges. A thread that plans first shows the plan's model while
 * planning, and afterwards its own model with a note of who planned.
 */
export function modelLabel(t: Pick<Thread, 'model' | 'plan'>): string {
  if (!t.plan) return t.model ?? ''
  if (!t.plan.done) return `plano · ${t.plan.model}`
  return t.plan.text ? `${t.model ?? ''} · plano ${t.plan.model}`.replace(/^ · /, '') : (t.model ?? '')
}
