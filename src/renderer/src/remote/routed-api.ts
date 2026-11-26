// window.brandy as the renderer sees it: calls about a project go to the machine that owns it. No DOM/Electron.
import type { BrandyApi } from '../../../shared/api.ts'
import type { ArchivedThreadInfo } from '../../../shared/types.ts'
import { REMOTE_TERMINAL } from '../../../shared/remote/messages.ts'
import { createMergedState } from './merged-state.ts'
import { remoteId, routeCall, splitIds } from './route.ts'
import { createVariants } from './variants.ts'

/** `onError`: failures the merged answer leaves out (an unreachable host's archived threads), for the Notice. */
export function createRoutedApi(
  local: BrandyApi, openUrl: (url: string) => void = () => {}, onError: (e: unknown) => void = () => {}
): BrandyApi {
  const state = createMergedState(local)
  const variants = createVariants(local, openUrl)

  const via = <T>(channel: string, arg: unknown, run: (a: any) => Promise<T>): Promise<T> => {
    const r = routeCall(channel, arg)
    if (r.machineId === null) return run(arg)
    return local.remote.call({ machineId: r.machineId, channel, arg: r.arg }) as Promise<T>
  }

  const isRemote = (channel: string, arg: unknown): boolean => routeCall(channel, arg).machineId !== null

  /** archive:list over several machines in parallel; an unreachable host adds nothing (reported), a local failure fails. */
  async function listArchived(ids: string[]): Promise<ArchivedThreadInfo[]> {
    const groups = [...splitIds(ids)]
    const parts = await Promise.all(groups.map(async ([machineId, list]) => {
      if (machineId === null) return local.listArchived(list as string[])
      try {
        const r = (await local.remote.call({ machineId, channel: 'archive:list', arg: list })) as ArchivedThreadInfo[]
        return r.map(a => ({ ...a, projectId: remoteId(machineId, a.projectId) }))
      } catch (e) {
        onError(e)
        return []
      }
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
    renameProject: a => via('project:rename', a, x => local.renameProject(x)),
    setProjectArchived: a => via('project:archive', a, x => local.setProjectArchived(x)),
    clearCoordinatorContext: a => via('project:clear-context', a, x => local.clearCoordinatorContext(x)),
    // the folder lives on the other machine: nothing to open here
    revealProject: a => isRemote('project:reveal', a)
      ? Promise.resolve({ ok: false, error: 'A pasta está em outra máquina.' })
      : local.revealProject(a),
    // the logs are this machine's, whatever project is open
    openLogs: () => local.openLogs(),
    send: a => via('chat:send', a, x => local.send(x)),
    saveAttachment: a => via('attach:save', a, x => local.saveAttachment(x)),
    readArtifact: a => via('artifact:read', a, x => local.readArtifact(x)),
    diffArtifact: a => via('artifact:diff', a, x => local.diffArtifact(x)),
    ...variants,
    listCommands: id => via('commands:list', id, x => local.listCommands(x)),
    listFiles: a => via('fs:list', a, x => local.listFiles(x)),
    cancelThread: a => via('thread:cancel', a, x => local.cancelThread(x)),
    approveTool: a => via('thread:approve', a, x => local.approveTool(x)),
    reportThread: a => via('thread:report', a, x => local.reportThread(x)),
    resolveThread: a => via('thread:resolve', a, x => local.resolveThread(x)),
    retireThread: a => via('thread:retire', a, x => local.retireThread(x)),
    setAllowAll: a => via('thread:allowAll', a, x => local.setAllowAll(x)),
    reopenArchived: a => via('archive:reopen', a, x => local.reopenArchived(x)),
    startProcess: a => via('process:start', a, x => local.startProcess(x)),
    stopProcess: a => via('process:stop', a, x => local.stopProcess(x)),
    removeProcess: a => via('process:remove', a, x => local.removeProcess(x)),
    term: {
      ...local.term,
      // remote terminals arrive in phase 3: without output events they would be blind
      open: a => isRemote('term:open', a) ? Promise.reject(new Error(REMOTE_TERMINAL)) : local.term.open(a),
      write: async a => { if (!isRemote('term:write', a)) await local.term.write(a) },
      resize: async a => { if (!isRemote('term:resize', a)) await local.term.resize(a) },
      kill: async id => { if (!isRemote('term:kill', id)) await local.term.kill(id) }
    }
  }
}
