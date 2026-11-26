// Starts the connectors in main: stores, hub, login broker, call dispatcher and the gateway socket.
// No Electron here: index.ts passes the login runners and the keychain cipher. A startup failure never stops the app.
import { join } from 'node:path'
import type { Engine } from '../engine.ts'
import type { RemoteHosts } from '../remote/hosts.ts'
import type { Connector, ConnectorView, ThreadRef } from '../../shared/connectors.ts'
import { gatewaySpec, setGatewayProvider } from '../adapters/gateway-launch.ts'
import { realFactory } from './client.ts'
import { createCalls } from './calls.ts'
import { elsewhere } from './elsewhere.ts'
import { startGatewayServer, socketPath, type GwHandler } from './gateway-server.ts'
import { sweepStaleSockets } from './socket-sweep.ts'
import { ConnectorHub } from './hub.ts'
import { LoginBroker, type Runners } from './login.ts'
import { makeOAuthProvider } from './oauth-provider.ts'
import { SecretStore, type Cipher } from './secrets.ts'
import { ConnectorStore } from './store.ts'
import { repairPasted } from './pasted-fix.ts'
import { connectorView } from './view.ts'

export interface ConnectorDeps {
  store: ConnectorStore
  secrets: SecretStore
  hub: ConnectorHub
  login: LoginBroker
}

export interface Connectors {
  stop(): Promise<void>
  deps: ConnectorDeps
}

export interface BootOpts {
  engine: Engine
  userData: string
  hosts?: RemoteHosts
  runners: (secrets: SecretStore) => Runners
  cipher: Cipher
  startServer?: typeof startGatewayServer
  /** the skills_* tools (op 'skills'); absent, they are refused */
  skills?: GwHandler
  /** a /skill-* thread: its gateway lists the skills tools */
  isSkillsThread?: (t: ThreadRef) => boolean
}

export const BOOT_FAILED = 'Os conectores não puderam ser iniciados. Reinicie o BrandyTerm.'

/** Deps whose every method refuses, so the panel's channels answer with BOOT_FAILED. */
function refusing(): ConnectorDeps {
  const part = <T extends object>(): T =>
    new Proxy({} as T, { get: (_t, k) => (k === 'then' || typeof k === 'symbol' ? undefined : () => { throw new Error(BOOT_FAILED) }) })
  return { store: part(), secrets: part(), hub: part(), login: part() }
}

/** No process or connection starts here: a connector connects on its first tools or call. */
export async function bootConnectors(d: BootOpts): Promise<Connectors> {
  const detach: (() => void)[] = []
  try {
    return await boot(d, detach)
  } catch (e) {
    for (const off of detach) off()
    // fs and socket errors only: no secret reaches this message
    const msg = e instanceof Error ? e.message : String(e)
    console.error('Conectores não iniciados:', msg)
    for (const t of d.engine.state.projects.flatMap(p => p.threads)) t.logins = undefined
    // said in the panel: an empty list here would look like the connectors were gone
    d.engine.state.connectors = { list: [], logins: [], fault: `Conectores não iniciados: ${msg}` }
    return { stop: async () => {}, deps: refusing() }
  }
}

async function boot(d: BootOpts, detach: (() => void)[]): Promise<Connectors> {
  const { engine } = d
  const store = new ConnectorStore(join(d.userData, 'connectors.json'))
  const secrets = new SecretStore(join(d.userData, 'connector-secrets.json'), d.cipher)
  repairPasted(store, secrets)
  const hub = new ConnectorHub({
    factory: realFactory,
    auth: c => {
      const s = secrets.get(c.id)
      return { env: s.env ?? {}, headers: s.headers ?? {}, ...(c.auth.kind === 'oauth' ? { oauth: makeOAuthProvider(c.id, secrets, 'http://127.0.0.1/callback') } : {}) }
    },
  })
  const login = new LoginBroker({ store, secrets, hub, runners: d.runners(secrets) })

  const view = (c: Connector): ConnectorView => connectorView(c, hub, login)
  const fault = (): { fault?: string } => (store.fault ? { fault: store.fault } : {})
  const sync = (): void => {
    engine.state.connectors = { list: store.list().map(view), logins: login.panelLogins(), ...fault() }
    for (const t of engine.state.projects.flatMap(p => p.threads)) {
      const logins = login.threadLogins(t.id)
      t.logins = logins.length ? logins : undefined
    }
    engine.touch()
  }
  for (const t of engine.state.projects.flatMap(p => p.threads)) t.logins = undefined
  engine.state.connectors = { list: store.list().map(view), logins: [], ...fault() }
  for (const e of [store, hub, login]) e.on('change', sync)
  const off = (): void => { for (const e of [store, hub, login]) e.off('change', sync) }
  detach.push(off)

  const calls = createCalls({
    store, hub, login,
    approvals: engine.approvals,
    findThread: r => {
      const p = engine.state.projects.find(x => x.id === r.projectId)
      const t = p?.threads.find(x => x.id === r.threadId)
      return p && t ? { p, t } : undefined
    },
    machineName: () => engine.state.machine?.name ?? 'este computador',
    elsewhere: name => elsewhere(d.hosts, name),
    notify: (r, text) => {
      const found = engine.state.projects.find(x => x.id === r.projectId)
      const t = found?.threads.find(x => x.id === r.threadId)
      if (found) engine.fail(found, text, t)
      engine.touch()
    },
  })
  sweepStaleSockets(d.userData, process.pid)
  const handle: GwHandler = (r, req, signal) => {
    if (req.op !== 'skills') return calls(r, req, signal)
    return d.skills ? d.skills(r, req, signal) : Promise.reject(new Error('Ferramentas de skills indisponíveis.'))
  }
  const server = await (d.startServer ?? startGatewayServer)(socketPath(d.userData, process.pid), handle)
  setGatewayProvider(t => gatewaySpec(server.path, server.issue(t), d.isSkillsThread?.(t) ? { BRANDY_GATEWAY_SKILLS: '1' } : undefined))

  return {
    deps: { store, secrets, hub, login },
    async stop() {
      off()
      // synchronous part first: Electron may exit right after this returns
      hub.killAll()
      const closing = server.close()
      await closing
      await hub.closeAll()
    },
  }
}
