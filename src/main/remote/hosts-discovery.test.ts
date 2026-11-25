import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { toB64 } from '../../shared/remote/crypto.ts'
import type { DiscoveredHost, MachineInfo } from '../../shared/remote/machine.ts'
import type { Socket } from '../../shared/remote/protocol.ts'
import type { Browse } from './browse.ts'
import { DISCOVER_MS, RemoteHosts } from './hosts.ts'
import { TrustStore } from './trust.ts'

const dirs: string[] = []
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

const me: MachineInfo = { id: '22222222-2222-4222-8222-222222222222', name: 'Eu', os: 'mac' }

class Timers {
  items: { id: number; fn: () => void; ms: number }[] = []
  private n = 0
  setTimeout = (fn: () => void, ms: number): number => { this.items.push({ id: ++this.n, fn, ms }); return this.n }
  clearTimeout = (h: unknown): void => { this.items = this.items.filter(t => t.id !== h) }
  fireLease(): void {
    const t = this.items.find(i => i.ms === DISCOVER_MS)
    assert.ok(t, 'lease timer')
    this.items = this.items.filter(i => i !== t)
    t.fn()
  }
}

/** The client as startClient builds it (lazy key, mDNS browse and dial injected), with spies. */
function client() {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hosts-disc-'))
  dirs.push(dir)
  const trust = new TrustStore(dir)
  const timers = new Timers()
  const spy = { browses: 0, stops: 0, dials: [] as string[], up: (_h: DiscoveredHost): void => {} }
  const browse: Browse = onUp => {
    spy.browses++
    spy.up = onUp
    return { stop() { spy.stops++ } }
  }
  const dial = (address: string): Socket => {
    spy.dials.push(address)
    throw new Error('sem rede no teste')
  }
  const hosts = new RemoteHosts({
    trust, own: () => trust.ownKey(), me, dial, dir, browse,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout
  })
  cleanups.push(() => hosts.stop())
  return { hosts, trust, timers, spy, dir }
}

test('startClient defaults: no host trusted, so no mDNS browser, no dial and no key file', () => {
  const { hosts, spy, dir, timers } = client()
  hosts.start()
  assert.equal(spy.browses, 0)
  assert.deepEqual(spy.dials, [])
  assert.deepEqual(timers.items, [])
  assert.equal(fs.existsSync(join(dir, 'remote-key.json')), false)
  assert.deepEqual(hosts.discovered(), [])
  assert.equal(spy.browses, 0, 'asking for the list does not start a browse')
})

test('discover(true) browses once; discover(false) stops it and forgets what was seen', () => {
  const { hosts, spy } = client()
  hosts.start()
  hosts.discover(true)
  hosts.discover(true)
  assert.equal(spy.browses, 1)
  spy.up({ name: 'Outro', os: 'mac', address: '192.168.0.9:7000', machineId: 'x9' })
  assert.deepEqual(hosts.discovered().map(h => h.machineId), ['x9'])
  hosts.discover(false)
  assert.equal(spy.stops, 1)
  assert.deepEqual(hosts.discovered(), [])
  assert.deepEqual(spy.dials, [], 'a discovered host that is not paired is never dialed')
})

test('the browse stops by itself when the panel stops asking (lease), and asking renews it', () => {
  const { hosts, spy, timers } = client()
  hosts.start()
  hosts.discover(true)
  assert.equal(timers.items.filter(t => t.ms === DISCOVER_MS).length, 1)
  hosts.discovered() // the list polls: same lease, renewed
  assert.equal(timers.items.filter(t => t.ms === DISCOVER_MS).length, 1)
  timers.fireLease()
  assert.equal(spy.stops, 1)
  assert.deepEqual(timers.items, [])
  hosts.discovered() // a late poll after the lease ran out starts nothing
  assert.equal(spy.browses, 1)
})

test('discover before start, or after stop, does not browse', () => {
  const { hosts, spy } = client()
  hosts.discover(true)
  assert.equal(spy.browses, 0)
  hosts.start()
  hosts.discover(true)
  hosts.stop()
  assert.equal(spy.stops, 1)
  hosts.discover(true)
  assert.equal(spy.browses, 1)
})

test('dialing starts with the first trusted host and stops when the last one is revoked', () => {
  const { hosts, trust, spy, timers } = client()
  hosts.start()
  hosts['addresses'].set('m1', '10.0.0.5:7000') // what pair() remembers before trusting the host
  trust.add({ pub: toB64(new Uint8Array(32).fill(7)), role: 'host', machineId: 'm1', name: 'Mac', os: 'mac' })
  assert.deepEqual(spy.dials, ['10.0.0.5:7000'])
  assert.equal(timers.items.length, 1, 'retry scheduled')
  trust.revoke(trust.list('host')[0].pub, 'host')
  assert.deepEqual(hosts.list(), [])
  assert.deepEqual(timers.items, [], 'no retry left')
})
