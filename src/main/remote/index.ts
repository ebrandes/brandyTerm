import { app } from 'electron'
import type { Engine } from '../engine.ts'
import { registry } from '../rpc/registry.ts'
import { appSettings, DEFAULT_REMOTE } from '../settings.ts'
import { publishMdns } from './mdns.ts'
import { HostServer } from './server.ts'
import { TrustStore } from './trust.ts'
import { loadIdentity } from './identity.ts'

export interface Remote {
  trust: TrustStore
  server(): HostServer | null
  stop(): Promise<void>
}

/** Runs the LAN host server while `settings.remote.enabled`, restarting it when the port changes. */
export function startRemote(engine: Engine): Remote {
  const trust = new TrustStore(app.getPath('userData'))
  let server: HostServer | null = null
  let port = 0
  let applying: Promise<void> = Promise.resolve()
  let closed = false
  let failed: number | null = null

  const desired = (): number | null => {
    const r = { ...DEFAULT_REMOTE, ...appSettings().remote }
    return r.enabled ? r.port : null
  }

  const apply = async (): Promise<void> => {
    const want = closed ? null : desired()
    if (server && want === port) return
    if (!server && want !== null && want === failed) return // already failed on this port: retry only after a change
    if (server) {
      const old = server
      server = null
      await old.stop()
    }
    if (want !== failed) failed = null
    if (want === null) return
    const next = new HostServer({
      state: () => engine.state,
      invoke: (channel, arg, ctx) => registry.invoke(channel, arg, ctx),
      onChange: cb => {
        engine.on('change', cb)
        return () => engine.off('change', cb)
      },
      trust,
      machine: () => engine.state.machine ?? loadIdentity(),
      publish: publishMdns
    })
    try {
      await next.start(want)
      server = next
      port = want
      failed = null
    } catch (e) {
      console.error('[remote] não foi possível iniciar o servidor:', e instanceof Error ? e.message : e)
      failed = want
      await next.stop()
    }
  }

  const sync = (): void => { applying = applying.then(apply, apply) }
  engine.on('change', sync)
  sync()

  return {
    trust,
    server: () => server,
    async stop() {
      closed = true
      engine.off('change', sync)
      sync()
      await applying
    }
  }
}
