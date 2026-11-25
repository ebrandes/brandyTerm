import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { LoginBroker, type Runners } from './login.ts'
import { ConnectorStore } from './store.ts'
import { SecretStore } from './secrets.ts'
import type { Connector } from '../../shared/connectors.ts'

const cipher = { available: () => true, encrypt: (s: string) => 'x' + s, decrypt: (s: string) => s.slice(1) }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const p = { projectId: 'p' }

function setup(o: { holdMs?: number; oauth?: Runners['oauth']; cli?: Runners['cli']; check?: Runners['check']; test?: () => Promise<number> } = {}) {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'login-'))
  const store = new ConnectorStore(join(dir, 'c.json'))
  const secrets = new SecretStore(join(dir, 's.json'), cipher)
  const railway = store.add({ name: 'Railway', description: '', transport: 'stdio', command: 'railway', enabled: true, auth: { kind: 'cli', command: ['railway', 'login'], check: ['railway', 'whoami'] } })
  const github = store.add({
    name: 'GitHub', description: '', transport: 'http', url: 'https://x/mcp', enabled: true,
    auth: { kind: 'token', fields: [{ key: 'token', label: 'Token', use: { header: 'Authorization', format: 'Bearer {value}' } }] },
  })
  const linear = store.add({ name: 'Linear', description: '', transport: 'http', url: 'https://y/mcp', enabled: true, auth: { kind: 'oauth' } })
  const none = store.add({ name: 'Plain', description: '', transport: 'stdio', command: 'x', enabled: true, auth: { kind: 'none' } })
  const log = { cli: 0, oauth: 0, tests: 0, marked: [] as string[], terminals: [] as string[] }
  const runners: Runners = {
    cli: o.cli ?? (async (_c, tid) => { log.cli++; log.terminals.push(tid) }),
    oauth: o.oauth ?? (async () => { log.oauth++ }),
    check: o.check ?? (async () => 1),
  }
  const hub = { test: o.test ?? (async () => { log.tests++; return 1 }), markLogin: (id: string) => { log.marked.push(id) } }
  const broker = new LoginBroker({ store, secrets, hub, runners, holdMs: o.holdMs })
  return { broker, store, secrets, log, railway, github, linear, none, dir }
}

test('card waits for Entrar: phase ask, nothing runs', () => {
  const { broker, log, railway } = setup()
  void broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal).catch(() => {})
  assert.deepEqual(broker.threadLogins('t1').map(l => ({ name: l.name, phase: l.phase })), [{ name: 'Railway', phase: 'ask' }])
  assert.equal(log.cli, 0)
  assert.equal(log.tests, 0)
  assert.equal(broker.threadLogins('t2').length, 0)
  broker.cancel(railway.id)
})

test('Entrar runs the login once and releases every waiter', async () => {
  const { broker, log, railway } = setup()
  const a = broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal)
  const b = broker.require(railway, { ...p, threadId: 't2' }, new AbortController().signal)
  await broker.enter(railway.id)
  await Promise.all([a, b])
  assert.equal(log.cli, 1)
  assert.deepEqual(log.terminals, [`connector-login-${railway.id}`])
  assert.equal(log.tests, 1)
  assert.equal(broker.threadLogins('t1').length + broker.threadLogins('t2').length, 0)
  assert.equal(broker.panelLogins().length, 0)
})

test('waiting phase while the runner runs; a second Entrar does not start another', async () => {
  let release: () => void = () => {}
  let runs = 0
  const { broker, railway } = setup({ cli: () => { runs++; return new Promise<void>(r => { release = r }) } })
  const w = broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal)
  const first = broker.enter(railway.id)
  assert.equal(broker.threadLogins('t1')[0].phase, 'waiting')
  await broker.enter(railway.id)
  assert.equal(runs, 1)
  release()
  await first
  await w
})

test('Cancelar rejects every waiter with the message and clears the cards', async () => {
  const { broker, log, railway } = setup()
  const a = broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal)
  const b = broker.require(railway, { ...p, threadId: 't2' }, new AbortController().signal)
  broker.cancel(railway.id)
  await assert.rejects(a, /^Error: login do Railway cancelado$/)
  await assert.rejects(b, /login do Railway cancelado/)
  assert.equal(broker.threadLogins('t1').length, 0)
  assert.equal(broker.panelLogins().length, 0)
  assert.deepEqual(log.marked, [railway.id])
})

test('Cancelar while waiting aborts the runner, rejects waiters and ignores its late result', async () => {
  let seen: AbortSignal | undefined
  let release: () => void = () => {}
  const { broker, log, railway } = setup({ cli: (_c, _t, s) => { seen = s; return new Promise<void>(r => { release = r }) } })
  const w = broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal)
  const run = broker.enter(railway.id)
  broker.cancel(railway.id)
  assert.equal(seen?.aborted, true)
  await assert.rejects(w, /login do Railway cancelado/)
  release()
  await run
  assert.equal(log.tests, 0)
  assert.equal(broker.panelLogins().length, 0)
  assert.deepEqual(log.marked, [railway.id])
})

test('hold timeout rejects with the cancelado text (ruling C1) and marks needs-login', async () => {
  const { broker, log, railway } = setup({ holdMs: 100 })
  const w = broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal)
  await assert.rejects(w, /login do Railway cancelado/)
  assert.equal(broker.panelLogins().length, 0)
  assert.deepEqual(log.marked, [railway.id])
})

test('hold timer also covers a login that never finishes', async () => {
  let seen: AbortSignal | undefined
  const { broker, railway } = setup({ holdMs: 60, cli: (_c, _t, s) => { seen = s; return new Promise<void>(() => {}) } })
  const w = broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal)
  void broker.enter(railway.id)
  await assert.rejects(w, /login do Railway cancelado/)
  assert.equal(seen?.aborted, true)
})

test('hold timer is cleared on success', async () => {
  const { broker, log, railway } = setup({ holdMs: 60 })
  const w = broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal)
  await broker.enter(railway.id)
  await w
  let changes = 0
  broker.on('change', () => changes++)
  await sleep(120)
  assert.equal(changes, 0)
  assert.deepEqual(log.marked, [])
})

test('waiter abort rejects only that thread; the other card stays and Entrar still releases it', async () => {
  const { broker, railway } = setup()
  const ac = new AbortController()
  const a = broker.require(railway, { ...p, threadId: 't1' }, ac.signal)
  const b = broker.require(railway, { ...p, threadId: 't2' }, new AbortController().signal)
  ac.abort()
  await assert.rejects(a, /login do Railway cancelado/)
  assert.equal(broker.threadLogins('t1').length, 0)
  assert.equal(broker.threadLogins('t2').length, 1)
  await broker.enter(railway.id)
  await b
})

test('the last waiter aborting drops a card nobody asked for, but keeps a panel one', async () => {
  const { broker, railway, github } = setup()
  const ac = new AbortController()
  const a = broker.require(railway, { ...p, threadId: 't1' }, ac.signal)
  ac.abort()
  await assert.rejects(a)
  assert.equal(broker.panelLogins().length, 0)
  broker.ask(github)
  const ac2 = new AbortController()
  const b = broker.require(github, { ...p, threadId: 't1' }, ac2.signal)
  ac2.abort()
  await assert.rejects(b)
  assert.equal(broker.panelLogins().length, 1)
})

test('an already aborted signal rejects at once without a card', async () => {
  const { broker, railway } = setup()
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(broker.require(railway, { ...p, threadId: 't1' }, ac.signal), /login do Railway cancelado/)
  assert.equal(broker.panelLogins().length, 0)
})

test('ask shows the panel card in phase ask with the terminal id and no thread card', () => {
  const { broker, railway } = setup()
  broker.ask(railway)
  assert.deepEqual(broker.panelLogins().map(l => [l.connectorId, l.phase, l.authKind, l.terminalId]), [[railway.id, 'ask', 'cli', `connector-login-${railway.id}`]])
  assert.equal(broker.threadLogins('t1').length, 0)
})

test('token login saves fields as secrets and nothing else carries the value', async () => {
  const { broker, secrets, github } = setup()
  const events: string[] = []
  broker.on('change', () => events.push(JSON.stringify([broker.panelLogins(), broker.threadLogins('t1')])))
  const w = broker.require(github, { ...p, threadId: 't1' }, new AbortController().signal)
  assert.deepEqual(broker.panelLogins()[0].fields, [{ key: 'token', label: 'Token' }])
  await broker.enter(github.id, { token: 'abc' })
  await w
  assert.equal(secrets.get(github.id).headers?.Authorization, 'Bearer abc')
  assert.equal(events.some(e => e.includes('abc')), false)
  assert.equal(JSON.stringify(broker.panelLogins()).includes('abc'), false)
  assert.equal(JSON.stringify(github).includes('abc'), false)
})

test('token login with a missing value fails the card without saving or connecting', async () => {
  const { broker, secrets, log, github } = setup()
  void broker.require(github, { ...p, threadId: 't1' }, new AbortController().signal).catch(() => {})
  await broker.enter(github.id, { token: '  ' })
  assert.equal(broker.panelLogins()[0].phase, 'failed')
  assert.match(broker.panelLogins()[0].error ?? '', /Token/)
  assert.equal(secrets.get(github.id).headers, undefined)
  assert.equal(log.tests, 0)
  broker.cancel(github.id)
})

test('token env fields are stored in env', async () => {
  const { broker, secrets, store } = setup()
  const c = store.add({ name: 'Env', description: '', transport: 'stdio', command: 'x', enabled: true, auth: { kind: 'token', fields: [{ key: 'k', label: 'Chave', use: { env: 'API_KEY' } }] } })
  void broker.require(c, { ...p, threadId: 't1' }, new AbortController().signal)
  await broker.enter(c.id, { k: 'v1' })
  assert.deepEqual(secrets.get(c.id).env, { API_KEY: 'v1' })
})

test('failure keeps the entry: phase failed with the error, connector kept and marked needs-login', async () => {
  const { broker, store, log, railway } = setup({ cli: async () => { throw new Error('x') } })
  void broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal).catch(() => {})
  await broker.enter(railway.id)
  const [card] = broker.threadLogins('t1')
  assert.equal(card.phase, 'failed')
  assert.equal(card.error, 'x')
  assert.ok(store.get(railway.id))
  assert.deepEqual(log.marked, [railway.id])
  broker.cancel(railway.id)
})

test('after a failure Entrar tries again and releases the waiter', async () => {
  let n = 0
  const { broker, railway } = setup({ cli: async () => { if (n++ === 0) throw new Error('boom') } })
  const w = broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal)
  await broker.enter(railway.id)
  assert.equal(broker.threadLogins('t1')[0].phase, 'failed')
  await broker.enter(railway.id)
  await w
  assert.equal(broker.threadLogins('t1').length, 0)
})

test('connecting after the runner fails the card when hub.test fails', async () => {
  const { broker, railway } = setup({ test: async () => { throw new Error('sem acesso') } })
  void broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal).catch(() => {})
  await broker.enter(railway.id)
  assert.equal(broker.panelLogins()[0].error, 'sem acesso')
  broker.cancel(railway.id)
})

test('oauth connector runs the oauth runner', async () => {
  const { broker, log, linear } = setup()
  const w = broker.require(linear, { ...p, threadId: 't1' }, new AbortController().signal)
  await broker.enter(linear.id)
  await w
  assert.equal(log.oauth, 1)
  assert.equal(log.cli, 0)
})

test('needsLogin per kind', async () => {
  const { broker, secrets, github, linear, none, railway } = setup({ check: async cmd => (cmd[1] === 'whoami' ? 1 : 0) })
  assert.equal(await broker.needsLogin(none), false)
  assert.equal(await broker.needsLogin(github), true)
  secrets.set(github.id, { headers: { Authorization: 'Bearer z' } })
  assert.equal(await broker.needsLogin(github), false)
  // oauth logs in on demand: only a login error from the connector shows its card
  assert.equal(await broker.needsLogin(linear), false)
  secrets.set(linear.id, { oauth: { tokens: { access_token: 'a' } } })
  assert.equal(await broker.needsLogin(linear), false)
  assert.equal(await broker.needsLogin(railway), true)
})

test('needsLoginNow: only a token connector without its stored values, with no command run', () => {
  let checks = 0
  const { broker, secrets, github, linear, none, railway } = setup({ check: async () => { checks++; return 1 } })
  assert.equal(broker.needsLoginNow(github), true)
  secrets.set(github.id, { headers: { Authorization: 'Bearer z' } })
  assert.equal(broker.needsLoginNow(github), false)
  assert.equal(broker.needsLoginNow(linear), false)
  assert.equal(broker.needsLoginNow(none), false)
  assert.equal(broker.needsLoginNow(railway), false)
  assert.equal(checks, 0)
})

test('a token login records the header and env names, never the values', async () => {
  const { broker, store, dir, github } = setup()
  const w = broker.require(github, { ...p, threadId: 't1' }, new AbortController().signal)
  await broker.enter(github.id, { token: 'ghp_segredo' })
  await w
  assert.deepEqual(store.get(github.id)?.headerKeys, ['Authorization'])
  assert.equal(store.get(github.id)?.envKeys, undefined)
  assert.equal(fs.readFileSync(join(dir, 'c.json'), 'utf8').includes('ghp_segredo'), false)
  const env = store.add({ name: 'Env', description: '', transport: 'stdio', command: 'x', enabled: true, envKeys: ['OTHER'], auth: { kind: 'token', fields: [{ key: 'k', label: 'Chave', use: { env: 'API_KEY' } }] } })
  void broker.require(env, { ...p, threadId: 't1' }, new AbortController().signal)
  await broker.enter(env.id, { k: 'v1' })
  assert.deepEqual(store.get(env.id)?.envKeys, ['OTHER', 'API_KEY'])
})

test('a token login that fails records no names', async () => {
  const { broker, store, github } = setup({ test: async () => { throw new Error('401') } })
  void broker.require(github, { ...p, threadId: 't1' }, new AbortController().signal).catch(() => {})
  await broker.enter(github.id, { token: 'ruim' })
  assert.equal(store.get(github.id)?.headerKeys, undefined)
  broker.cancel(github.id)
})

test('needsLogin for cli: a passing check means logged in; no check means not asking', async () => {
  const { broker, railway } = setup({ check: async () => 0 })
  assert.equal(await broker.needsLogin(railway), false)
  assert.equal(await broker.needsLogin({ ...railway, auth: { kind: 'cli', command: ['railway', 'login'] } }), false)
})

test('a bad token that fails hub.test restores the previous good token', async () => {
  const { broker, secrets, github } = setup({ test: async () => { throw new Error('401') } })
  secrets.set(github.id, { headers: { Authorization: 'Bearer good' }, env: { E: '1' } })
  void broker.require(github, { ...p, threadId: 't1' }, new AbortController().signal).catch(() => {})
  await broker.enter(github.id, { token: 'bad' })
  assert.equal(broker.panelLogins()[0].phase, 'failed')
  assert.deepEqual(secrets.get(github.id), { headers: { Authorization: 'Bearer good' }, env: { E: '1' } })
  broker.cancel(github.id)
  assert.equal(secrets.get(github.id).headers?.Authorization, 'Bearer good')
})

test('a bad token with no earlier token leaves nothing stored', async () => {
  const { broker, secrets, github } = setup({ test: async () => { throw new Error('401') } })
  void broker.require(github, { ...p, threadId: 't1' }, new AbortController().signal).catch(() => {})
  await broker.enter(github.id, { token: 'bad' })
  assert.deepEqual(secrets.get(github.id), {})
  assert.equal(await broker.needsLogin(github), true)
  broker.cancel(github.id)
})

test('Cancelar while the token is being tested restores the previous token', async () => {
  let release: () => void = () => {}
  const { broker, secrets, github } = setup({ test: () => new Promise<number>(r => { release = () => r(1) }) })
  secrets.set(github.id, { headers: { Authorization: 'Bearer good' } })
  const w = broker.require(github, { ...p, threadId: 't1' }, new AbortController().signal)
  const run = broker.enter(github.id, { token: 'new' })
  broker.cancel(github.id)
  await assert.rejects(w)
  release()
  await run
  assert.equal(secrets.get(github.id).headers?.Authorization, 'Bearer good')
})

test('the view says whether a login was started from the panel', () => {
  const { broker, railway, github } = setup()
  void broker.require(railway, { ...p, threadId: 't1' }, new AbortController().signal).catch(() => {})
  broker.ask(github)
  const panel = Object.fromEntries(broker.panelLogins().map(l => [l.name, l.panel]))
  assert.deepEqual(panel, { Railway: false, GitHub: true })
  assert.equal(broker.threadLogins('t1')[0].panel, false)
  // a row-started login a thread then waits on stays a panel login
  void broker.require(github, { ...p, threadId: 't2' }, new AbortController().signal).catch(() => {})
  assert.equal(broker.threadLogins('t2')[0].panel, true)
  broker.cancel(railway.id)
  broker.cancel(github.id)
})
