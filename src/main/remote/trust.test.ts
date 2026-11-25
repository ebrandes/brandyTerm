import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { TrustStore } from './trust.ts'

const tmp = () => fs.mkdtempSync(join(os.tmpdir(), 'trust-'))
const dev = { pub: 'PUB1', machineId: 'm1', name: 'Mac', os: 'mac' as const }

test('ownKey is stable across instances', () => {
  const dir = tmp()
  const a = new TrustStore(dir).ownKey()
  const b = new TrustStore(dir).ownKey()
  assert.deepEqual(a.pub, b.pub)
  assert.deepEqual(a.priv, b.priv)
})

test('add then get; new devices have terminal false; persists', () => {
  const dir = tmp()
  const s = new TrustStore(dir)
  const added = s.add(dev)
  assert.equal(added.terminal, false)
  assert.equal(s.get('PUB1')?.name, 'Mac')
  assert.equal(new TrustStore(dir).get('PUB1')?.machineId, 'm1')
})

test('revoke removes and emits change', () => {
  const s = new TrustStore(tmp())
  s.add(dev)
  let n = 0
  s.on('change', () => n++)
  s.revoke('PUB1')
  assert.equal(s.get('PUB1'), undefined)
  assert.equal(n, 1)
})

test('touch and setTerminal; private key never listed', () => {
  const s = new TrustStore(tmp())
  s.ownKey()
  s.add(dev)
  s.touch('PUB1', '2026-11-25T00:00:00Z')
  s.setTerminal('PUB1', true)
  const d = s.list()[0]
  assert.equal(d.lastSeen, '2026-11-25T00:00:00Z')
  assert.equal(d.terminal, true)
  assert.ok(!JSON.stringify(s.list()).includes('priv'))
})

test('creates missing directory', () => {
  const dir = join(tmp(), 'a', 'b')
  new TrustStore(dir).ownKey()
  assert.ok(fs.existsSync(join(dir, 'remote-key.json')))
})
