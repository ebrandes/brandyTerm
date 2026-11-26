/**
 * Where a connector is active, in one place: the store, the tool calls and the dot all ask here.
 * No project list means every project, new ones included, minus the exceptions.
 * A project list means only those, and the exceptions don't apply.
 */
export interface ConnectorScope {
  projects?: string[]
  exceptProjects?: string[]
}

export function isGlobal(c: ConnectorScope): boolean {
  return !c.projects?.length
}

export function activeIn(c: ConnectorScope, projectPath: string): boolean {
  return isGlobal(c) ? !c.exceptProjects?.includes(projectPath) : c.projects!.includes(projectPath)
}

type ScopeChange = { global: true } | { path: string; on: boolean }

/**
 * The patch for one scope change; at most one of the two lists comes back filled.
 * Null when the lists can't say it: a limited connector without any project would read as global.
 */
export function scopePatch(c: ConnectorScope, change: ScopeChange): Required<ConnectorScope> | null {
  if ('global' in change) return { projects: [], exceptProjects: [] }
  const { path, on } = change
  const edit = (list: string[], add: boolean): string[] => {
    const rest = list.filter(p => p !== path)
    return add ? [...rest, path] : rest
  }
  if (isGlobal(c)) return { projects: [], exceptProjects: edit(c.exceptProjects ?? [], !on) }
  const projects = edit(c.projects!, on)
  return projects.length ? { projects, exceptProjects: [] } : null
}
