// The renderer's one project list: this machine's projects plus those of paired machines. Pure.
import type { AppState, Project } from '../../../shared/types.ts'
import type { MachineInfo, RemoteHostInfo } from '../../../shared/remote/machine.ts'
import { remoteId } from './route.ts'

export type RemoteEntry = { info: RemoteHostInfo; state?: AppState }

const THIS: MachineInfo = { id: 'local', name: 'Este computador', os: 'linux' }

/** Local projects first, then each host in order; hosts without a state yet add nothing. Everything but projects is local. */
export function mergeStates(local: AppState, remotes: RemoteEntry[]): AppState {
  const me = local.machine ?? THIS
  const projects: Project[] = local.projects.map(p => ({ ...p, machine: { ...me, remote: false, online: true } }))
  for (const { info, state } of remotes) {
    if (!state) continue
    const machine = { ...info.machine, remote: true, online: info.online, ...(info.since ? { since: info.since } : {}) }
    for (const p of state.projects) projects.push({ ...p, id: remoteId(info.machine.id, p.id), machine })
  }
  return { ...local, projects }
}
