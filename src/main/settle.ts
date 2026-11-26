import { pendingDecision } from '../shared/ask-detect.ts'
import type { Message, Thread } from '../shared/types.ts'
import type { AgentEvent } from './adapters/types.ts'
import { extractPending, extractQuestion, extractSummary } from './coordinator.ts'

type MakeMsg = (author: Message['author'], text: string, extra?: Partial<Message>) => Message

/**
 * Moves a finished thread to its final state from the run's last event:
 * done, waiting (it left decisions with the user: PERGUNTA: lines, questions in free text or a
 * closing summary that says so) or failed. A cancelled thread stays cancelled.
 * Returns the question when the thread now waits for the user.
 */
export function settleThread(t: Thread, done: Extract<AgentEvent, { kind: 'done' }> | undefined, msg: MakeMsg): Thread['question'] {
  if ((t.state as string) === 'cancelled') {
    t.note = 'Cancelado'
    return undefined
  }
  if (!done?.ok) {
    t.state = 'failed'
    t.note = done?.error ?? 'falhou'
    t.messages.push(msg('system', `Falhou: ${t.note}`, { isError: true }))
    return undefined
  }
  t.messages.push(msg('agent', done.text))
  const summary = extractSummary(done.text)
  const pending = extractPending(done.text)
  const q = extractQuestion(done.text) ?? openDecision(`${summary ?? ''}\n${pending ?? ''}`)
  if (q) {
    awaitUser(t, q)
    return q
  }
  t.state = 'done'
  t.note = undefined
  t.summary = summary
  // auto-resolve: nothing left to do closes the thread; anything pending keeps it open
  t.pending = pending
  t.resolved = !t.pending
  return undefined
}

/** The question of a summary that only says a decision of the user is still open. */
export function openDecision(summary: string): Thread['question'] {
  const open = pendingDecision(summary)
  return open ? { text: `A thread terminou com uma decisão sua em aberto: ${open}` } : undefined
}

export function awaitUser(t: Thread, q: NonNullable<Thread['question']>): void {
  t.state = 'waiting'
  t.question = q
  t.note = 'Aguardando sua resposta'
  t.summary = undefined
  t.resolved = false
}

/** The card the coordinator chat shows for a thread that waits. */
export function askMessage(t: Thread, q: NonNullable<Thread['question']>, msg: MakeMsg): Message {
  const { text: question, ...rest } = q
  return msg('agent', `A thread “${t.title}” precisa de uma decisão sua.`, { ask: { threadId: t.id, question, ...rest } })
}
