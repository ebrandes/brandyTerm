import { useEffect, useState } from 'react'
import type { RemoteConnectorView } from '../../../shared/connectors.ts'
import type { MachineInfo, RemoteHostInfo } from '../../../shared/remote/machine.ts'
import type { AppState } from '../types'
import { api } from '../api'
import { report } from '../notice'

export interface HostConnectors { machine: MachineInfo; list: RemoteConnectorView[] }

/**
 * What each online paired machine reports as installed. Read from the hosts' own states, not the merged state,
 * which keeps only their projects. A failed read is reported.
 */
export function useHostConnectors(hosts: RemoteHostInfo[]): HostConnectors[] {
  const [states, setStates] = useState<Record<string, AppState>>({})
  useEffect(() => {
    let alive = true
    void api.remote.states().then((all) => {
      if (alive) setStates((s) => ({ ...Object.fromEntries(all.map((e) => [e.machineId, e.state])), ...s }))
    }).catch(report)
    const off = api.remote.onState((e) => setStates((s) => ({ ...s, [e.machineId]: e.state })))
    return () => {
      alive = false
      off()
    }
  }, [])
  return hosts
    .filter((h) => h.online && states[h.machine.id]?.connectors)
    .map((h) => ({ machine: h.machine, list: states[h.machine.id].connectors?.list ?? [] }))
}
