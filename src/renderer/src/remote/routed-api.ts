// window.brandy as the renderer sees it: calls about a project go to the machine that owns it. No DOM/Electron.
import type { BrandyApi } from '../../../shared/api.ts'
import type { ArchivedThreadInfo } from '../../../shared/types.ts'
import { createMergedState } from './merged-state.ts'
import { remoteId, routeCall, splitIds } from './route.ts'

export function createRoutedApi(local: BrandyApi): BrandyApi {
  const state = createMergedState(local)

  const via = <T>(channel: string, arg: unknown, run: (a: any) => Promise<T>): Promise<T> => {
    const r = routeCall(channel, arg)
    if (r.machineId === null) return run(arg)
    return local.remote.call({ machineId: r.machineId, channel, arg: r.arg }) as Promise<T>
  }

  /** archive:list over several machines in parallel; an unreachable host adds nothing, a local failure still fails. */
  async function listArchived(ids: string[]): Promise<ArchivedThreadInfo[]> {
    const groups = [...splitIds(ids)]
    const parts = await Promise.all(groups.map(async ([machineId, list]) => {
      if (machineId === null) return local.listArchived(list as string[])
      try {
        const r = (await local.remote.call({ machineId, channel: 'archive:list', arg: list })) as ArchivedThreadInfo[]
        return r.map(a => ({ ...a, projectId: remoteId(machineId, a.projectId) }))
      } catch { return [] }
    }))
    const all = parts.flat()
    return groups.length > 1 ? all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : all
  }

  return {
    ...local,
    getState: () => state.get(),
    onState: cb => state.subscribe(cb),
    listArchived,
    removeProject: id => via('project:remove', id, a => local.removeProject(a)),
    send: a => via('chat:send', a, x => local.send(x)),
    saveAttachment: a => via('attach:save', a, x => local.saveAttachment(x)),
    readArtifact: a => via('artifact:read', a, x => local.readArtifact(x)),
    openArtifact: a => via('artifact:open', a, x => local.openArtifact(x)),
    listCommands: id => via('commands:list', id, x => local.listCommands(x)),
    listFiles: a => via('fs:list', a, x => local.listFiles(x)),
    cancelThread: a => via('thread:cancel', a, x => local.cancelThread(x)),
    approveTool: a => via('thread:approve', a, x => local.approveTool(x)),
    resolveThread: a => via('thread:resolve', a, x => local.resolveThread(x)),
    setAllowAll: a => via('thread:allowAll', a, x => local.setAllowAll(x)),
    reopenArchived: a => via('archive:reopen', a, x => local.reopenArchived(x)),
    startProcess: a => via('process:start', a, x => local.startProcess(x)),
    stopProcess: a => via('process:stop', a, x => local.stopProcess(x)),
    removeProcess: a => via('process:remove', a, x => local.removeProcess(x)),
    term: {
      ...local.term,
      open: a => via('term:open', a, x => local.term.open(x)),
      write: a => via('term:write', a, x => local.term.write(x)),
      resize: a => via('term:resize', a, x => local.term.resize(x)),
      kill: id => via('term:kill', id, x => local.term.kill(x))
    }
  }
}
