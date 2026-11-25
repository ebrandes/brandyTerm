import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { Registry } from '../rpc/registry.ts'
import { ConnectorStore } from './store.ts'
import { SecretStore } from './secrets.ts'
import { registerImportIpc } from './import-ipc.ts'
import { ruleOf } from '../rpc/channels.ts'

const cipher = { available: () => true, encrypt: (s: string) => 'x' + s, decrypt: (s: string) => s.slice(1) }

function setup() {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'iipc-'))
  const file = join(dir, '.claude.json')
  fs.writeFileSync(file, JSON.stringify({ mcpServers: {
    railway: { command: 'npx', args: ['railway-mcp'], env: { T: 'sek' } },
    docs: { type: 'http', url: 'https://docs.example.com/mcp', headers: { Authorization: 'Bearer x' } },
    bad: { type: 'http', url: 'http://evil.example.com/mcp' },
    old: { type: 'sse', url: 'https://old.example.com/sse' },
  } }))
  const store = new ConnectorStore(join(dir, 'connectors.json'))
  const secrets = new SecretStore(join(dir, 'secrets.json'), cipher)
  const reg = new Registry()
  registerImportIpc({ store, secrets }, reg, file)
  return { store, secrets, call: (ch: string, a?: unknown) => reg.invoke(ch, a, {}) }
}

test('both channels are deny', () => {
  assert.equal(ruleOf('connectors:import-list'), 'deny')
  assert.equal(ruleOf('connectors:import'), 'deny')
})

test('the list carries no values', async () => {
  const { call } = setup()
  const list = (await call('connectors:import-list')) as { name: string }[]
  assert.equal(list.length, 4)
  assert.ok(!JSON.stringify(list).includes('sek'))
})

test('a stdio import without the trust confirmation is refused and saves nothing', async () => {
  const { call, store } = setup()
  await assert.rejects(call('connectors:import', { names: ['docs', 'railway'], trusted: false }), /Confio neste comando/)
  assert.equal(store.list().length, 0)
})

test('import saves definitions without values and the values as secrets; unsupported are skipped', async () => {
  const { call, store, secrets } = setup()
  await call('connectors:import', { names: ['railway', 'docs', 'old'], trusted: true })
  const list = store.list()
  assert.deepEqual(list.map((c) => c.name), ['railway', 'docs'])
  assert.ok(!JSON.stringify(list).includes('sek') && !JSON.stringify(list).includes('Bearer x'))
  assert.deepEqual(secrets.get(list[0].id).env, { T: 'sek' })
  assert.deepEqual(secrets.get(list[1].id).headers, { Authorization: 'Bearer x' })
  assert.equal(list[0].trusted, true)
})

test('main also refuses an imported http url that is not https or localhost', async () => {
  const { call, store } = setup()
  await assert.rejects(call('connectors:import', { names: ['bad'], trusted: true }), /Use uma URL https/)
  assert.equal(store.list().length, 0)
})
