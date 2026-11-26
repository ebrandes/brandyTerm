import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { Registry } from '../rpc/registry.ts'
import { ConnectorStore } from './store.ts'
import { SecretStore } from './secrets.ts'
import { registerConnectorsIpc } from './connectors-ipc.ts'
import type { ConnectorDraft } from '../../shared/connectors.ts'

const cipher = { available: () => true, encrypt: (s: string) => 'x' + s, decrypt: (s: string) => s.slice(1) }

function setup() {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'cipc-'))
  const store = new ConnectorStore(join(dir, 'connectors.json'))
  const secrets = new SecretStore(join(dir, 'secrets.json'), cipher)
  const log = { closed: [] as string[], asked: [] as string[], entered: [] as [string, unknown][], cancelled: [] as string[], tested: [] as string[] }
  const hub = {
    close: async (id: string) => { log.closed.push(id) },
    test: async (c: { id: string }) => { log.tested.push(c.id); return 7 },
  }
  const login = {
    ask: (c: { id: string }) => { log.asked.push(c.id) },
    enter: async (id: string, v?: unknown) => { log.entered.push([id, v]) },
    cancel: (id: string) => { log.cancelled.push(id) },
  }
  const reg = new Registry()
  registerConnectorsIpc({ store, secrets, hub, login }, reg)
  const call = (ch: string, arg?: unknown) => reg.invoke(ch, arg, {})
  return { dir, store, secrets, log, reg, call }
}

const custom = (over: Partial<ConnectorDraft> = {}): ConnectorDraft => ({
  name: 'Meu', description: '', transport: 'stdio', command: 'node', args: ['x.js'], auth: { kind: 'none' }, enabled: true, ...over,
})

test('every connectors channel is deny', () => {
  const { reg } = setup()
  const chans = reg.channels()
  assert.equal(chans.length, 11)
  for (const c of chans) assert.equal(reg.rule(c), 'deny')
})

test('add with secrets keeps them out of the returned view', async () => {
  const { call, store, secrets, dir } = setup()
  const r = (await call('connectors:add', { draft: custom({ trusted: true }), secrets: { env: { API_KEY: 'sk-hunter2' } } })) as { id: string }
  assert.deepEqual(Object.keys(r), ['id'])
  assert.ok(!JSON.stringify(r).includes('hunter2'))
  assert.deepEqual(store.get(r.id)?.envKeys, ['API_KEY'])
  assert.equal(secrets.get(r.id).env?.API_KEY, 'sk-hunter2')
  assert.ok(!fs.readFileSync(join(dir, 'connectors.json'), 'utf8').includes('hunter2'))
})

test('add of a custom stdio without trusted is refused', async () => {
  const { call, store } = setup()
  await assert.rejects(call('connectors:add', { draft: custom() }), /Confirme "Confio neste comando" antes de salvar/)
  assert.equal(store.list().length, 0)
})

test('add with a preset rebuilds command, url and auth from the preset, never from the client', async () => {
  const { call, store } = setup()
  const { id } = (await call('connectors:add', { preset: 'railway', draft: custom({ command: 'rm', args: ['-rf', '/'], name: 'X', enabled: false, projects: ['/p'] }) })) as { id: string }
  const c = store.get(id)!
  assert.equal(c.name, 'Railway')
  assert.equal(c.command, 'railway')
  assert.deepEqual(c.args, ['mcp'])
  assert.equal(c.auth.kind, 'cli')
  assert.equal(c.preset, 'railway')
  assert.equal(c.enabled, false)
  assert.deepEqual(c.projects, ['/p'])
  assert.equal(c.trusted, undefined)
  await assert.rejects(call('connectors:add', { preset: 'nope', draft: custom() }), /Preset desconhecido/)
})

test('add of a custom connector never takes a cli auth from the client', async () => {
  const { call, store } = setup()
  const { id } = (await call('connectors:add', { draft: custom({ trusted: true, auth: { kind: 'cli', command: ['sh'] } }) })) as { id: string }
  assert.equal(store.get(id)?.auth.kind, 'none')
})

test('add of a custom http keeps oauth and needs no trust', async () => {
  const { call, store } = setup()
  const { id } = (await call('connectors:add', { draft: { name: 'H', description: '', transport: 'http', url: 'https://x/mcp', auth: { kind: 'oauth' }, enabled: true } })) as { id: string }
  assert.equal(store.get(id)?.auth.kind, 'oauth')
})

test('login without values only opens the card; with values it runs', async () => {
  const { call, store, log } = setup()
  const { id } = (await call('connectors:add', { preset: 'railway', draft: {} })) as { id: string }
  await call('connectors:login', { id })
  assert.deepEqual(log.asked, [id])
  assert.equal(log.entered.length, 0)
  await call('connectors:login', { id, values: { token: 't' } })
  assert.deepEqual(log.entered, [[id, { token: 't' }]])
  await call('connectors:login-cancel', { id })
  assert.deepEqual(log.cancelled, [id])
  await assert.rejects(call('connectors:login', { id: 'zzz' }), /Conector não encontrado/)
  assert.ok(store.get(id))
})

test('remove closes the hub client and deletes the secrets', async () => {
  const { call, store, secrets, log } = setup()
  const { id } = (await call('connectors:add', { draft: custom({ trusted: true }), secrets: { env: { K: 'v' } } })) as { id: string }
  await call('connectors:remove', { id })
  assert.deepEqual(log.closed, [id])
  assert.deepEqual(log.cancelled, [id])
  assert.deepEqual(secrets.get(id), {})
  assert.equal(store.get(id), undefined)
})

test('enable closes the hub client only when turning off', async () => {
  const { call, store, log } = setup()
  const { id } = (await call('connectors:add', { draft: custom({ trusted: true }) })) as { id: string }
  await call('connectors:enable', { id, on: false })
  assert.equal(store.get(id)?.enabled, false)
  assert.deepEqual(log.closed, [id])
  await call('connectors:enable', { id, on: true })
  assert.equal(store.get(id)?.enabled, true)
  assert.deepEqual(log.closed, [id])
})

test('test returns the tool count', async () => {
  const { call, log } = setup()
  const { id } = (await call('connectors:add', { draft: custom({ trusted: true }) })) as { id: string }
  assert.deepEqual(await call('connectors:test', { id }), { tools: 7 })
  assert.deepEqual(log.tested, [id])
  await assert.rejects(call('connectors:test', { id: 'zzz' }), /Conector não encontrado/)
})

test('update takes only name, description, projects and enabled, and replaces secret values', async () => {
  const { call, store, secrets, log } = setup()
  const { id } = (await call('connectors:add', { draft: custom({ trusted: true }), secrets: { env: { A: '1', B: '2' } } })) as { id: string }
  await call('connectors:update', {
    id,
    patch: { name: 'Novo', description: 'd', projects: ['/p'], command: 'evil', url: 'http://evil', auth: { kind: 'oauth' } },
    secrets: { env: { A: 'novo', C: '3' }, headers: { H: 'h' } },
  })
  const c = store.get(id)!
  assert.equal(c.name, 'Novo')
  assert.equal(c.description, 'd')
  assert.deepEqual(c.projects, ['/p'])
  assert.equal(c.command, 'node')
  assert.equal(c.url, undefined)
  assert.equal(c.auth.kind, 'none')
  assert.deepEqual(c.envKeys, ['A', 'B', 'C'])
  assert.deepEqual(c.headerKeys, ['H'])
  assert.deepEqual(secrets.get(id).env, { A: 'novo', B: '2', C: '3' })
  assert.deepEqual(log.closed, [id])
})

test('revoke-always removes the tool from alwaysAllow', async () => {
  const { call, store } = setup()
  const { id } = (await call('connectors:add', { draft: custom({ trusted: true }) })) as { id: string }
  store.allow(id, 'get_logs')
  store.allow(id, 'deploy')
  await call('connectors:revoke-always', { id, tool: 'get_logs' })
  assert.deepEqual(store.get(id)?.alwaysAllow, ['deploy'])
})

test('presets lists the shipped presets without secrets', async () => {
  const { call } = setup()
  const list = (await call('connectors:presets')) as { id: string }[]
  assert.ok(list.some(p => p.id === 'railway'))
})

test('a custom http connector with a non-https, non-localhost url is refused by main', async () => {
  const { call, store } = setup()
  await assert.rejects(call('connectors:add', { draft: custom({ transport: 'http', command: undefined, url: 'http://example.com/mcp' }) }), /Use uma URL https/)
  assert.equal(store.list().length, 0)
})

test('update scope: exceptions stay with a global connector, a project list clears them', async () => {
  const { call, store, log } = setup()
  const { id } = (await call('connectors:add', { draft: custom({ trusted: true }) })) as { id: string }
  const scope = () => [store.get(id)?.projects, store.get(id)?.exceptProjects]
  await call('connectors:update', { id, patch: { projects: [], exceptProjects: ['/a'] } })
  assert.deepEqual(scope(), [undefined, ['/a']])
  await call('connectors:update', { id, patch: { name: 'Outro' } })
  assert.deepEqual(scope(), [undefined, ['/a']])
  await call('connectors:update', { id, patch: { projects: ['/b'] } })
  assert.deepEqual(scope(), [['/b'], undefined])
  await call('connectors:update', { id, patch: { exceptProjects: ['/c'] } })
  assert.deepEqual(scope(), [['/b'], undefined])
  await call('connectors:update', { id, patch: { projects: [], exceptProjects: [] } })
  assert.deepEqual(scope(), [undefined, undefined])
  assert.deepEqual(log.closed, [])
})
