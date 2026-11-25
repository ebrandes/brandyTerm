import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { newKeyPair, toB64 } from '../../shared/remote/crypto.ts'
import type { DiscoveredHost, MachineInfo, RemoteHostInfo } from '../../shared/remote/machine.ts'
import type { AppState } from '../../shared/types.ts'
import type { Browse } from './browse.ts'
import { FakeHost } from './fake-host.ts'
import { RemoteHosts } from './hosts.ts'
import { TrustStore } from './trust.ts'

const dirs: string[] = []
const cleanups: (() => void)[] = []
const tmp = (): string => { const d = fs.mkdtempSync(join(os.tmpdir(), 'hosts-')); dirs.push(d); return d }
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const me: MachineInfo = { id: 'me', name: 'Eu', os: 'mac' }
const hostInfo: MachineInfo = { id: 'h1', name: 'Servidor', os: 'linux' }

class Timers {
  items: { id: number; fn: () => void; ms: number }[] = []
  private n = 0
  setTimeout = (fn: () => void, ms: number): number => { this.items.push({ id: ++this.n, fn, ms }); return this.n }
  clearTimeout = (h: unknown): void => { this.items = this.items.filter(t => t.id !== h) }
  fire(): void { this.items.shift()!.fn() }
}

async function until(cond: () => boolean, what = 'condição'): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (cond()) return
    await new Promise(r => setImmediate(r))
  }
  assert.fail(`timeout: ${what}`)
}

interface Rig { hosts: RemoteHosts; host: FakeHost; trust: TrustStore; hostTrust: TrustStore; timers: Timers; dir: string }

function rig(opts: { trusted?: boolean; staleHost?: boolean; claim?: string; browse?: Browse } = {}): Rig {
  const dir = tmp()
  const trust = new TrustStore(dir)
  const hostTrust = new TrustStore(tmp())
  const host = new FakeHost(hostTrust, { ...hostInfo, id: opts.claim ?? hostInfo.id })
  if (opts.trusted !== false) {
    trust.add({ pub: toB64(hostTrust.ownKey().pub), role: 'host', machineId: 'h1', name: 'Servidor', os: 'linux' })
    hostTrust.add({ pub: toB64(trust.ownKey().pub), role: 'client', machineId: 'me', name: 'Eu', os: 'mac' })
    fs.writeFileSync(join(dir, 'remote-hosts.json'), JSON.stringify({ h1: '10.0.0.5:7000' }))
  }
  if (opts.staleHost) {
    trust.add({ pub: toB64(newKeyPair().pub), role: 'host', machineId: 'h1', name: 'Servidor', os: 'linux' })
    fs.writeFileSync(join(dir, 'remote-hosts.json'), JSON.stringify({ h1: '10.0.0.5:7000' }))
  }
  const timers = new Timers()
  const hosts = new RemoteHosts({
    trust, own: trust.ownKey(), me, dial: host.dial, dir, browse: opts.browse,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout
  })
  cleanups.push(() => hosts.stop())
  return { hosts, host, trust, hostTrust, timers, dir }
}

const online = (h: RemoteHosts): boolean => h.list()[0]?.online === true

test('a trusted host with an address comes online; its state push is re-emitted with its machineId', async () => {
  const { hosts, host } = rig()
  const states: { machineId: string; state: AppState }[] = []
  hosts.on('state', e => states.push(e))
  hosts.start()
  await until(() => online(hosts) && host.channels.length === 1, 'online')
  assert.deepEqual(hosts.list()[0].machine, { id: 'h1', name: 'Servidor', os: 'linux' })
  host.channels[0].push('state', { projects: [] })
  await until(() => states.length === 1, 'state')
  assert.equal(states[0].machineId, 'h1')
  assert.deepEqual(states[0].state, { projects: [] } as unknown as AppState)
})

test('call forwards to the host and resolves its value', async () => {
  const { hosts } = rig()
  hosts.start()
  await until(() => online(hosts))
  assert.deepEqual(await hosts.call('h1', 'chat:send', { a: 1 }), { channel: 'chat:send', arg: { a: 1 } })
  await assert.rejects(hosts.call('nope', 'x', 1), /desconhecida/)
})

test('host closes: offline with since, pending call rejects, new call says offline, retry after 1 s', async () => {
  const { hosts, host, timers } = rig()
  hosts.start()
  await until(() => online(hosts) && host.channels.length === 1)
  const pending = hosts.call('h1', 'hang', 1)
  const rejected = assert.rejects(pending, /Máquina desconectada/)
  host.channels[0].close()
  await rejected
  await until(() => !online(hosts))
  const info = hosts.list()[0]
  assert.ok(info.since && !Number.isNaN(Date.parse(info.since)))
  await assert.rejects(hosts.call('h1', 'x', 1), /Servidor está offline/)
  assert.equal(timers.items[0].ms, 1000)
  timers.fire()
  await until(() => online(hosts), 'back online')
  assert.equal(timers.items.length, 0)
})

test('reconnect delays follow 1, 2, 4, 8, 16, 30, 30 s', async () => {
  const { hosts, host, timers } = rig()
  host.down = true
  hosts.start()
  const seen: number[] = []
  for (let i = 0; i < 7; i++) {
    await until(() => timers.items.length === 1, `timer ${i}`)
    seen.push(timers.items[0].ms)
    timers.fire()
  }
  assert.deepEqual(seen, [1000, 2000, 4000, 8000, 16000, 30000, 30000])
})

test('a host that claims another machine id is refused with identidade não confere', async () => {
  const { hosts, host } = rig({ claim: 'impostor' })
  hosts.start()
  await until(() => hosts.list()[0]?.error === 'identidade não confere', 'error')
  assert.equal(hosts.list()[0].online, false)
  await until(() => host.channels[0] !== undefined)
  await assert.rejects(hosts.call('h1', 'x', 1), /offline/)
})

test('revoking a host closes its channel, stops reconnecting and drops it from the list', async () => {
  const { hosts, host, trust, timers, dir } = rig()
  hosts.start()
  await until(() => online(hosts) && host.channels.length === 1)
  let hostSawClose = false
  host.channels[0].onClose(() => { hostSawClose = true })
  trust.revoke(trust.list()[0].pub)
  assert.deepEqual(hosts.list(), [])
  await until(() => hostSawClose, 'host sees the close')
  assert.equal(timers.items.length, 0)
  assert.deepEqual(JSON.parse(fs.readFileSync(join(dir, 'remote-hosts.json'), 'utf8')), {})
  await assert.rejects(hosts.call('h1', 'x', 1), /desconhecida/)
})

test('stop clears timers and closes channels', async () => {
  const a = rig()
  a.hosts.start()
  await until(() => online(a.hosts) && a.host.channels.length === 1)
  let hostSawClose = false
  a.host.channels[0].onClose(() => { hostSawClose = true })
  a.hosts.stop()
  await until(() => hostSawClose, 'channel closed')
  assert.equal(a.timers.items.length, 0)

  const b = rig()
  b.host.down = true
  b.hosts.start()
  await until(() => b.timers.items.length === 1)
  b.hosts.stop()
  assert.equal(b.timers.items.length, 0)
})

test('pair: right code trusts the host, remembers the address and connects', async () => {
  const { hosts, host, trust, dir } = rig({ trusted: false })
  hosts.start()
  const code = host.openPairing()
  const m = await hosts.pair('10.0.0.5:7000', code.toLowerCase())
  assert.deepEqual(m, hostInfo)
  assert.equal(trust.list().length, 1)
  assert.equal(trust.list()[0].machineId, 'h1')
  assert.deepEqual(JSON.parse(fs.readFileSync(join(dir, 'remote-hosts.json'), 'utf8')), { h1: '10.0.0.5:7000' })
  await until(() => online(hosts), 'online after pair')
})

test('pair: tampered host proof stores nothing', async () => {
  const { hosts, host, trust, dir } = rig({ trusted: false })
  hosts.start()
  host.tamper = true
  await assert.rejects(hosts.pair('10.0.0.5:7000', host.openPairing()), /resposta do host não confere/)
  assert.deepEqual(trust.list(), [])
  assert.equal(fs.existsSync(join(dir, 'remote-hosts.json')), false)
  assert.deepEqual(hosts.list(), [])
})

test('pair: malformed code, wrong code and closed window are refused', async () => {
  const { hosts, host, trust } = rig({ trusted: false })
  hosts.start()
  await assert.rejects(hosts.pair('10.0.0.5:7000', 'abc'), /código inválido/)
  assert.equal(host.dials, 0)
  host.openPairing()
  await assert.rejects(hosts.pair('10.0.0.5:7000', '0000-0000-0000-0000'), /código inválido/)
  host.window.close()
  await assert.rejects(hosts.pair('10.0.0.5:7000', '0000-0000-0000-0000'), /pareamento fechado/)
  assert.deepEqual(trust.list(), [])
})

test('mDNS: only unpaired hosts are discovered; a trusted host seen again is retried at once with its new address', async () => {
  let up: (h: DiscoveredHost) => void = () => {}
  let stopped = false
  const browse: Browse = onUp => { up = onUp; return { stop() { stopped = true } } }
  const { hosts, host, timers, dir } = rig({ browse })
  host.down = true
  hosts.start()
  await until(() => timers.items.length === 1)
  host.down = false
  up({ name: 'Outro', os: 'mac', address: '192.168.0.9:7000', machineId: 'x9' })
  up({ name: 'Servidor', os: 'linux', address: '192.168.0.7:7001', machineId: 'h1' })
  assert.deepEqual(hosts.discovered().map(d => d.machineId), ['x9'])
  assert.equal(hosts.list()[0].address, '192.168.0.7:7001')
  await until(() => online(hosts), 'online without waiting for the timer')
  assert.deepEqual(JSON.parse(fs.readFileSync(join(dir, 'remote-hosts.json'), 'utf8')), { h1: '192.168.0.7:7001' })
  assert.equal(timers.items.length, 0)
  hosts.stop()
  assert.equal(stopped, true)
})

test('pairing as a client does not let the host control this machine', async () => {
  const { hosts, host, trust, hostTrust } = rig({ trusted: false })
  hosts.start()
  await hosts.pair('10.0.0.5:7000', host.openPairing())
  const hostPub = hostTrust.ownKey().pub
  assert.equal(trust.get(toB64(hostPub), 'client'), undefined) // the server's accept predicate
  assert.equal(trust.get(toB64(hostPub), 'host')?.machineId, 'h1')
  assert.deepEqual(trust.list('client'), [])
})

test('a machine trusted in both roles is dialed; revoking the client role keeps the host role', async () => {
  const { hosts, host, trust } = rig()
  const pub = trust.list('host')[0].pub
  trust.add({ pub, role: 'client', machineId: 'h1', name: 'Servidor', os: 'linux' })
  hosts.start()
  await until(() => online(hosts) && host.channels.length === 1)
  assert.equal(trust.get(pub, 'client')?.machineId, 'h1')
  trust.revoke(pub, 'client')
  assert.equal(trust.get(pub, 'client'), undefined)
  assert.ok(trust.get(pub, 'host'))
  assert.equal(online(hosts), true)
  trust.revoke(pub)
  assert.deepEqual(hosts.list(), [])
})

test('re-pairing a host under a new key replaces the old one and comes online', async () => {
  const { hosts, host, trust } = rig({ trusted: false, staleHost: true })
  hosts.start()
  await until(() => hosts.list().length === 1)
  await hosts.pair('10.0.0.5:7000', host.openPairing())
  await until(() => online(hosts), 'online with the new key')
  assert.equal(trust.list('host').length, 1)
  assert.equal(hosts.list().length, 1)
})

test('stop closes a handshake still in flight', async () => {
  const { hosts, host } = rig()
  let closed = false
  host.dial = () => ({ send() {}, onMessage() {}, onClose() {}, close() { closed = true } })
  const h2 = new RemoteHosts({
    trust: hosts['deps'].trust, own: hosts['deps'].own, me, dial: host.dial, dir: hosts['deps'].dir
  })
  cleanups.push(() => h2.stop())
  h2.start()
  h2.stop()
  assert.equal(closed, true)
})

test('an mDNS address is kept only after a handshake succeeds there', async () => {
  let up: (h: DiscoveredHost) => void = () => {}
  const browse: Browse = onUp => { up = onUp; return { stop() {} } }
  const { hosts, host, timers, dir } = rig({ browse })
  host.down = true
  hosts.start()
  await until(() => timers.items.length === 1)
  up({ name: 'Servidor', os: 'linux', address: '192.168.0.99:7001', machineId: 'h1' })
  await until(() => timers.items.length === 1 && host.dials >= 2)
  assert.deepEqual(JSON.parse(fs.readFileSync(join(dir, 'remote-hosts.json'), 'utf8')), { h1: '10.0.0.5:7000' })
})

test('discovered() hides only machines trusted as hosts; a client-only machine still shows', () => {
  let up: (h: DiscoveredHost) => void = () => {}
  const browse: Browse = onUp => { up = onUp; return { stop() {} } }
  const { hosts, trust } = rig({ trusted: false, browse })
  trust.add({ pub: 'CLI', role: 'client', machineId: 'c9', name: 'Cel', os: 'mac' })
  hosts.start()
  up({ name: 'Cel', os: 'mac', address: '192.168.0.9:7000', machineId: 'c9' })
  assert.deepEqual(hosts.discovered().map(d => d.machineId), ['c9'])
})
