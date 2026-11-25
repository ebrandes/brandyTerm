import type { IdleCompactCfg, Project } from './types.ts'

export const DEFAULT_IDLE_COMPACT: IdleCompactCfg = { enabled: true, minutes: 4, minTokens: 40_000 }

/** A thread or the coordinator is doing work: the machine must not sleep. */
export function shouldStayAwake(projects: Project[]): boolean {
  return projects.some((p) => p.busy || p.threads.some((t) => t.state === 'running' || t.state === 'queued'))
}

/** Time of the last message in the project (the coordinator's last activity), in ms; 0 if none. */
export function lastActivityMs(p: Project): number {
  let last = 0
  for (const m of p.messages) last = Math.max(last, Date.parse(m.time) || 0)
  return last
}

/** The idle coordinator is due for compaction now. Only Claude coordinators: Codex compacts itself. */
export function idleCompactDue(p: Project, nowMs: number, cfg: IdleCompactCfg = DEFAULT_IDLE_COMPACT): boolean {
  if (!cfg.enabled) return false
  const c = p.coordinator
  if (c.agent !== 'claude' || !c.sessionId) return false
  if (p.busy || p.threads.some((t) => t.state === 'running' || t.state === 'queued')) return false
  if ((c.context?.used ?? 0) < cfg.minTokens) return false
  const activity = lastActivityMs(p)
  if (!activity || nowMs - activity < cfg.minutes * 60_000) return false
  if (c.compactedAt && Date.parse(c.compactedAt) >= activity) return false
  return true
}
