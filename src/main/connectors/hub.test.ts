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
  // the connection was verified and nobody turned it off: it comes back on the next use
  assert.equal(hub.status('c1').status, 'conectado')
  await hub.call(conn, 't', {})
  assert.equal(s.connects, 2)
  await hub.closeAll()
})

test('closing on purpose says desconectado, also after an idle close', async () => {
  const { factory } = fake()
  const hub = new ConnectorHub({ factory, auth, idleMs: 30 })
  await hub.call(conn, 't', {})
  await hub.close('c1')
  assert.equal(hub.status('c1').status, 'desconectado')
  await hub.call(conn, 't', {})
  await sleep(80)
  let changes = 0
  hub.on('change', () => changes++)
  await hub.close('c1')
  assert.equal(hub.status('c1').status, 'desconectado')
  assert.equal(changes, 1)
})

test('a reconnect that fails after an idle close shows the error', async () => {
  let down = false
  const { factory } = fake()
  const hub = new ConnectorHub({ factory: (c, a) => { if (down) throw new Error('fetch failed'); return factory(c, a) }, auth, idleMs: 30 })
  await hub.call(conn, 't', {})
  await sleep(80)
  down = true
  await assert.rejects(hub.call(conn, 't', {}))
  assert.deepEqual(hub.status('c1'), { status: 'erro', error: 'fetch failed' })
})

test('test() leaves erro when the tool list is refused, and a later success clears it', async () => {
  let broken = true
  const factory: ClientFactory = async () => ({
    tools: async () => { if (broken) throw new ConnectorError('tools/list quebrou', 'failed'); return [] },
    call: async () => ({ content: [] }),
    close: async () => {},
    onClose: () => {},
  })
  const hub = new ConnectorHub({ factory, auth })
  await assert.rejects(hub.test(conn), /quebrou/)
  assert.deepEqual(hub.status('c1'), { status: 'erro', error: 'tools/list quebrou' })
  broken = false
  await hub.test(conn)
  assert.equal(hub.status('c1').status, 'conectado')
  await hub.closeAll()
})

test('closing while test() runs ends desconectado, not erro', async () => {
  let fail: (e: Error) => void = () => {}
  const factory: ClientFactory = async () => ({
    tools: () => new Promise((_, reject) => { fail = reject }),
    call: async () => ({ content: [] }),
    close: async () => { fail(new Error('Connection closed')) },
    onClose: () => {},
  })
  const hub = new ConnectorHub({ factory, auth })
  const running = assert.rejects(hub.test(conn))
  await sleep(10)
  await hub.close('c1')
  await running
  assert.equal(hub.status('c1').status, 'desconectado')
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

test('a login error drops the live client: the next use connects again with what the login saved', async () => {
  let refuse = false
  let connects = 0
  let closes = 0
  const factory: ClientFactory = async () => {
    connects++
    return {
      tools: async () => [],
      call: async () => { if (refuse) throw new ConnectorError('Precisa de login.', 'login'); return { content: [] } },
      close: async () => { closes++ },
      onClose: () => {},
    }
  }
  const hub = new ConnectorHub({ factory, auth })
  await hub.call(conn, 't', {})
  refuse = true
  await assert.rejects(hub.call(conn, 't', {}), (e: unknown) => e instanceof ConnectorError && e.kind === 'login')
  assert.equal(hub.status('c1').status, 'precisa de login')
  assert.equal(closes, 1)
  refuse = false
  await hub.call(conn, 't', {})
  assert.equal(connects, 2)
  assert.equal(hub.status('c1').status, 'conectado')
  await hub.closeAll()
})
