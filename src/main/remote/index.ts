import { app } from 'electron'
import type { Engine } from '../engine.ts'
import { registry } from '../rpc/registry.ts'
import { appSettings } from '../settings.ts'
import { DEFAULT_REMOTE } from './remote-settings.ts'
import { publishMdns } from './mdns.ts'
import { HostServer } from './server.ts'
import { TrustStore } from './trust.ts'
import { loadIdentity } from './identity.ts'
import { readGuard } from './read-guard.ts'
import { attachmentsRoot } from '../attachments.ts'
import type { RemoteStatus } from '../../shared/remote/status.ts'
import { hostRunner } from './runner.ts'

export interface Remote {
  trust: TrustStore
  server(): HostServer | null
  /** running, off, or the port that could not be opened */
  status(): RemoteStatus
  stop(): Promise<void>
}

/** Runs the LAN host server while `settings.remote.enabled`, restarting it when the port changes. */
export function startRemote(engine: Engine): Remote {
  const trust = new TrustStore(app.getPath('userData'))
  const guard = readGuard({ userData: () => app.getPath('userData'), attachmentsRoot })
  const runner = hostRunner({
    desired: () => {
      const r = { ...DEFAULT_REMOTE, ...appSettings().remote }
      return r.enabled ? r.port : null
    },
    make: () => new HostServer({
      state: () => engine.state,
      invoke: (channel, arg, ctx) => registry.invoke(channel, arg, ctx),
      onChange: cb => {
        engine.on('change', cb)
        return () => engine.off('change', cb)
      },
      trust,
      machine: () => engine.state.machine ?? loadIdentity(),
      publish: publishMdns,
      guard
    })
  })
  const sync = (): void => void runner.sync()
  engine.on('change', sync)
  sync()

  return {
    trust,
    server: runner.server,
    status: runner.status,
    async stop() {
      engine.off('change', sync)
      await runner.stop()
    }
  }
}
