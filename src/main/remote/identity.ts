import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { defaultName, osOf, type MachineInfo } from '../../shared/remote/machine.ts'

/** Stable per-install identity, kept in userData/machine.json. */

let current: MachineInfo | undefined
const file = () => join(app.getPath('userData'), 'machine.json')
const save = (m: MachineInfo) => writeFileSync(file(), JSON.stringify(m, null, 2))

export function loadIdentity(): MachineInfo {
  if (current) return current
  const os = osOf(process.platform)
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<MachineInfo>
    if (typeof raw.id === 'string' && raw.id && typeof raw.name === 'string' && raw.name) {
      current = { id: raw.id, name: raw.name, os }
      return current
    }
  } catch {
    // first run or unreadable file: create a new identity
  }
  current = { id: randomUUID(), name: defaultName(hostname(), os), os }
  save(current)
  return current
}

export function renameMachine(name: string): MachineInfo {
  const next = { ...loadIdentity(), name: name.trim() || defaultName(hostname(), osOf(process.platform)) }
  current = next
  save(next)
  return next
}
