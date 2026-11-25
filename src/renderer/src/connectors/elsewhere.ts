// Connectors that paired machines have and this one lacks. Pure.
import type { ConnectorView } from '../../../shared/connectors.ts'
import type { MachineInfo } from '../../../shared/remote/machine.ts'

export interface ElsewhereEntry { name: string; preset?: string; machines: string[] }

export function onlyElsewhere(
  local: Pick<ConnectorView, 'name'>[],
  hosts: { machine: MachineInfo; list: { name: string; preset?: string }[] }[],
): ElsewhereEntry[] {
  const mine = new Set(local.map(c => c.name.toLowerCase()))
  const out = new Map<string, ElsewhereEntry>()
  for (const { machine, list } of hosts) {
    for (const c of list) {
      const key = c.name.toLowerCase()
      if (mine.has(key)) continue
      const e = out.get(key) ?? { name: c.name, ...(c.preset ? { preset: c.preset } : {}), machines: [] }
      if (!e.preset && c.preset) e.preset = c.preset
      if (!e.machines.includes(machine.name)) e.machines.push(machine.name)
      out.set(key, e)
    }
  }
  return [...out.values()]
}
