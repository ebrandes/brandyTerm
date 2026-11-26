import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { Registry } from '../rpc/registry.ts'
import { ConnectorStore } from './store.ts'
import { SecretStore } from './secrets.ts'
import { registerConnectorsIpc } from './connectors-ipc.ts'
import { normalizeDraft, repairPasted } from './pasted-fix.ts'
import type { Connector, ConnectorDraft } from '../../shared/connectors.ts'

const cipher = { available: () => true, encrypt: (s: string) => 'x' + s, decrypt: (s: string) => s.slice(1) }
const URL7 = 'https://mcp.context7.com/mcp'
// what was saved for Context7: the Claude Code install command as a stdio "server"
const saved = { name: 'Context7', description: '', transport: 'stdio' as const, command: 'claude', args: [`mcp add --transport http context7 ${URL7}`], auth: { kind: 'none' as const }, enabled: true, trusted: true, projects: ['/p/fix'] }

function stores() {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'pasted-'))
  return { dir, store: new ConnectorStore(join(dir, 'connectors.json')), secrets: new SecretStore(join(dir, 'secrets.json'), cipher) }
}

test('the saved Context7 install command becomes the http connector, once, keeping name, id and projects', () => {
  const { store, secrets } = stores()
  const made = store.add(saved)
  assert.equal(repairPasted(store, secrets), 1)
  const c = store.get(made.id) as Connector
  assert.equal(c.transport, 'http')
  assert.equal(c.url, URL7)
  assert.equal(c.command, undefined)
  assert.equal(c.trusted, undefined)
  assert.deepEqual(c.projects, ['/p/fix'])
  assert.equal(c.name, 'Context7')
  assert.equal(repairPasted(store, secrets), 0)
})

test('a pasted header leaves connectors.json for the secret store', () => {
  const { dir, store, secrets } = stores()
  const made = store.add({ ...saved, args: ['mcp', 'add', '--transport', 'http', 'context7', URL7, '--header', 'CONTEXT7_API_KEY: ctx7sk-abcdef123456'] })
  repairPasted(store, secrets)
  assert.equal(secrets.get(made.id).headers?.CONTEXT7_API_KEY, 'ctx7sk-abcdef123456')
  assert.deepEqual(store.get(made.id)?.headerKeys, ['CONTEXT7_API_KEY'])
  assert.ok(!fs.readFileSync(join(dir, 'connectors.json'), 'utf8').includes('ctx7sk-abcdef123456'))
})

test('a whole command line in the command field is split; good and preset connectors are left alone', () => {
  const { store, secrets } = stores()
  const line = store.add({ ...saved, name: 'Linha', command: 'npx -y @upstash/context7-mcp', args: [] })
  const good = store.add({ ...saved, name: 'Bom', command: 'npx', args: ['-y', '@upstash/context7-mcp'] })
  const preset = store.add({ ...saved, name: 'Preset', preset: 'x', command: 'claude', args: ['mcp add a https://a.test'] })
  assert.equal(repairPasted(store, secrets), 1)
  assert.deepEqual([store.get(line.id)?.command, store.get(line.id)?.args], ['npx', ['-y', '@upstash/context7-mcp']])
  assert.deepEqual(store.get(good.id)?.args, ['-y', '@upstash/context7-mcp'])
  assert.equal(store.get(preset.id)?.transport, 'stdio')
})

test('normalizeDraft keeps what the user typed in the secret fields over the pasted values', () => {
  const draft: ConnectorDraft = { ...saved, args: [`mcp add context7 ${URL7} -H "Authorization: Bearer colado1234"`] }
  const out = normalizeDraft(draft, { headers: { Authorization: 'Bearer digitado99' } })
  assert.equal(out.draft.transport, 'http')
  assert.equal(out.draft.url, URL7)
  assert.equal(out.secrets.headers?.Authorization, 'Bearer digitado99')
  const fine: ConnectorDraft = { ...saved, command: 'node', args: ['server.js'] }
  assert.equal(normalizeDraft(fine).draft, fine)
})

test('connectors:add saves the pasted Context7 command as the http connector', async () => {
  const { store, secrets } = stores()
  const reg = new Registry()
  const hub = { close: async () => {}, test: async () => 0 }
  const login = { ask: () => {}, enter: async () => {}, cancel: () => {} }
  registerConnectorsIpc({ store, secrets, hub, login }, reg)
  const { id } = await reg.invoke('connectors:add', { draft: saved }, {}) as { id: string }
  const c = store.get(id) as Connector
  assert.deepEqual([c.transport, c.url, c.command, c.auth.kind], ['http', URL7, undefined, 'none'])
})
