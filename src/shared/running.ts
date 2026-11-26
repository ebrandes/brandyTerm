// "Is something running?": the one rule behind the deferred apply and the threads' `app_status`.
// Applying to the project folder restarts the app, so this lists what a restart would kill.
import type { Project } from './types.ts'

export type RunningKind = 'coordinator' | 'thread' | 'report'

export interface RunningItem {
  projectId: string
  projectName: string
  kind: RunningKind
  title: string
  threadId?: string
}

/**
 * Everything alive across all projects. `waiting` and `interrupted` threads have no run to lose,
 * and demo projects run nothing real (their threads may stay "running" forever).
 */
export function runningItems(projects: Project[]): RunningItem[] {
  return projects.filter((p) => !p.demo).flatMap((p) => {
    const item = (kind: RunningKind, title: string, threadId?: string): RunningItem =>
      ({ projectId: p.id, projectName: p.name, kind, title, ...(threadId ? { threadId } : {}) })
    const threads = p.threads.flatMap((t) => {
      if (t.state === 'running' || t.state === 'queued') return [item('thread', t.title, t.id)]
      return t.reporting ? [item('report', t.title, t.id)] : []
    })
    return p.busy ? [item('coordinator', 'Coordenador'), ...threads] : threads
  })
}
