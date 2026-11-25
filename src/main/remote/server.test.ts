import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { WebSocket } from 'ws'
import { HostServer } from './server.ts'
import { TrustStore } from './trust.ts'
import { wsSocket } from './ws-socket.ts'
import { Registry, type CallCtx } from '../rpc/registry.ts'
import { connectChannel, type SecureChannel } from '../../shared/remote/channel.ts'
import { fromB64, newKeyPair, toB64, type KeyPair } from '../../shared/remote/crypto.ts'
import type { MachineInfo } from '../../shared/remote/machine.ts'
import { clientProof, verifyHostProof } from '../../shared/remote/pairing.ts'
import { parsePaired, parsePairFail } from '../../shared/remote/pair-wire.ts'
import type { AppState, Project } from '../../shared/types.ts'

const HOST: MachineInfo = { id: 'host-1', name: 'Host', os: 'mac' }
const ME: MachineInfo = { id: 'cli-1', name: 'Cliente', os: 'linux' }
const proj = (id: string, over: Partial<Project> = {}) => ({ id, name: id, ...over }) as Project

interface Env {
  host: HostServer
  trust: TrustStore
  calls: { channel: string; arg: unknown; ctx: CallCtx }[]
  bus: EventEmitter
  state: AppState
  client: KeyPair
  connect(key?: KeyPair): Promise<SecureChannel>
  raw(): Promise<WebSocket>
}

async function withHost(fn: (e: Env) => Promise<void>): Promise<void> {
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
  reg.add('fs:list', a => ['listed'], 'pass')
  reg.add('process:stop', () => 'stopped', 'pass')
  const host = new HostServer({
    state: () => state,
    invoke: (channel, arg, ctx) => { calls.push({ channel, arg, ctx }); return reg.invoke(channel, arg, ctx) },
    onChange: cb => { bus.on('change', cb); return () => bus.off('change', cb) },
    trust,
    machine: () => HOST,
    acceptAddress: () => true
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
  try {
    await fn({ host, trust, calls, bus, state, client, connect, raw })
  } finally {
    await host.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const closed = (ch: SecureChannel): Promise<string> => new Promise(r => ch.onClose(r))

test('state:get is filtered; hidden project and denied channel are refused', () => withHost(async e => {
  const ch = await e.connect()
  const s = await ch.request('state:get', undefined) as AppState
  assert.deepEqual(s.projects.map(p => p.id), ['a'])
  assert.ok(!JSON.stringify(s).includes('sk-ant-xyz'))
  assert.equal(s.settings?.lastSeen, undefined)
  assert.equal(await ch.request('chat:send', { projectId: 'a' }), 'sent:a')
  await assert.rejects(ch.request('chat:send', { projectId: 'b' }), /^Error: Projeto não disponível remotamente$/)
  await assert.rejects(ch.request('chat:send', { projectId: 'zzz' }), /^Error: Projeto não disponível remotamente$/)
  await assert.rejects(ch.request('settings:set', {}), /^Error: Não permitido remotamente: settings:set$/)
  ch.close()
}))

test('fs:list is confined to the project for remote callers', () => withHost(async e => {
  const ch = await e.connect()
  assert.deepEqual(await ch.request('fs:list', { projectId: 'a', query: 'src' }), ['listed'])
  for (const query of ['/', '~/', '../x']) {
    await assert.rejects(ch.request('fs:list', { projectId: 'a', query }), /^Error: Fora do projeto$/)
  }
  assert.equal(e.calls.filter(c => c.channel === 'fs:list').length, 1)
  ch.close()
}))

test('archive:list only sees visible projects', () => withHost(async e => {
  const ch = await e.connect()
  assert.deepEqual(await ch.request('archive:list', ['a', 'b', 'q', 7]), ['a'])
  assert.deepEqual(await ch.request('archive:list', 'a'), [])
  ch.close()
}))

test('terminal permission is read per request and keyed on the verified key', () => withHost(async e => {
  const ch = await e.connect()
  await assert.rejects(ch.request('term:write', { id: 'a', data: 'x' }), /Terminal remoto não liberado/)
  e.trust.setTerminal(toB64(e.client.pub), true)
  assert.equal(await ch.request('term:write', { id: 'a', data: 'x' }), 'wrote')
  assert.equal(e.calls.at(-1)?.ctx.remote?.deviceId, toB64(e.client.pub))
  ch.close()
}))

test('revoking closes the channel and a reconnect is refused', () => withHost(async e => {
  const ch = await e.connect()
  await ch.request('state:get', undefined)
  const done = closed(ch)
  e.trust.revoke(toB64(e.client.pub))
  await done
  await assert.rejects(ch.request('state:get', undefined), /desconectada/)
  await assert.rejects(e.connect())
}))

test('an untrusted key is refused at accept', () => withHost(async e => {
  await assert.rejects(e.connect(newKeyPair()))
  assert.equal(e.host.clients().length, 0)
}))

test('state is pushed to connected clients, debounced', () => withHost(async e => {
  const ch = await e.connect()
  const pushes: unknown[] = []
  ch.onPush((topic, payload) => { if (topic === 'state') pushes.push(payload) })
  await ch.request('state:get', undefined)
  e.bus.emit('change'); e.bus.emit('change'); e.bus.emit('change')
  await new Promise(r => setTimeout(r, 300))
  assert.equal(pushes.length, 1)
  assert.deepEqual((pushes[0] as AppState).projects.map(p => p.id), ['a'])
  ch.close()
}))

test('clients() lists connections and touch records lastSeen', () => withHost(async e => {
  const ch = await e.connect()
  await ch.request('state:get', undefined)
  assert.deepEqual(e.host.clients().map(c => c.pub), [toB64(e.client.pub)])
  assert.ok(e.trust.get(toB64(e.client.pub), 'client')?.lastSeen)
  ch.close()
}))

function exchange(ws: WebSocket, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once('message', d => resolve(d.toString('utf8')))
    ws.once('error', reject)
    ws.send(text)
  })
}

function pairMsg(code: string, key: KeyPair, over: Record<string, unknown> = {}) {
  const nonceC = new Uint8Array(16).fill(3)
  return {
    nonceC,
    text: JSON.stringify({
      t: 'pair', cpub: toB64(key.pub), nonceC: toB64(nonceC), proof: clientProof(code, key.pub, nonceC),
      machineId: 'phone-1', name: 'Celular', os: 'phone', protocol: 1, ...over
    })
  }
}

test('pairing round trip: right code pairs, host proof verifies, then the key is trusted', () => withHost(async e => {
  const code = e.host.openPairing()
  const key = newKeyPair()
  const { nonceC, text } = pairMsg(code, key)
  const ws = await e.raw()
  const reply = parsePaired(await exchange(ws, text))
  assert.ok(reply)
  assert.ok(verifyHostProof(code, fromB64(reply.hpub), key.pub, fromB64(reply.nonceH), nonceC, reply.proof))
  assert.equal(reply.hpub, toB64(e.trust.ownKey().pub))
  assert.equal(e.trust.get(toB64(key.pub), 'client')?.name, 'Celular')
  assert.equal(e.trust.get(toB64(key.pub), 'client')?.terminal, false)
  await new Promise(r => ws.once('close', r)) // single-use socket
  const ch = await e.connect(key)
  assert.ok(await ch.request('state:get', undefined))
  ch.close()
}))

test('wrong code three times closes pairing, even for the right code', () => withHost(async e => {
  const code = e.host.openPairing()
  const key = newKeyPair()
  for (let i = 0; i < 3; i++) {
    const ws = await e.raw()
    const r = parsePairFail(await exchange(ws, pairMsg('0000-0000-0000-0000', key).text))
    assert.equal(r?.reason, 'código inválido')
  }
  const ws = await e.raw()
  const r = parsePairFail(await exchange(ws, pairMsg(code, key).text))
  assert.equal(r?.reason, 'pareamento fechado')
  assert.equal(e.trust.get(toB64(key.pub), 'client'), undefined)
}))

test('pairing refused when the window was never opened', () => withHost(async e => {
  const ws = await e.raw()
  const r = parsePairFail(await exchange(ws, pairMsg('0000-0000-0000-0000', newKeyPair()).text))
  assert.equal(r?.reason, 'pareamento fechado')
}))

test('malformed pair counts as a bad attempt: it plus two wrong codes closes pairing', () => withHost(async e => {
  const code = e.host.openPairing()
  const key = newKeyPair()
  let ws = await e.raw()
  assert.equal(parsePairFail(await exchange(ws, JSON.stringify({ t: 'pair', cpub: 'x' })))?.reason, 'código inválido')
  for (let i = 0; i < 2; i++) {
    ws = await e.raw()
    assert.equal(parsePairFail(await exchange(ws, pairMsg('0000-0000-0000-0000', key).text))?.reason, 'código inválido')
  }
  ws = await e.raw()
  assert.equal(parsePairFail(await exchange(ws, pairMsg(code, key).text))?.reason, 'pareamento fechado')
  assert.equal(e.trust.get(toB64(key.pub), 'client'), undefined)
}))

test('wrong protocol is reported and does not use up an attempt', () => withHost(async e => {
  const code = e.host.openPairing()
  const key = newKeyPair()
  for (let i = 0; i < 4; i++) {
    const ws = await e.raw()
    assert.equal(parsePairFail(await exchange(ws, pairMsg(code, key, { protocol: 99 }).text))?.reason, 'versão diferente')
  }
  const ws = await e.raw()
  assert.ok(parsePaired(await exchange(ws, pairMsg(code, key).text)))
}))

test('a pairing socket is closed after the reply and ignores further messages', () => withHost(async e => {
  const ws = await e.raw()
  const reply = exchange(ws, JSON.stringify({ t: 'pair', cpub: 'x' }))
  for (let i = 0; i < 50; i++) ws.send('spam')
  await reply
  await new Promise(r => ws.once('close', r))
}))

test('hiding a project mid-session blocks it and drops it from the next push', () => withHost(async e => {
  const ch = await e.connect()
  const pushes: AppState[] = []
  ch.onPush((t, p) => { if (t === 'state') pushes.push(p as AppState) })
  assert.equal(await ch.request('chat:send', { projectId: 'a' }), 'sent:a')
  e.state.projects[0].remoteHidden = true
  await assert.rejects(ch.request('chat:send', { projectId: 'a' }), /^Error: Projeto não disponível remotamente$/)
  await assert.rejects(ch.request('chat:send', { projectId: ['a'] }), /^Error: Projeto não disponível remotamente$/)
  e.bus.emit('change')
  await new Promise(r => setTimeout(r, 300))
  assert.equal(pushes.length, 1)
  assert.deepEqual(pushes[0].projects, [])
  ch.close()
}))

test('revoking during the handshake leaves no live channel', () => withHost(async e => {
  const orig = e.trust.get.bind(e.trust)
  let n = 0
  e.trust.get = (pub, role) => {
    const r = orig(pub, role)
    if (++n === 1) e.trust.revoke(pub) // the accept callback: revoked right after it said yes
    return r
  }
  const ch = await e.connect().catch(() => null)
  if (ch) await closed(ch)
  assert.equal(e.host.clients().length, 0)
}))

test('stop closes channels and sockets', () => withHost(async e => {
  const ch = await e.connect()
  await ch.request('state:get', undefined)
  const done = closed(ch)
  const ws = await e.raw()
  const wsClosed = new Promise(r => ws.once('close', r))
  await e.host.stop()
  await done
  await wsClosed
}))
