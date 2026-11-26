/** What the minimized PROCESSOS + footer area shows (pure, no React). */
import type { ContextUse, ProcessInfo } from './types.ts'
import { contextShare, formatTokens } from './health.ts'
import type { DetectedProc } from '../../shared/proc-attribution.ts'

export interface DockSummary {
  count: number
  exited: number
  /** ports of running processes only: an exited one no longer listens */
  ports: number[]
  /** "40,0 mil (13%)", absent before the coordinator reports any use */
  context: string | undefined
  /** new threads skip approvals: a security choice, so it never hides */
  allowAll: boolean
}

export function dockSummary(
  processes: ProcessInfo[], context: ContextUse | undefined, allowAll: boolean, detected: DetectedProc[] = []
): DockSummary {
  const running = processes.filter((p) => p.state === 'running')
  return {
    count: processes.length + detected.length,
    exited: processes.length - running.length,
    ports: [...new Set([...running, ...detected].flatMap((p) => p.ports))].sort((a, b) => a - b),
    context: context && `${formatTokens(context.used)} (${Math.round(contextShare(context) * 100)}%)`,
    allowAll,
  }
}
