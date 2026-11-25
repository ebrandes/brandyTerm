// Renderer IPC for the multi-machine feature (host and client side). Every channel is `deny` for remotes.
import { app, shell, type BrowserWindow } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { MAX_ATTACHMENT } from '../attachment-scope.ts'
import type { Engine } from '../engine.ts'
import { registry } from '../rpc/registry.ts'
import { ruleOf } from '../rpc/channels.ts'
import { browseMdns } from './browse.ts'
import { deviceCalls } from './device-calls.ts'
import { RemoteHosts } from './hosts.ts'
import { loadIdentity, renameMachine } from './identity.ts'
import type { Remote } from './index.ts'
import { openDecision, targetPath } from './open-policy.ts'
import { dialWs } from './ws-dial.ts'

export interface ClientIpcDeps {
  engine: Engine
  remote: Remote
  getWin: () => BrowserWindow | null
}

/** Dials the paired hosts (none until the first pairing) and registers the `remote:*` channels. Call before bindIpc. */
export function startClient({ engine, remote, getWin }: ClientIpcDeps): RemoteHosts {
  const trust = remote.trust
  const hosts = new RemoteHosts({
    trust,
    own: () => trust.ownKey(), // created on the first pairing, not at startup
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
  add('remote:states', () => hosts.states())
  add('remote:call', (a: { machineId: string; channel: string; arg: unknown }) =>
    hosts.call(String(a.machineId), String(a.channel), a.arg))
  add('remote:open-bytes', async (a: { machineId: string; name: string; data: Uint8Array }) => {
    const id = String(a.machineId)
    if (!hosts.list().some(h => h.machine.id === id)) throw new Error('Máquina desconhecida')
    if (!(a.data instanceof Uint8Array)) throw new Error('Arquivo inválido')
    if (a.data.byteLength > MAX_ATTACHMENT) throw new Error('Arquivo grande demais')
    // per-user folder (not the shared tmp); a planted file or link is removed, never followed
    const file = targetPath(join(app.getPath('userData'), 'remote-open'), id, a.name)
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    rmSync(file, { force: true })
    writeFileSync(file, a.data, { mode: 0o600, flag: 'wx' })
    if (openDecision(file) === 'open') {
      const err = await shell.openPath(file)
      if (err) throw new Error(err)
    } else shell.showItemInFolder(file)
  })
  add('remote:open-pairing', () => {
    const server = remote.server()
    if (!server) throw new Error('Acesso remoto desligado')
    return server.openPairing()
  })
  add('remote:close-pairing', () => { remote.server()?.closePairing() })
  const devices = deviceCalls(trust)
  add('remote:devices', () => devices.devices())
  add('remote:revoke', (a: unknown) => devices.revoke(a))
  add('remote:set-terminal', (a: { pub: string; on: boolean }) => trust.setTerminal(String(a.pub), !!a.on))
  add('remote:discovered', () => hosts.discovered())
  add('remote:discover', (on: boolean) => hosts.discover(!!on))
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
