import type { Project, Summary, Thread } from '../shared/types.ts'
import { buildSynthesisPrompt } from './coordinator.ts'
import type { Engine } from './engine.ts'
import { remember, rotateSession } from './coordinator-memory.ts'

const TERMINAL = new Set(['done', 'failed', 'cancelled', 'interrupted'])

/** A thread the user talked to directly reports back in the main chat, without a synthesis. */
export function reportDirect(engine: Engine, p: Project, t: Thread): void {
  const text = t.state === 'done' ? `A thread “${t.title}” respondeu.` : `A thread “${t.title}” falhou: ${t.note}`
  const summaries: Summary[] | undefined =
    t.state === 'done' && t.summary ? [{ agent: t.agent, title: t.title, text: t.summary, threadId: t.id }] : undefined
  p.messages.push(engine.msg('agent', text, { summaries, isError: t.state === 'failed' }))
  engine.touch()
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
  engine.enqueue(p, async () => {
    rotateSession(p)
    const res = await engine.askCoordinator(p, buildSynthesisPrompt(group, p.path))
    if ('error' in res) {
      p.messages.push(engine.msg('coordinator', 'As threads terminaram, mas não consegui montar a síntese. Resultado parcial abaixo.', { summaries }))
      return engine.fail(p, `O coordenador falhou na síntese. ${res.error}`)
    }
    p.messages.push(engine.msg('coordinator', res.plan.reply, { summaries }))
    remember(engine, p, res.plan.memory)
  })
}
