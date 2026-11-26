// Starts the connectors with Electron's pieces: the login runners (pty, browser) and the keychain cipher.
import type { WebContents } from 'electron'
import type { Engine } from '../engine.ts'
import type { RemoteHosts } from '../remote/hosts.ts'
import { bootConnectors, type BootOpts, type Connectors } from './boot.ts'
import { makeRunners } from './connector-runners.ts'
import { safeCipher } from './safe-cipher.ts'

export type { ConnectorDeps } from './boot.ts'

/** Never throws: if startup fails, the app opens with no connectors and the panel's channels refuse. */
export function startConnectors(d: Pick<BootOpts, 'app' | 'skills' | 'isSkillsThread'> & {
  engine: Engine
  userData: string
  hosts?: RemoteHosts
  getWin: () => WebContents | undefined
}): Promise<Connectors> {
  return bootConnectors({ ...d, cipher: safeCipher, runners: secrets => makeRunners({ getWin: d.getWin, secrets }) })
}
