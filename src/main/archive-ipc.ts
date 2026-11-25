import { ipcMain } from 'electron'
import type { Engine } from './engine.ts'
import { listArchived, reopenArchived } from './archive.ts'

/**
 * On-demand access to the thread archive: the board lists it only when the user opens
 * "Arquivadas", and reopening moves one thread back into the state (and the IPC).
 */
export function registerArchiveIpc(engine: Engine, dir: string): void {
  const projects = (ids: unknown) => {
    const want = new Set((Array.isArray(ids) ? ids : [ids]).map(String))
    return engine.state.projects.filter((p) => want.has(p.id))
  }
  ipcMain.handle('archive:list', (_e, projectIds: string[]) => listArchived(dir, projects(projectIds)))
  ipcMain.handle('archive:reopen', (_e, a: { projectId: string; threadId: string }) => {
    const p = engine.state.projects.find((x) => x.id === String(a.projectId))
    const t = p && reopenArchived(dir, p, String(a.threadId))
    if (!t) return false
    engine.touch()
    return true
  })
}
