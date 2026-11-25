import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { createCalls } from './calls.ts'
import { ConnectorError, type ToolInfo } from './hub.ts'
import { LoginBroker } from './login.ts'
import { ConnectorStore } from './store.ts'
import { SecretStore } from './secrets.ts'
import { call, holds, mk, ref, setup, until } from './calls-fixture.ts'

const cipher = { available: () => true, encrypt: (s: string) => 'x' + s, decrypt: (s: string) => s.slice(1) }
const refused = () => new ConnectorError('Precisa de login.', 'login')
const tool: ToolInfo = { name: 'get_logs', inputSchema: {} }

/** the real login broker in front of a fake hub that refuses until `loggedIn` */
function withBroker(kind: 'oauth' | 'token') {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'cl-'))
  const store = new ConnectorStore(join(dir, 'c.json'))
  const secrets = new SecretStore(join(dir, 's.json'), cipher)
  const auth = kind === 'oauth' ? { kind } : { kind, fields: [{ key: 'token', label: 'Token', use: { header: 'Authorization', format: 'Bearer {value}' } }] }
  const c = store.add({ name: 'Linear', description: '', transport: 'http', url: 'https://x/mcp', enabled: true, auth: auth as never })
  const s = { loggedIn: false, order: [] as string[], needsAuth: true }
  const hub = {
    tools: async () => { s.order.push('tools'); if (s.needsAuth && !s.loggedIn) throw refused(); return [tool] },
    call: async () => { s.order.push('call'); return { content: [{ type: 'text', text: 'feito' }] } },
    test: async () => (await hub.tools()).length,
    markLogin: () => {},
  }
  const login = new LoginBroker({ store, secrets, hub, runners: { oauth: async () => { s.order.push('oauth'); s.loggedIn = true }, cli: async () => {}, check: async () => 1 } })
  const handle = createCalls({
    store, hub, login,
    approvals: { ask: async () => { s.order.push('ask'); return 'allow' }, releaseConnector: () => {} },
    findThread: r => ({ p: { id: r.projectId, path: '/proj' }, t: { id: r.threadId } }) as never,
    machineName: () => 'PC', elsewhere: () => undefined, notify: () => {},
  })
  const run = () => handle(ref, { id: 1, token: 't', op: 'call', name: 'Linear', tool: 'get_logs' }, new AbortController().signal)
  return { c, s, login, secrets, run }
}

test('a 401 from the hub shows a login card, then the call is retried once after login', async () => {
  const { c, s, login, run } = withBroker('oauth')
  const p = run()
  await until(() => login.threadLogins(ref.threadId).length > 0)
  assert.deepEqual(login.threadLogins(ref.threadId).map(l => [l.name, l.phase]), [['Linear', 'ask']])
  assert.deepEqual(s.order, ['tools'])
  await login.enter(c.id)
  assert.equal(await p, 'feito')
  // tools refused → card → oauth → the broker's test → the retry → approval → the call
  assert.deepEqual(s.order, ['tools', 'oauth', 'tools', 'tools', 'ask', 'call'])
  assert.equal(login.threadLogins(ref.threadId).length, 0)
})

test('an oauth connector with no tokens whose server needs no auth connects without a card', async () => {
  const { c, s, login, secrets, run } = withBroker('oauth')
  s.needsAuth = false
  assert.equal(secrets.get(c.id).oauth, undefined)
  assert.equal(await login.needsLogin(c), false)
  assert.equal(await run(), 'feito')
  assert.deepEqual(s.order, ['tools', 'ask', 'call'])
  assert.equal(login.panelLogins().length, 0)
})

test('a token connector that the server refuses gets the token card and one retry', async () => {
  const { c, s, login, secrets, run } = withBroker('token')
  secrets.set(c.id, { headers: { Authorization: 'Bearer expirado' } })
  s.needsAuth = true
  const p = run()
  await until(() => login.threadLogins(ref.threadId).length > 0)
  assert.deepEqual(login.threadLogins(ref.threadId)[0].fields, [{ key: 'token', label: 'Token' }])
  s.loggedIn = true
  await login.enter(c.id, { token: 'novo' })
  assert.equal(await p, 'feito')
  assert.equal(secrets.get(c.id).headers?.Authorization, 'Bearer novo')
})

test('the call itself refused: login, then the same call once more without a second approval', async () => {
  let n = 0
  const s = setup({ callImpl: async () => { if (n++ === 0) throw refused(); return { content: [{ type: 'text', text: 'ok' }] } } })
  assert.equal(await call(s), 'ok')
  assert.deepEqual(s.log.order, ['tools', 'ask', 'call', 'login', 'call'])
})

test('a second login error fails with the usual text', async () => {
  const s = setup({ tools: async () => { throw refused() } })
  await assert.rejects(call(s), { message: 'Precisa de login.' })
  assert.deepEqual(s.log.order, ['tools', 'login', 'tools'])
  assert.deepEqual(s.log.calls, [])
})

test('connector_tools refused: login, then the list', async () => {
  let n = 0
  const s = setup({ tools: async () => { if (n++ === 0) throw refused(); return [tool] } })
  assert.equal(await s.handle(ref, s.req('tools', { name: 'Railway' }), new AbortController().signal), JSON.stringify([{ name: 'get_logs', inputSchema: {} }]))
  assert.deepEqual(s.log.order, ['tools', 'login', 'tools'])
})

test('a call reaches the connector before the approval card, so a login comes first', async () => {
  const s = setup({ connectors: [mk()] })
  await call(s)
  assert.deepEqual(s.log.order, ['tools', 'ask', 'call'])
  assert.deepEqual(holds(s.log.order), ['ask', 'call'])
})

test('a failure that is not a login is not retried', async () => {
  const s = setup({ tools: async () => { throw new ConnectorError('fora do ar', 'failed') } })
  await assert.rejects(call(s), { message: 'fora do ar' })
  assert.deepEqual(s.log.order, ['tools'])
})
