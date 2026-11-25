import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import type { Browse } from './browse.ts'
import type { Socket } from '../../shared/remote/protocol.ts'
import { RemoteHosts } from './hosts.ts'
import { TrustStore } from './trust.ts'

/** A host that answers every pairing with "versão diferente", as an older or newer BrandyTerm does. */
function oldHost(t: { after(fn: () => void): void }) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hosts-pair-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const trust = new TrustStore(dir)
  let up: Parameters<Browse>[0] = () => {}
  const dial = (): Socket => {
    let onMsg: (d: Uint8Array | string) => void = () => {}
    return {
      send: () => queueMicrotask(() => onMsg(JSON.stringify({ t: 'pair-fail', reason: 'versão diferente' }))),
      close() {},
      onClose() {},
      onMessage(cb) { onMsg = cb }
    }
  }
  const hosts = new RemoteHosts({
    trust, own: () => trust.ownKey(), me: { id: 'me', name: 'Eu', os: 'mac' }, dial, dir,
    browse: cb => { up = cb; return { stop() {} } },
    setTimeout: () => 0, clearTimeout: () => {}
  })
  t.after(() => hosts.stop())
  hosts.start()
  return { hosts, trust, seen: (name: string, address: string) => up({ name, os: 'linux', address, machineId: 'm9' }) }
}

test('pairing with another protocol version asks to update BrandyTerm on that machine', async t => {
  const { hosts, trust, seen } = oldHost(t)
  hosts.discover(true)
  seen('Servidor', '192.168.0.9:7000')
  await assert.rejects(hosts.pair('192.168.0.9:7000', '0000-0000-0000-0000'), /^Error: atualize o BrandyTerm em Servidor$/)
  assert.deepEqual(trust.list(), [])
})

test('the same, when the code was typed with an address the list never showed', async t => {
  const { hosts } = oldHost(t)
  await assert.rejects(hosts.pair('192.168.0.7:7000', '0000-0000-0000-0000'), /^Error: atualize o BrandyTerm no outro computador$/)
})
