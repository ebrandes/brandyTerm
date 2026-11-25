import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { SecretStore, type Cipher } from './secrets.ts'
import { ConnectorStore } from './store.ts'

const fake: Cipher = {
  available: () => true,
  encrypt: s => Buffer.from('x' + s).toString('base64'),
  decrypt: b => Buffer.from(b, 'base64').toString().slice(1),
}

function dir(): string {
  return fs.mkdtempSync(join(os.tmpdir(), 'sec-'))
}

test('secrets round-trip through the cipher', () => {
  const d = dir()
  new SecretStore(join(d, 's.json'), fake).set('a', { env: { K: 'v' } })
  assert.deepEqual(new SecretStore(join(d, 's.json'), fake).get('a'), { env: { K: 'v' } })
  assert.deepEqual(new SecretStore(join(d, 's.json'), fake).get('missing'), {})
})

test('secrets never in connectors.json', () => {
  const d = dir()
  const store = new ConnectorStore(join(d, 'connectors.json'))
  const c = store.add({ name: 'R', description: '', transport: 'stdio', command: 'r', envKeys: ['RAILWAY_TOKEN'], auth: { kind: 'none' }, enabled: true })
  new SecretStore(join(d, 'connector-secrets.json'), fake).set(c.id, { env: { RAILWAY_TOKEN: 'sek' } })
  assert.ok(!fs.readFileSync(join(d, 'connectors.json'), 'utf8').includes('sek'))
  assert.ok(!fs.readFileSync(join(d, 'connector-secrets.json'), 'utf8').includes('sek'))
})

test('secrets refuse without encryption', () => {
  const s = new SecretStore(join(dir(), 's.json'), { ...fake, available: () => false })
  assert.throws(() => s.set('a', { env: { K: 'v' } }), /Criptografia do sistema indisponível; não dá para guardar o segredo\./)
})

test('secrets patch merges top-level keys, remove deletes', () => {
  const s = new SecretStore(join(dir(), 's.json'), fake)
  s.set('a', { env: { K: 'v' } })
  s.patch('a', { oauth: { verifier: 'ver' } })
  assert.deepEqual(s.get('a'), { env: { K: 'v' }, oauth: { verifier: 'ver' } })
  s.remove('a')
  assert.deepEqual(s.get('a'), {})
})

test('a value that fails to decrypt reads as empty', () => {
  const d = dir()
  fs.writeFileSync(join(d, 's.json'), JSON.stringify({ a: 'zzz' }))
  const bad: Cipher = { ...fake, decrypt: () => { throw new Error('boom') } }
  const prev = console.error
  console.error = () => {}
  try { assert.deepEqual(new SecretStore(join(d, 's.json'), bad).get('a'), {}) } finally { console.error = prev }
})

test('an unreadable secrets file is copied aside before the next set', () => {
  const d = dir()
  const file = join(d, 's.json')
  fs.writeFileSync(file, '{not json')
  const prev = console.error
  console.error = () => {}
  try {
    const s = new SecretStore(file, fake)
    assert.deepEqual(s.get('a'), {})
    s.get('a'); s.get('b')
    assert.equal(fs.readdirSync(d).filter(f => f.includes('.corrupt-')).length, 1)
    s.set('b', { env: { K: 'v' } })
  } finally { console.error = prev }
  assert.equal(fs.readdirSync(d).filter(f => f.includes('.corrupt-')).length, 1)
  const copy = fs.readdirSync(d).find(f => /^s\.json\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(f))
  assert.ok(copy)
  assert.equal(fs.readFileSync(join(d, copy), 'utf8'), '{not json')
})
