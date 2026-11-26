import { markSent } from '../shared/thread-report-state.ts'
import type { Message, Project, Summary, Thread } from '../shared/types.ts'
import { buildSynthesisPrompt } from './coordinator.ts'
import type { Engine } from './engine.ts'
import { remember, rotateSession } from './coordinator-memory.ts'

const TERMINAL = new Set(['done', 'failed', 'cancelled', 'interrupted'])

/** A thread the user talked to directly reports back in the main chat, without a synthesis. */
export function reportDirect(engine: Engine, p: Project, t: Thread): void {
  const text = t.state === 'done' ? `A thread “${t.title}” respondeu.` : `A thread “${t.title}” falhou: ${t.note}`
  const summaries: Summary[] | undefined =
    t.state === 'done' && t.summary ? [{ agent: t.agent, title: t.title, text: t.summary, threadId: t.id }] : undefined
  const post = (): void => {
    const message = engine.msg('agent', text, { summaries, isError: t.state === 'failed' })
    p.messages.push(message)
    if (summaries) markSent(t, message.time)
    engine.touch()
  }
  if (t.state === 'done' && t.resolved && engine.reporter.report(p, t, 'curto', post)) return
  post()
}

/** When every thread of a request has finished, the coordinator writes one closing answer. */
export function maybeSynthesize(engine: Engine, p: Project, requestId: string): void {
  const group = p.threads.filter((t) => t.requestId === requestId)
  if (!group.length || p.synthesized.includes(requestId)) return
  if (!group.every((t) => TERMINAL.has(t.state))) return
  p.synthesized.push(requestId)
  if (group.every((t) => t.state === 'cancelled')) return
  const summaries: Summary[] = group
    .filter((t) => t.state === 'done' || t.state === 'failed')
    .map((t) => ({ agent: t.agent, title: t.title, text: t.summary ?? t.note ?? '', threadId: t.id }))
  const sending = trackSending(engine, group.filter((t) => t.state === 'done'))
  engine.enqueue(p, async () => {
    try {
      rotateSession(p)
      const res = await engine.askCoordinator(p, buildSynthesisPrompt(group, p.path))
      if ('error' in res) {
        const message = engine.msg('coordinator', 'As threads terminaram, mas não consegui montar a síntese. Resultado parcial abaixo.', { summaries })
        p.messages.push(message)
        sending.sent(message)
        return engine.fail(p, `O coordenador falhou na síntese. ${res.error}`)
      }
      const message = engine.msg('coordinator', res.plan.reply, { summaries })
      p.messages.push(message)
      sending.sent(message)
      remember(engine, p, res.plan.memory)
    } finally {
      sending.end()
    }
  })
}

/** While the synthesis is written, its finished threads show as sending; a thread on a new turn is left alone. */
function trackSending(engine: Engine, threads: Thread[]) {
  const turns = threads.map((t) => ({ t, runAt: t.runAt }))
  for (const t of threads) t.reporting = true
  if (threads.length) engine.touch()
  const sameTurn = () => turns.filter((x) => x.t.runAt === x.runAt).map((x) => x.t)
  return {
    sent(message: Message): void {
      for (const t of sameTurn()) markSent(t, message.time)
    },
    end(): void {
      // a report of its own still being written keeps the thread as sending
      for (const t of sameTurn()) if (!engine.reporter.writing(t.id)) t.reporting = undefined
      if (threads.length) engine.touch()
    }
  }
}
