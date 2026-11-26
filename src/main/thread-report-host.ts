import type { Project, Thread } from '../shared/types.ts'
import type { Engine } from './engine.ts'
import { ADAPTERS } from './adapters/index.ts'
import { remember } from './coordinator-memory.ts'
import { addUsage, runOnce, type RunResult } from './run.ts'
import { ThreadReporter, type SilentResult } from './thread-report.ts'

/** What a settled run tells the reporter. */
export function silentResult(r: RunResult): SilentResult {
  return { ok: !!r.done?.ok, text: r.done?.text ?? '', error: r.done?.error, sessionId: r.sessionId }
}

/** The reporter wired to the engine: runs happen read-only in the thread's own session. */
export function createReporter(engine: Engine, pluginsFor: (path: string | null) => string[]): ThreadReporter {
  return new ThreadReporter({
    msg: (author, text, extra) => engine.msg(author, text, extra),
    touch: () => engine.touch(),
    enqueue: (p, job) => engine.enqueue(p, job),
    askCoordinator: (p, prompt) => engine.askCoordinator(p, prompt),
    remember: (p, notes) => remember(engine, p, notes),
    run: (p, t, prompt) => {
      const { handle, result } = runOnce(ADAPTERS[t.agent], {
        cwd: p.path!,
        prompt,
        sessionId: t.sessionId,
        model: t.model,
        effort: t.effort,
        tools: 'readonly',
        thread: { projectId: p.id, threadId: t.id },
        plugins: pluginsFor(p.path ?? null)
      })
      return {
        cancel: () => handle.cancel(),
        result: result.then((r) => {
          addUsage(t.usage, r.usage)
          return silentResult(r)
        })
      }
    }
  })
}

/** The "enviar resumo" button: the full report of a thread, found by id. */
export function reportThreadById(engine: Engine, projectId: string, threadId: string): void {
  const p: Project | undefined = engine.state.projects.find((x) => x.id === projectId)
  const t: Thread | undefined = p?.threads.find((x) => x.id === threadId)
  if (p && t) engine.reporter.report(p, t, 'completo')
}
