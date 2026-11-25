import type { Project } from '../shared/types.ts'

/** A process id only counts for the project that started it. */
export const ownsProcess = (p: Pick<Project, 'processes'> | undefined, processId: string): boolean =>
  !!p && p.processes.some((x) => x.id === processId)

/** The ids of a process:stop / process:remove call when that project started that process; null otherwise. */
export function ownedProcess(
  projects: Pick<Project, 'id' | 'processes'>[], arg: unknown
): { projectId: string; processId: string } | null {
  if (typeof arg !== 'object' || arg === null) return null
  const { projectId, processId } = arg as { projectId?: unknown; processId?: unknown }
  const p = projects.find((x) => x.id === String(projectId))
  return ownsProcess(p, String(processId)) ? { projectId: String(projectId), processId: String(processId) } : null
}
