import type { Project, Thread } from '../shared/types.ts'
import { retire } from '../shared/thread-retire.ts'
import type { Answer, PlannedTask } from './coordinator.ts'
import { matchThread } from './thread-match.ts'

export interface ThreadSender {
  sendToThread(p: Project, threadId: string, text: string): void
  /** puts a question to the thread; returns '' when it started, else a pt-BR note */
  askThread(p: Project, t: Thread, question: string): string
}

const waiting = (t: Thread) => t.state === 'waiting'
const resumable = (t: Thread) => t.state === 'interrupted' && !t.retired
export const replaceable = (t: Thread) => (t.state === 'interrupted' || t.state === 'failed') && !t.retired

const names = (ts: Thread[]) => ts.map((t) => `“${t.title}”`).join(', ')

/** pt-BR warning for a title that matched nothing or more than one thread */
function miss(kind: string, title: string, m: { error: 'missing' | 'ambiguous'; candidates: Thread[] }): string {
  return m.error === 'ambiguous'
    ? `${kind}: o título “${title}” é ambíguo (${names(m.candidates)}); nada foi enviado.`
    : `${kind}: nenhuma thread disponível com o título “${title}”.`
}

/**
 * Delivers the coordinator's answers (threads waiting for the user) and resumes
 * (interrupted threads) exactly as if the user had written in each thread.
 * Titles that match nothing, or more than one thread, become notes for the reply.
 */
export function dispatchReplies(
  sender: ThreadSender,
  p: Project,
  plan: { answers: Answer[]; ask: Answer[]; resume: Answer[] }
): { resumed: string[]; notes: string[] } {
  const notes: string[] = []
  const resumed: string[] = []
  for (const a of plan.answers) {
    const m = matchThread(p.threads, a.threadTitle, waiting)
    if ('thread' in m) sender.sendToThread(p, m.thread.id, a.text)
    else notes.push(miss('Resposta não repassada', a.threadTitle, m))
  }
  for (const a of plan.ask) {
    const m = matchThread(p.threads, a.threadTitle, (t) => !t.retired && !!t.sessionId)
    if ('error' in m) {
      notes.push(miss('Pergunta não enviada', a.threadTitle, m))
      continue
    }
    const note = sender.askThread(p, m.thread, a.text)
    if (note) notes.push(note)
  }
  for (const r of plan.resume) {
    const m = matchThread(p.threads, r.threadTitle, resumable)
    if ('error' in m) {
      notes.push(miss('Não retomei', r.threadTitle, m))
      continue
    }
    sender.sendToThread(p, m.thread.id, r.text)
    resumed.push(m.thread.id)
  }
  return { resumed, notes }
}

/** A new task that `replaces` an interrupted or failed thread sets the old one aside, pointing to it. */
export function retireReplaced(p: Project, tasks: PlannedTask[], opened: Thread[]): string[] {
  const notes: string[] = []
  tasks.forEach((task, i) => {
    const fresh = opened[i]
    if (!task.replaces || !fresh) return
    const m = matchThread(p.threads.filter((t) => t !== fresh), task.replaces, replaceable)
    if ('thread' in m) retire(m.thread, 'superseded', { id: fresh.id, title: fresh.title })
    else notes.push(miss('Não marquei como substituída', task.replaces, m))
  })
  return notes
}

/** Appends the dispatch warnings to the coordinator's reply. */
export function withNotes(reply: string, notes: string[]): string {
  return notes.length ? `${reply}\n\n**Aviso:**\n${notes.map((n) => `- ${n}`).join('\n')}` : reply
}
