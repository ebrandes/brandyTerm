import type { Project } from '../shared/types.ts'
import { unescapeReply } from './coordinator.ts'

/** Normalizes projects loaded from disk: nothing that was in flight when the app closed is still running. */
export function restoreProjects(projects: Project[]): void {
  for (const p of projects) {
    p.busy = false
    // replies saved before the fix may hold literal "\n" instead of line breaks
    for (const m of [...p.messages, ...p.threads.flatMap((t) => t.messages)]) if (m.author !== 'user') m.text = unescapeReply(m.text)
    p.processes ??= []
    // child processes never survive the app
    for (const x of p.processes) if (x.state === 'running') x.state = 'exited'
    for (const t of p.threads) {
      t.todos ??= []
      t.steps ??= []
      // a pending approval or a report in progress belonged to a run that died with the app
      t.approval = undefined
      t.reporting = undefined
      if (p.demo) continue
      if (t.state === 'running' || t.state === 'queued') {
        t.state = 'interrupted'
        t.note = 'Interrompida ao fechar o app. Envie uma mensagem para retomar.'
      }
    }
  }
}
