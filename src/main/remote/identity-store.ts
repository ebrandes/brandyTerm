// The per-install identity kept in machine.json. File injected so tests need no Electron (identity.ts wires it).
// A file that cannot be written never fails startup: the identity stays in memory for the run.
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { defaultName, osOf, type MachineInfo } from '../../shared/remote/machine.ts'

const logError = (m: string): void => console.error(m)

export function identityStore(
  file: () => string, platform: string = process.platform, host: () => string = hostname, log: (m: string) => void = logError
) {
  let current: MachineInfo | undefined
  const os = osOf(platform)
  const save = (m: MachineInfo): void => {
    try {
      writeFileSync(file(), JSON.stringify(m, null, 2))
    } catch (e) {
      log(`[remote] machine.json não foi salvo: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const load = (): MachineInfo => {
    if (current) return current
    try {
      const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<MachineInfo>
      if (typeof raw.id === 'string' && raw.id && typeof raw.name === 'string' && raw.name) {
        current = { id: raw.id, name: raw.name, os }
        return current
      }
    } catch {
      // first run or unreadable file: create a new identity
    }
    current = { id: randomUUID(), name: defaultName(host(), os), os }
    save(current)
    return current
  }

  const rename = (name: string): MachineInfo => {
    const next = { ...load(), name: name.trim() || defaultName(host(), os) }
    current = next
    save(next)
    return next
  }

  return { load, rename }
}
