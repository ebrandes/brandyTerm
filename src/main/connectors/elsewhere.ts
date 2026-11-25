import type { AppState } from '../../shared/types.ts'
import type { RemoteHostInfo } from '../../shared/remote/machine.ts'

/** Name of the first online paired machine whose state lists a connector called `name` (case-insensitive). */
export function elsewhere(
  hosts: { list(): RemoteHostInfo[]; states(): { machineId: string; state: AppState }[] } | undefined,
  name: string,
): string | undefined {
  if (!hosts) return undefined
  const online = new Set(hosts.list().filter(h => h.online).map(h => h.machine.id))
  const lower = name.toLowerCase()
  for (const { machineId, state } of hosts.states()) {
    if (!online.has(machineId) || !state.machine) continue
    if (state.connectors?.list.some(c => c.name.toLowerCase() === lower)) return state.machine.name
  }
  return undefined
}
