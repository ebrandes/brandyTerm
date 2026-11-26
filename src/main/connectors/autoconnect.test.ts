import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { reconnectEnabled, type ReconnectDeps } from './autoconnect.ts'
import { ConnectorHub, type LiveClient } from './hub.ts'
import { ConnectorStore } from './store.ts'
import type { Connector } from '../../shared/connectors.ts'

const draft = (name: string, extra: Partial<Connector> = {}): Omit<Connector, 'id' | 'alwaysAllow'> =>
  ({ name, description: '', transport: 'http', url: 'https://example.test/mcp', auth: { kind: 'none' }, enabled: true, ...extra })

const client: LiveClient = { tools: async () => [{ name: 't', inputSchema: {} }], call: async () => ({ content: [] }), close: async () => {}, onClose: () => {} }

type Opts = { fail?: string[]; failTimes?: number; retryDelays?: number[]; needsLogin?: ReconnectDeps['login']['needsLogin'] }

function setup(opts: Opts = {}) {
  const store = new ConnectorStore(join(fs.mkdtempSync(join(os.tmpdir(), 'auto-')), 'connectors.json'))
  const tried: string[] = []
  const hub = new ConnectorHub({
    auth: () => ({ env: {}, headers: {} }),
    factory: async c => {
      tried.push(c.name)
      if (opts.fail?.includes(c.name) && tried.filter(n => n === c.name).length <= (opts.failTimes ?? Infinity)) throw new Error('fetch failed')
      return client
    },
  })
  const lines: [string, string, string][] = []
  const deps: ReconnectDeps = {
    store, hub, retryDelays: opts.retryDelays ?? [],
    login: { needsLogin: opts.needsLogin ?? (async () => false) },
    log: (level, msg, c) => { lines.push([level, msg, c.name]) },
  }
  return { store, hub, tried, lines, deps }
}

test('connects every enabled connector, whatever its projects, and lists the tools', async () => {
  const { store, hub, tried, lines, deps } = setup()
  const open = store.add(draft('Open'))
  store.add(draft('Scoped', { projects: ['/a'] }))
  store.add(draft('Off', { enabled: false }))
  store.add(draft('Broken', { broken: 'ruim' }))
  await reconnectEnabled(deps)
  assert.deepEqual(tried.sort(), ['Open', 'Scoped'])
  assert.deepEqual(hub.status(open.id), { status: 'conectado', toolCount: 1 })
  assert.deepEqual(lines.filter(l => l[2] === 'Open'), [['info', 'reconexão no início ok', 'Open']])
  await hub.closeAll()
})

test('a failure stays on its connector as erro, listed, and the others connect', async () => {
  const { store, hub, lines, deps } = setup({ fail: ['Down'] })
  const down = store.add(draft('Down'))
  const up = store.add(draft('Up'))
  await reconnectEnabled(deps)
  assert.deepEqual(hub.status(down.id), { status: 'erro', error: 'fetch failed' })
  assert.equal(hub.status(up.id).status, 'conectado')
  assert.deepEqual(store.list().map(c => [c.name, c.enabled]), [['Down', true], ['Up', true]])
  assert.deepEqual(lines.find(l => l[2] === 'Down'), ['warn', 'reconexão no início falhou', 'Down'])
  await hub.closeAll()
})

test('one that needs a login is not started and says so', async () => {
  const { store, hub, tried, deps } = setup({ needsLogin: async c => c.name === 'Token' })
  const token = store.add(draft('Token'))
  await reconnectEnabled(deps)
  assert.deepEqual(tried, [])
  assert.equal(hub.status(token.id).status, 'precisa de login')
})

test('a login check that throws does not reject and is logged', async () => {
  const { store, hub, lines, deps } = setup({ needsLogin: async c => { if (c.name === 'Cli') throw new Error('sem comando'); return false } })
  store.add(draft('Cli'))
  const up = store.add(draft('Up'))
  await reconnectEnabled(deps)
  assert.equal(hub.status(up.id).status, 'conectado')
  assert.deepEqual(lines.find(l => l[2] === 'Cli'), ['warn', 'reconexão no início falhou', 'Cli'])
  await hub.closeAll()
})

test('one switched off while its login was being checked is not started', async () => {
  let release: () => void = () => {}
  const { store, tried, deps } = setup({ needsLogin: () => new Promise(r => { release = () => r(false) }) })
  const c = store.add(draft('Late'))
  const running = reconnectEnabled(deps)
  store.update(c.id, { enabled: false })
  release()
  await running
  assert.deepEqual(tried, [])
})

test('a network failure of an http connector is tried again until it answers', async () => {
  const { store, hub, tried, lines, deps } = setup({ fail: ['Flaky'], failTimes: 2, retryDelays: [1, 1] })
  const c = store.add(draft('Flaky'))
  await reconnectEnabled(deps)
  assert.equal(tried.length, 3)
  assert.equal(hub.status(c.id).status, 'conectado')
  assert.deepEqual(lines.map(l => l[1]), ['reconexão no início vai tentar de novo', 'reconexão no início vai tentar de novo', 'reconexão no início ok'])
  await hub.closeAll()
})

test('the tries are limited, and a stdio connector gets only one', async () => {
  const { store, hub, tried, deps } = setup({ fail: ['Down', 'Local'], retryDelays: [1, 1] })
  const down = store.add(draft('Down'))
  store.add(draft('Local', { transport: 'stdio', command: 'x', url: undefined, trusted: true }))
  await reconnectEnabled(deps)
  assert.deepEqual(tried.sort(), ['Down', 'Down', 'Down', 'Local'])
  assert.deepEqual(hub.status(down.id), { status: 'erro', error: 'fetch failed' })
})

test('no more tries once the app is stopping or the connector was switched off', async () => {
  const stop = new AbortController()
  const a = setup({ fail: ['Down'], retryDelays: [60_000] })
  a.store.add(draft('Down'))
  const running = reconnectEnabled({ ...a.deps, signal: stop.signal })
  setTimeout(() => stop.abort(), 10)
  await running
  assert.equal(a.tried.length, 1)

  const b = setup({ fail: ['Down'], retryDelays: [20] })
  const c = b.store.add(draft('Down'))
  const again = reconnectEnabled(b.deps)
  setTimeout(() => b.store.update(c.id, { enabled: false }), 5)
  await again
  assert.equal(b.tried.length, 1)
})
