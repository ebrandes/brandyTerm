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
  const emit = (): void => {
    if (!localState) return
    const s = merged()
    for (const cb of subs) cb(s)
  }

  local.onState(s => { localState = s; emit() })
  local.remote.onState(e => { remote.set(e.machineId, e.state); emit() })
  local.remote.onHosts(h => { hosts = h; emit() })
  void local.remote.hosts().then(h => { hosts = h; emit() }, () => {})

  return {
    async get() {
      const [s, h] = await Promise.all([local.getState(), local.remote.hosts().catch(() => hosts)])
      localState = s
      hosts = h
      return merged()
    },
    subscribe(cb) {
      subs.add(cb)
      return () => { subs.delete(cb) }
    }
  }
}
