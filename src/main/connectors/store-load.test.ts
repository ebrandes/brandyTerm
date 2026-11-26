import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { Registry } from '../rpc/registry.ts'
import { ConnectorStore } from './store.ts'
import { SecretStore } from './secrets.ts'
import { repairPasted } from './pasted-fix.ts'
import { connectorView } from './view.ts'
import { registerConnectorsIpc } from './connectors-ipc.ts'
import type { Connector } from '../../shared/connectors.ts'

const cipher = { available: () => true, encrypt: (s: string) => 'x' + s, decrypt: (s: string) => s.slice(1) }
const URL7 = 'https://mcp.context7.com/mcp'
// connectors.json as it was on disk before Context7 disappeared, byte for byte in content
const ORIGINAL = {
  name: 'Context7', description: '', enabled: true, transport: 'stdio', command: 'claude',
  args: [`mcp add --transport http context7 ${URL7}`], auth: { kind: 'none' }, trusted: true,
  id: 'ad40b429-4617-4e6f-887a-bb2dd4c47487', alwaysAllow: [], projects: ['/Users/brnds/Projects/fix-everything'],
}

function dirWith(content: string) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'cload-'))
  const file = join(dir, 'connectors.json')
  fs.writeFileSync(file, content)
  return { dir, file, secrets: new SecretStore(join(dir, 'secrets.json'), cipher) }
}
const copies = (dir: string) => fs.readdirSync(dir).filter(f => f.startsWith('connectors.json.corrupt-'))
const hub = { status: () => ({ status: 'desconectado' as const }) }
const login = { needsLoginNow: () => false }

test('the saved Context7 command converts to http without losing any other field, on disk too', () => {
  const { dir, file, secrets } = dirWith(JSON.stringify([ORIGINAL]))
  const store = new ConnectorStore(file)
  assert.equal(copies(dir).length, 0, 'a valid file is not copied aside')
  assert.equal(repairPasted(store, secrets), 1)
  const { command: _c, args: _a, trusted: _t, ...kept } = ORIGINAL
  const want = { ...kept, transport: 'http', url: URL7 }
  assert.deepEqual(new ConnectorStore(file).list(), [want])
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [want])
  const v = connectorView(new ConnectorStore(file).list()[0], hub, login)
  assert.equal(v.status, 'desconectado')
  assert.equal(v.problem, undefined)
})

test('no entry vanishes: unreadable ones stay listed as broken, and the original file is copied aside', () => {
  const raw = [42, { name: 'Sem id', transport: 'stdio', command: 'node', enabled: true }, { ...ORIGINAL, alwaysAllow: 'x' }, { ...ORIGINAL, name: 'Dup' }]
  const { dir, file } = dirWith(JSON.stringify(raw))
  const store = new ConnectorStore(file)
  const list = store.list()
  assert.equal(list.length, 4)
  assert.equal(copies(dir).length, 1)
  assert.deepEqual(JSON.parse(fs.readFileSync(join(dir, copies(dir)[0]), 'utf8')), raw)
  assert.match(list[0].broken ?? '', /não é um conector/)
  assert.equal(connectorView(list[0], hub, login).status, 'erro')
  assert.equal(list[1].name, 'Sem id')
  assert.ok(list[1].id)
  assert.deepEqual(list[2].alwaysAllow, [])
  assert.notEqual(list[3].id, list[2].id, 'a repeated id gets its own, so Remover removes only that one')
  assert.equal(store.fault, undefined)
})

test('a file that is not a list says so (fault) instead of showing an empty panel', () => {
  for (const text of ['{"name":"Context7"}', '[{"name":']) {
    const { dir, file } = dirWith(text)
    const store = new ConnectorStore(file)
    assert.deepEqual(store.list(), [])
    assert.match(store.fault ?? '', /connectors\.json/)
    assert.equal(copies(dir).length, 1)
  }
})

test('a definition that cannot run shows its problem and is not offered to threads', () => {
  const bad = [
    { ...ORIGINAL, id: 'a', name: 'Sem comando', command: '', args: [], projects: undefined },
    { ...ORIGINAL, id: 'b', name: 'Sem url', transport: 'http', command: undefined, args: undefined, projects: undefined },
  ]
  const { file } = dirWith(JSON.stringify(bad))
  const store = new ConnectorStore(file)
  const views = store.list().map(c => connectorView(c, hub, login))
  assert.deepEqual(views.map(v => [v.status, v.problem]), [['erro', 'Informe o comando'], ['erro', 'Informe a URL']])
  assert.deepEqual(store.visibleFor('/any'), [])
})

test('Corrigir redefines a broken custom connector, keeping id, projects, switch and always-allowed tools', async () => {
  const { file, secrets } = dirWith(JSON.stringify([{ ...ORIGINAL, command: '', args: [], alwaysAllow: ['resolve-library-id'] }]))
  const store = new ConnectorStore(file)
  const closed: string[] = []
  const reg = new Registry()
  registerConnectorsIpc({
    store, secrets,
    hub: { close: async (id: string) => { closed.push(id) }, test: async () => 0 },
    login: { ask: () => {}, enter: async () => {}, cancel: () => {} },
  }, reg)
  await reg.invoke('connectors:update', { id: ORIGINAL.id, patch: { definition: { transport: 'http', url: URL7, auth: { kind: 'none' } } } }, {})
  const c = store.get(ORIGINAL.id) as Connector
  const { command: _c, args: _a, trusted: _t, ...kept } = ORIGINAL
  assert.deepEqual(c, { ...kept, transport: 'http', url: URL7, alwaysAllow: ['resolve-library-id'] })
  assert.deepEqual(closed, [ORIGINAL.id])
  assert.equal(connectorView(c, hub, login).problem, undefined)
  await assert.rejects(reg.invoke('connectors:update', { id: ORIGINAL.id, patch: { definition: { transport: 'http', url: 'ftp://x' } } }, {}), /https/)
})
