import { randomUUID } from 'node:crypto'
import type { Attachment, Message, Thread, Usage } from '../shared/types.ts'
import type { PlannedTask } from './coordinator.ts'

export const zeroUsage = (): Usage => ({ input: 0, output: 0, cached: 0, measured: false })

type MakeMessage = (author: Message['author'], text: string, extra?: Partial<Message>) => Message

/** A queued thread for a planned task; its first message is the objective, with the request's files. */
export function newThread(task: PlannedTask, requestId: string, atts: Attachment[], msg: MakeMessage, allowAll: boolean): Thread {
  const now = new Date().toISOString()
  const files = atts.length ? atts : undefined
  const t: Thread = {
    id: randomUUID(),
    requestId,
    title: task.title,
    objective: task.objective,
    agent: task.agent,
    model: task.model,
    effort: task.effort,
    why: task.why,
    skill: task.skill,
    todos: [],
    steps: [],
    state: 'queued',
    note: 'Na fila',
    attachments: files,
    messages: [msg('coordinator', task.objective, { attachments: files })],
    usage: zeroUsage(),
    createdAt: now,
    updatedAt: now
  }
  if (allowAll) t.allowAll = true
  return t
}
