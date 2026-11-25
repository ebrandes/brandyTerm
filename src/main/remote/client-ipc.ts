// Renderer IPC for the multi-machine feature (host and client side). Every channel is `deny` for remotes.
import { app, type BrowserWindow } from 'electron'
import type { Engine } from '../engine.ts'
import { registry } from '../rpc/registry.ts'
import { ruleOf } from '../rpc/channels.ts'
import { browseMdns } from './browse.ts'
import { RemoteHosts } from './hosts.ts'
import { loadIdentity, renameMachine } from './identity.ts'
import type { Remote } from './index.ts'
import { dialWs } from './ws-dial.ts'

export interface ClientIpcDeps {
  engine: Engine
  remote: Remote
  getWin: () => BrowserWindow | null
}

/** Connects to the paired hosts and registers the `remote:*` channels. Call before bindIpc. */
export function startClient({ engine, remote, getWin }: ClientIpcDeps): RemoteHosts {
  const trust = remote.trust
  const hosts = new RemoteHosts({
    trust,
    own: trust.ownKey(),
    me: () => engine.state.machine ?? loadIdentity(),
    dial: dialWs,
    dir: app.getPath('userData'),
    browse: browseMdns
  })
  const toWin = (channel: string, payload: unknown): void => {
    const win = getWin()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  hosts.on('hosts', list => toWin('remote:hosts', list))
  hosts.on('state', e => toWin('remote:state', e))

  const add = (ch: Parameters<typeof ruleOf>[0], fn: Parameters<typeof registry.add>[1]): void =>
    registry.add(ch, fn, ruleOf(ch))
  add('remote:hosts', () => hosts.list())
  add('remote:call', (a: { machineId: string; channel: string; arg: unknown }) =>
    hosts.call(String(a.machineId), String(a.channel), a.arg))
  add('remote:open-pairing', () => {
    const server = remote.server()
    if (!server) throw new Error('Acesso remoto desligado')
    return server.openPairing()
  })
  add('remote:close-pairing', () => { remote.server()?.closePairing() })
  add('remote:devices', () => trust.list())
  add('remote:revoke', (pub: string) => trust.revoke(String(pub)))
  add('remote:set-terminal', (a: { pub: string; on: boolean }) => trust.setTerminal(String(a.pub), !!a.on))
  add('remote:discovered', () => hosts.discovered())
  add('remote:pair', (a: { address: string; code: string }) => hosts.pair(String(a.address), String(a.code)))
  add('remote:rename', (name: string) => {
    const m = renameMachine(String(name ?? ''))
    engine.state.machine = m
    engine.emit('change')
    return m
  })

  hosts.start()
  return hosts
}
