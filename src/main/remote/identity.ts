import { join } from 'node:path'
import { app } from 'electron'
import type { MachineInfo } from '../../shared/remote/machine.ts'
import { identityStore } from './identity-store.ts'

/** Stable per-install identity, kept in userData/machine.json (identity-store.ts). */
const store = identityStore(() => join(app.getPath('userData'), 'machine.json'))

export const loadIdentity = (): MachineInfo => store.load()

export const renameMachine = (name: string): MachineInfo => store.rename(name)
