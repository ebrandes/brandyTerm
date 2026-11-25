import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConnectorHub, ConnectorError, type LiveClient, type ClientFactory } from './hub.ts'
import type { Connector } from '../../shared/connectors.ts'

const conn: Connector = { id: 'c1', name: 'C', description: '', transport: 'stdio', command: 'x', auth: { kind: 'none' }, enabled: true, alwaysAllow: [] }
const auth = () => ({ env: {}, headers: {} })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function fake() {
  const s = { connects: 0, closes: 0, fire: (_tail: string) => {} }
  const factory: ClientFactory = async () => {
    s.connects++
    let cb: (t: string) => void = () => {}
    s.fire = t => cb(t)
    const client: LiveClient = {
      tools: async () => [{ name: 't', inputSchema: {} }],
      call: async () => ({ content: [] }),
      close: async () => { s.closes++ },
      onClose: f => { cb = f },
    }
    return client
  }
  return { s, factory }
}

test('no connect until first use', () => {
  const { s, factory } = fake()
  const hub = new ConnectorHub({ factory, auth })
  assert.equal(hub.status('c1').status, 'desconectado')
  assert.equal(s.connects, 0)
})

test('one shared client, concurrent first uses share the connect', async () => {
  const { s, factory } = fake()
  const hub = new ConnectorHub({ factory, auth })
  await Promise.all([hub.tools(conn), hub.call(conn, 't', {})])
  await hub.call(conn, 't', {})
  assert.equal(s.connects, 1)
  assert.equal(hub.status('c1').status, 'conectado')
  assert.equal(hub.status('c1').toolCount, 1)
  await hub.closeAll()
})

test('idle close then reconnect', async () => {
  const { s, factory } = fake()
  const hub = new ConnectorHub({ factory, auth, idleMs: 50 })
  await hub.call(conn, 't', {})
  await sleep(120)
  assert.equal(s.closes, 1)
  assert.equal(hub.status('c1').status, 'desconectado')
  await hub.call(conn, 't', {})
  assert.equal(s.connects, 2)
  await hub.closeAll()
})

test('crash marks erro with the stderr tail and reconnects', async () => {
  const { s, factory } = fake()
  const hub = new ConnectorHub({ factory, auth })
  await hub.call(conn, 't', {})
  let changes = 0
  hub.on('change', () => changes++)
  s.fire('boom\nlast line')
  const st = hub.status('c1')
  assert.equal(st.status, 'erro')
  assert.ok(st.error?.endsWith('last line'))
  assert.ok(changes > 0)
  await hub.call(conn, 't', {})
  assert.equal(s.connects, 2)
  await hub.closeAll()
})

test('failed start is a ConnectorError', async () => {
  const hub = new ConnectorHub({ factory: async () => { throw new Error('spawn bad ENOENT') }, auth })
  await assert.rejects(hub.tools(conn), (e: unknown) => e instanceof ConnectorError && e.kind === 'failed' && /ENOENT/.test(e.message))
  assert.equal(hub.status('c1').status, 'erro')
})

test('login error marks status', async () => {
  const hub = new ConnectorHub({ factory: async () => { throw new ConnectorError('x', 'login') }, auth })
  await assert.rejects(hub.tools(conn), (e: unknown) => e instanceof ConnectorError && e.kind === 'login')
  assert.equal(hub.status('c1').status, 'precisa de login')
})

test('markLogin and test() count tools', async () => {
  const { factory } = fake()
  const hub = new ConnectorHub({ factory, auth })
  hub.markLogin('c1')
  assert.equal(hub.status('c1').status, 'precisa de login')
  assert.equal(await hub.test(conn), 1)
  assert.equal(hub.status('c1').status, 'conectado')
  await hub.closeAll()
})

test('killAll signals every live client synchronously', async () => {
  const kills: string[] = []
  const factory: ClientFactory = async c => ({
    tools: async () => [],
    call: async () => ({ content: [] }),
    close: async () => {},
    onClose: () => {},
    kill: () => { kills.push(c.id) },
  })
  const hub = new ConnectorHub({ factory, auth })
  await hub.tools(conn)
  await hub.tools({ ...conn, id: 'c2' })
  hub.killAll()
  assert.deepEqual(kills.sort(), ['c1', 'c2'])
})
