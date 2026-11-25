// Starts the connectors in main: stores, hub, login broker, call dispatcher and the gateway socket.
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { Engine } from '../engine.ts'
import type { RemoteHosts } from '../remote/hosts.ts'
import type { Connector, ConnectorView } from '../../shared/connectors.ts'
import { gatewaySpec, setGatewayProvider } from '../adapters/gateway-launch.ts'
import { realFactory } from './client.ts'
import { createCalls } from './calls.ts'
import { elsewhere } from './elsewhere.ts'
import { startGatewayServer, socketPath } from './gateway-server.ts'
import { sweepStaleSockets } from './socket-sweep.ts'
import { ConnectorHub } from './hub.ts'
import { LoginBroker } from './login.ts'
import { makeOAuthProvider } from './oauth-provider.ts'
import { makeRunners } from './connector-runners.ts'
import { safeCipher } from './safe-cipher.ts'
import { SecretStore } from './secrets.ts'
import { ConnectorStore } from './store.ts'

export interface ConnectorDeps {
  store: ConnectorStore
  secrets: SecretStore
  hub: ConnectorHub
  login: LoginBroker
}

/** No process or connection starts here: a connector connects on its first tools or call. */
export async function startConnectors(d: {
  engine: Engine
  userData: string
  hosts?: RemoteHosts
  getWin: () => WebContents | undefined
}): Promise<{ stop(): Promise<void>; deps: ConnectorDeps }> {
  const { engine } = d
  const store = new ConnectorStore(join(d.userData, 'connectors.json'))
  const secrets = new SecretStore(join(d.userData, 'connector-secrets.json'), safeCipher)
  const hub = new ConnectorHub({
    factory: realFactory,
    auth: c => {
      const s = secrets.get(c.id)
      return { env: s.env ?? {}, headers: s.headers ?? {}, ...(c.auth.kind === 'oauth' ? { oauth: makeOAuthProvider(c.id, secrets, 'http://127.0.0.1/callback') } : {}) }
    },
  })
  const login = new LoginBroker({ store, secrets, hub, runners: makeRunners({ getWin: d.getWin, secrets }) })

  const view = (c: Connector): ConnectorView => {
    const { auth, ...rest } = c
    return { ...rest, authKind: auth.kind, ...hub.status(c.id) }
  }
  const sync = (): void => {
    engine.state.connectors = { list: store.list().map(view), logins: login.panelLogins() }
    for (const t of engine.state.projects.flatMap(p => p.threads)) {
      const logins = login.threadLogins(t.id)
      t.logins = logins.length ? logins : undefined
    }
    engine.touch()
  }
  for (const t of engine.state.projects.flatMap(p => p.threads)) t.logins = undefined
  engine.state.connectors = { list: store.list().map(view), logins: [] }
  for (const e of [store, hub, login]) e.on('change', sync)

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
  const server = await startGatewayServer(socketPath(d.userData, process.pid), calls)
  setGatewayProvider(t => gatewaySpec(server.path, server.issue(t)))

  return {
    deps: { store, secrets, hub, login },
    async stop() {
      for (const e of [store, hub, login]) e.off('change', sync)
      // synchronous part first: Electron may exit right after this returns
      hub.killAll()
      const closing = server.close()
      await closing
      await hub.closeAll()
    },
  }
}
