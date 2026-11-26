import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConnectorHub, ConnectorError, type LiveClient, type ClientFactory } from './hub.ts'
import type { Connector } from '../../shared/connectors.ts'

const conn: Connector = { id: 'c1', name: 'C', description: '', transport: 'http', url: 'https://x.test/mcp', auth: { kind: 'none' }, enabled: true, alwaysAllow: [] }
const auth = () => ({ env: {}, headers: {} })
const never = <T>() => new Promise<T>(() => {})

function client(tools: LiveClient['tools']): LiveClient {
  return { tools, call: async () => ({ content: [] }), close: async () => {}, onClose: () => {} }
}

test('Testar ends when initialize never answers: erro naming the stage', async () => {
  const factory: ClientFactory = () => never()
  const hub = new ConnectorHub({ factory, auth, testMs: 30 })
  await assert.rejects(hub.test(conn), (e: unknown) =>
    e instanceof ConnectorError && e.kind === 'failed' && /initialize/.test(e.message) && /Tempo esgotado/.test(e.message))
  const s = hub.status('c1')
  assert.equal(s.status, 'erro')
  assert.match(s.error ?? '', /initialize/)
})

test('Testar ends when tools/list never answers, and aborts the request', async () => {
  let aborted = false
  const factory: ClientFactory = async () => client(signal => {
    signal?.addEventListener('abort', () => { aborted = true })
    return never()
  })
  const hub = new ConnectorHub({ factory, auth, testMs: 30 })
  await assert.rejects(hub.test(conn), (e: unknown) => e instanceof ConnectorError && /tools\/list/.test(e.message))
  assert.equal(aborted, true)
  assert.equal(hub.status('c1').status, 'erro')
})

test('a test that answers in time counts the tools and leaves no timer behind', async () => {
  const factory: ClientFactory = async () => client(async () => [{ name: 'a', inputSchema: {} }, { name: 'b', inputSchema: {} }])
  const hub = new ConnectorHub({ factory, auth, testMs: 5_000 })
  assert.equal(await hub.test(conn), 2)
  assert.equal(hub.status('c1').status, 'conectado')
  assert.equal(hub.status('c1').toolCount, 2)
  await hub.closeAll()
})
