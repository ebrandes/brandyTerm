// Keeps the merged state current: recomputed on local state, remote 'state' and 'hosts' events. No DOM/Electron.
import type { BrandyApi } from '../../../shared/api.ts'
import type { AppState } from '../../../shared/types.ts'
import type { RemoteHostInfo } from '../../../shared/remote/machine.ts'
import { mergeStates } from './merge.ts'

export interface MergedState {
  get(): Promise<AppState>
  subscribe(cb: (s: AppState) => void): () => void
}

export function createMergedState(local: BrandyApi): MergedState {
  let localState: AppState | null = null
  let hosts: RemoteHostInfo[] = []
  const remote = new Map<string, AppState>()
  const subs = new Set<(s: AppState) => void>()

  const merged = (): AppState =>
    mergeStates(localState as AppState, hosts.map(info => ({ info, state: remote.get(info.machine.id) })))
  const setHosts = (h: RemoteHostInfo[]): void => {
    hosts = h
    const ids = new Set(h.map(x => x.machine.id))
    for (const id of [...remote.keys()]) if (!ids.has(id)) remote.delete(id) // unpaired
  }
  let version = 0 // bumped by every local state event, so an older snapshot never overwrites it
  const emit = (): void => {
    if (!localState) return
    const s = merged()
    for (const cb of subs) cb(s)
  }

  /** hosts and the states main already holds: a fresh renderer (or a host that has not pushed yet) still sees them */
  async function seedRemote(): Promise<void> {
    const [h, states] = await Promise.all([
      local.remote.hosts().catch(() => hosts),
      local.remote.states().catch(() => [])
    ])
    setHosts(h)
    for (const e of states) if (!remote.has(e.machineId)) remote.set(e.machineId, e.state) // a push that arrived meanwhile is newer
  }

  local.onState(s => { version++; localState = s; emit() })
  local.remote.onState(e => { remote.set(e.machineId, e.state); emit() })
  local.remote.onHosts(h => { setHosts(h); emit() })
  void seedRemote().then(emit)

  return {
    async get() {
      const seen = version
      const [s] = await Promise.all([local.getState(), seedRemote()])
      if (version === seen) localState = s // an onState that arrived meanwhile is newer
      return localState ? merged() : s
    },
    subscribe(cb) {
      subs.add(cb)
      return () => { subs.delete(cb) }
    }
  }
}
