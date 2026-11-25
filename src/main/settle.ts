import type { Message, Thread } from '../shared/types.ts'
import type { AgentEvent } from './adapters/types.ts'
import { extractPending, extractQuestion, extractSummary } from './coordinator.ts'

type MakeMsg = (author: Message['author'], text: string, extra?: Partial<Message>) => Message

/**
 * Moves a finished thread to its final state from the run's last event:
 * done, waiting (it ended with a PERGUNTA: line) or failed. A cancelled thread stays cancelled.
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
  const q = extractQuestion(done.text)
  if (q) {
    t.state = 'waiting'
    t.question = q
    t.note = 'Aguardando sua resposta'
    t.summary = undefined
    return q
  }
  t.state = 'done'
  t.note = undefined
  t.summary = extractSummary(done.text)
  // auto-resolve: nothing left to do closes the thread; anything pending keeps it open
  t.pending = extractPending(done.text)
  t.resolved = !t.pending
  return undefined
}
