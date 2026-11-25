// Test rig for HostServer (used by the server*.test.ts files; not a test itself).
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { HostServer, type HostDeps } from './server.ts'
import { TrustStore } from './trust.ts'
import { wsSocket } from './ws-socket.ts'
import { Registry, type CallCtx } from '../rpc/registry.ts'
import { connectChannel, type SecureChannel } from '../../shared/remote/channel.ts'
import { newKeyPair, toB64, type KeyPair } from '../../shared/remote/crypto.ts'
import type { MachineInfo } from '../../shared/remote/machine.ts'
import { clientProof } from '../../shared/remote/pairing.ts'
import type { AppState, Project } from '../../shared/types.ts'

export const HOST: MachineInfo = { id: '33333333-3333-4333-8333-333333333333', name: 'Host', os: 'mac' }
export const ME: MachineInfo = { id: '44444444-4444-4444-8444-444444444444', name: 'Cliente', os: 'linux' }
export const proj = (id: string, over: Partial<Project> = {}) => ({ id, name: id, ...over }) as Project

export interface Env {
  host: HostServer
  trust: TrustStore
  calls: { channel: string; arg: unknown; ctx: CallCtx }[]
  bus: EventEmitter
  state: AppState
  client: KeyPair
  reg: Registry
  /** what the host reports as itself; change it to rename the machine */
  machine: MachineInfo
  connect(key?: KeyPair): Promise<SecureChannel>
  raw(): Promise<WebSocket>
}

const passGuard: HostDeps['guard'] = { before() {}, after: (_c, _a, r) => r }

/** A started host on a random port with one trusted client key; `over` replaces any dependency. */
export async function withHost(fn: (e: Env) => Promise<void>, over: Partial<HostDeps> = {}): Promise<void> {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'bt-server-'))
  const trust = new TrustStore(dir)
  const bus = new EventEmitter()
  const calls: Env['calls'] = []
  const state = {
    projects: [proj('a'), proj('b', { remoteHidden: true })], agents: [], plugins: [],
    accounts: { list: [{ id: 'x', label: 'L', kind: 'token', token: 'sk-ant-xyz' }], activeId: 'x', autoSwitch: false },
    settings: { keepAwake: true, lastSeen: { a: 'now' } }
  } as unknown as AppState
  const reg = new Registry()
  reg.add('chat:send', a => `sent:${a.projectId}`, 'pass')
  reg.add('settings:set', () => 1, 'deny')
  reg.add('term:write', () => 'wrote', 'terminal')
  reg.add('archive:list', ids => ids, 'pass')
  reg.add('fs:list', () => ['listed'], 'pass')
  reg.add('process:stop', () => 'stopped', 'pass')
  const env = { machine: { ...HOST } } as Env
  const host = new HostServer({
    state: () => state,
    invoke: (channel, arg, ctx) => { calls.push({ channel, arg, ctx }); return reg.invoke(channel, arg, ctx) },
    onChange: cb => { bus.on('change', cb); return () => bus.off('change', cb) },
    trust,
    machine: () => env.machine,
    acceptAddress: () => true,
    guard: passGuard,
    ...over
  })
  await host.start(0)
  const client = newKeyPair()
  trust.add({ pub: toB64(client.pub), role: 'client', machineId: ME.id, name: ME.name, os: ME.os })
  const raw = (): Promise<WebSocket> => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${host.port()}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
  const connect = async (key = client): Promise<SecureChannel> => {
    const ws = await raw()
    return connectChannel(wsSocket(ws), key, trust.ownKey().pub, ME)
  }
  Object.assign(env, { host, trust, calls, bus, state, client, reg, connect, raw })
  try {
    await fn(env)
  } finally {
    await host.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

export const closed = (ch: SecureChannel): Promise<string> => new Promise(r => ch.onClose(r))

export function exchange(ws: WebSocket, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once('message', d => resolve(d.toString('utf8')))
    ws.once('error', reject)
    ws.send(text)
  })
}

export function pairMsg(code: string, key: KeyPair, over: Record<string, unknown> = {}) {
  const nonceC = new Uint8Array(16).fill(3)
  return {
    nonceC,
    text: JSON.stringify({
      t: 'pair', cpub: toB64(key.pub), nonceC: toB64(nonceC), proof: clientProof(code, key.pub, nonceC),
      machineId: '55555555-5555-4555-8555-555555555555', name: 'Celular', os: 'phone', protocol: 1, ...over
    })
  }
}
