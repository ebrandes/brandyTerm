import type { Attachment, Message, Project, Thread } from '../shared/types.ts'
import type { AgentEvent, RunHandle, RunOpts } from './adapters/types.ts'
import { ADAPTERS } from './adapters/index.ts'
import type { ThreadApprovals } from './approvals.ts'
import { AUTOCOMPACT } from './coordinator-memory.ts'
import { buildThreadPrompt } from './coordinator.ts'
import { zeroUsage } from './new-thread.ts'
import { afterPlan, execPrompt, inPlan, runSpec } from './phases.ts'
import { addUsage, runOnce, type RunResult } from './run.ts'
import { settleThread } from './settle.ts'
import { applyThreadEvent } from './thread-events.ts'

/** What a thread run needs from the engine. */
export interface RunHost {
  handles: Map<string, RunHandle>
  approvals: Pick<ThreadApprovals, 'ask' | 'drop'>
  pluginsFor(path: string | null): string[]
  msg(author: Message['author'], text: string, extra?: Partial<Message>): Message
  touch(): void
  /** silent runs on the thread's session (short report, coordinator question) */
  reporter: { cancel(threadId: string): void; afterRun(p: Project, t: Thread): void }
  /** the thread stopped (done, waiting, failed or cancelled): report it or synthesize its request */
  finished(p: Project, t: Thread, direct: boolean): void
  /** start what is queued */
  pump(p: Project): void
}

type Run = (t: Thread, opts: RunOpts, onEvent: (e: AgentEvent) => void) => { handle: RunHandle; result: Promise<RunResult> }
const realRun: Run = (t, opts, onEvent) => runOnce(ADAPTERS[t.agent], opts, onEvent)

/**
 * Runs one turn of a thread. A `pesado` thread still in its planning phase runs read-only on
 * the plan's model; when the plan comes back the same thread goes straight on to execution,
 * and only the end of that counts as the thread stopping.
 */
export function runThread(host: RunHost, p: Project, t: Thread, prompt: string, direct: boolean, attachments?: Attachment[], run: Run = realRun): void {
  const planning = inPlan(t)
  // the user (or the queue) takes the session: a silent run on it stops first
  host.reporter.cancel(t.id)
  t.state = 'running'
  t.resolved = false
  t.pending = undefined
  t.retired = undefined
  t.note = planning ? 'Planejando…' : 'Iniciando…'
  t.aliveAt = t.runAt = new Date().toISOString()
  t.todos = []
  t.steps = []
  t.updatedAt = new Date().toISOString()
  // a cancel that never reaches the thread's state (project removed, app quitting) is still a cancel
  let cancelled = false
  const { handle: inner, result } = run(
    t,
    {
      cwd: p.path!,
      prompt,
      sessionId: t.sessionId,
      ...runSpec(t),
      thread: { projectId: p.id, threadId: t.id },
      approve: (a) => host.approvals.ask(t, a),
      plugins: host.pluginsFor(p.path ?? null),
      autocompact: AUTOCOMPACT,
      attachments
    },
    (e) => applyThreadEvent(p, t, e) && host.touch()
  )
  const handle: RunHandle = { done: inner.done, cancel: () => ((cancelled = true), inner.cancel()) }
  host.handles.set(t.id, handle)
  host.touch()
  void result.then((r) => {
    // cancelled and started again before this run closed: the thread belongs to the new run
    if (host.handles.get(t.id) !== handle) return
    host.handles.delete(t.id)
    host.approvals.drop(t)
    if (r.sessionId) t.sessionId = r.sessionId
    addUsage(t.usage, r.usage)
    t.updatedAt = new Date().toISOString()
    if (planning) {
      addUsage((t.plan!.usage ??= zeroUsage()), r.usage)
      const next = afterPlan(t, r, cancelled)
      if (next === 'exec') {
        t.messages.push(host.msg('agent', `**Plano** (${t.plan!.model})\n\n${t.plan!.text!}`, { plan: true }))
        return runThread(host, p, t, execPrompt(p, t), direct, t.attachments, run)
      }
      if (next === 'fallback') {
        t.messages.push(host.msg('system', `Plano indisponível (${r.done?.error ?? 'sem resposta'}): seguindo em fase única com ${t.model}.`))
        return runThread(host, p, t, buildThreadPrompt(p, t.objective, t.agent, t.skill), direct, t.attachments, run)
      }
    }
    const q = settleThread(t, r.done, (author, text, extra) => host.msg(author, text, extra))
    if (q) {
      p.messages.push(
        host.msg('agent', `A thread “${t.title}” precisa de uma decisão sua.`, { ask: { threadId: t.id, question: q.text, options: q.options, recommended: q.recommended } })
      )
    }
    host.finished(p, t, direct)
    host.reporter.afterRun(p, t)
    host.pump(p)
  })
}
