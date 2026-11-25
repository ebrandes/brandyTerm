import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { TrustStore } from './trust.ts'
import { toB64 } from '../../shared/remote/crypto.ts'

const dirs: string[] = []
const tmp = () => { const d = fs.mkdtempSync(join(os.tmpdir(), 'trust-')); dirs.push(d); return d }
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })
const dev = { pub: 'PUB1', role: 'client' as const, machineId: 'm1', name: 'Mac', os: 'mac' as const }

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
  assert.equal(s.get('PUB1', 'client')?.name, 'Mac')
  assert.equal(new TrustStore(dir).get('PUB1', 'client')?.machineId, 'm1')
})

test('revoke removes and emits change', () => {
  const s = new TrustStore(tmp())
  s.add(dev)
  let n = 0
  s.on('change', () => n++)
  s.revoke('PUB1')
  assert.equal(s.get('PUB1', 'client'), undefined)
  assert.equal(n, 1)
})

test('touch and setTerminal', () => {
  const s = new TrustStore(tmp())
  s.add(dev)
  s.touch('PUB1', '2026-11-25T00:00:00Z')
  s.setTerminal('PUB1', true)
  const d = s.list()[0]
  assert.equal(d.lastSeen, '2026-11-25T00:00:00Z')
  assert.equal(d.terminal, true)
})

test('private key only in remote-key.json, mode 0600', () => {
  const dir = tmp()
  const s = new TrustStore(dir)
  const priv = toB64(s.ownKey().priv)
  s.add(dev)
  assert.ok(!fs.readFileSync(join(dir, 'remote-trust.json'), 'utf8').includes(priv))
  assert.ok(!JSON.stringify(s.list()).includes(priv))
  assert.ok(fs.readFileSync(join(dir, 'remote-key.json'), 'utf8').includes(priv))
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(join(dir, 'remote-key.json')).mode & 0o777, 0o600)
  }
})

test('creates missing directory', () => {
  const dir = join(tmp(), 'a', 'b')
  new TrustStore(dir).ownKey()
  assert.ok(fs.existsSync(join(dir, 'remote-key.json')))
})

test('opening the store and listing creates no key: remote-key.json waits for the server or a pairing', () => {
  const dir = tmp()
  const s = new TrustStore(dir)
  s.list()
  s.get('x', 'client')
  assert.equal(fs.existsSync(join(dir, 'remote-key.json')), false)
  s.ownKey()
  assert.equal(fs.existsSync(join(dir, 'remote-key.json')), true)
})

const corrupt = (dir: string, name: string) => fs.readdirSync(dir).filter(f => f.startsWith(`${name}.corrupt-`))

test('a corrupt trust file is kept aside (and logged) before the list starts empty', () => {
  const dir = tmp()
  fs.writeFileSync(join(dir, 'remote-trust.json'), '{ not json')
  const s = new TrustStore(dir)
  assert.deepEqual(s.list(), [])
  const kept = corrupt(dir, 'remote-trust.json')
  assert.equal(kept.length, 1)
  assert.equal(fs.readFileSync(join(dir, kept[0]), 'utf8'), '{ not json')
  s.add(dev) // the next save replaces the file; the copy stays
  assert.equal(corrupt(dir, 'remote-trust.json').length, 1)
})

test('a corrupt key file is kept aside before a new key is made; a missing one is not', () => {
  const dir = tmp()
  new TrustStore(dir).ownKey()
  assert.deepEqual(corrupt(dir, 'remote-key.json'), [])
  fs.writeFileSync(join(dir, 'remote-key.json'), '{"pub":"AAAA","priv":"BBBB"}')
  new TrustStore(dir).ownKey()
  const kept = corrupt(dir, 'remote-key.json')
  assert.equal(kept.length, 1)
  assert.equal(fs.readFileSync(join(dir, kept[0]), 'utf8'), '{"pub":"AAAA","priv":"BBBB"}')
  assert.equal(fs.statSync(join(dir, kept[0])).mode & 0o777, 0o600, 'the copy of a key stays private')
})
