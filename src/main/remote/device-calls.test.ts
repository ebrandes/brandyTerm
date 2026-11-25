import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { toB64 } from '../../shared/remote/crypto.ts'
import type { Socket } from '../../shared/remote/protocol.ts'
import { deviceCalls } from './device-calls.ts'
import { RemoteHosts } from './hosts.ts'
import { TrustStore } from './trust.ts'

const pub = (n: number) => toB64(new Uint8Array(32).fill(n))

test('both roles are listed, and a paired host can be forgotten: no more dialing, no more projects', t => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'dev-calls-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const trust = new TrustStore(dir)
  const dials: string[] = []
  const timers = new Set<number>()
  let n = 0
  const hosts = new RemoteHosts({
    trust, own: () => trust.ownKey(), me: { id: 'me', name: 'Eu', os: 'mac' }, dir,
    dial: (a: string): Socket => { dials.push(a); throw new Error('sem rede no teste') },
    browse: () => ({ stop() {} }),
    setTimeout: () => { timers.add(++n); return n },
    clearTimeout: h => { timers.delete(h as number) }
  })
  t.after(() => hosts.stop())
  hosts.start()
  hosts['addresses'].set('m1', '10.0.0.5:7000')
  trust.add({ pub: pub(1), role: 'client', machineId: 'c1', name: 'Celular', os: 'phone' })
  trust.add({ pub: pub(2), role: 'host', machineId: 'm1', name: 'Mac', os: 'mac' })
  hosts['lastState'].set('m1', { projects: [] } as never)
  const calls = deviceCalls(trust)
  assert.deepEqual(calls.devices().map(d => [d.role, d.name]), [['client', 'Celular'], ['host', 'Mac']])
  assert.equal(hosts.list().length, 1)
  assert.deepEqual(dials, ['10.0.0.5:7000'])

  calls.revoke({ pub: pub(2), role: 'host' })
  assert.deepEqual(calls.devices().map(d => d.role), ['client'])
  assert.deepEqual(hosts.list(), [])
  assert.deepEqual(hosts.states(), [], 'its projects leave the sidebar')
  assert.equal(timers.size, 0, 'no retry left')

  calls.revoke({ pub: pub(1), role: 'client' })
  assert.deepEqual(calls.devices(), [])
})

test('revoke needs a key and a known role', t => {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'dev-calls-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const calls = deviceCalls(new TrustStore(dir))
  for (const bad of [pub(1), { pub: pub(1) }, { pub: pub(1), role: 'admin' }, { role: 'host' }, null]) {
    assert.throws(() => calls.revoke(bad), /^Error: Aparelho inválido$/)
  }
})
