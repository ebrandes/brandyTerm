import type { Project } from '../shared/types.ts'

/** A process id only counts for the project that started it. */
export const ownsProcess = (p: Pick<Project, 'processes'> | undefined, processId: string): boolean =>
  !!p && p.processes.some((x) => x.id === processId)
