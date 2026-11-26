import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { BOOT_FAILED, bootConnectors } from './boot.ts'
import { startGatewayServer, type GwHandler } from './gateway-server.ts'
import type { GwRequest } from './gateway-protocol.ts'
import { gatewayFor } from '../adapters/gateway-launch.ts'
import { registerConnectorsIpc } from './connectors-ipc.ts'
import { Registry } from '../rpc/registry.ts'

const cipher = { available: () => true, encrypt: (s: string) => 'x' + s, decrypt: (s: string) => s.slice(1) }
const runners = () => ({ oauth: async () => {}, cli: async () => {}, check: async () => 0 })
const ref = { projectId: 'p1', threadId: 't1' }

function fakeEngine() {
  const thread = { id: 't1', logins: [{ connectorId: 'old' }] as unknown }
  return { thread, e: { state: { projects: [{ id: 'p1', threads: [thread] }], machine: { name: 'PC' } } as Record<string, unknown>, touch() {}, fail() {}, approvals: {} } }
}

async function quietly<T>(fn: () => Promise<T>): Promise<{ out: T; errors: unknown[][] }> {
  const errors: unknown[][] = []
  const orig = console.error
  console.error = (...a: unknown[]) => { errors.push(a) }
  try { return { out: await fn(), errors } } finally { console.error = orig }
}

test('a gateway socket that cannot listen leaves the app up, with no connectors and no gateway', async () => {
  const userData = fs.mkdtempSync(join(os.tmpdir(), 'boot-'))
  const { e, thread } = fakeEngine()
  // a real listen failure: the socket's directory does not exist
  const startServer: typeof startGatewayServer = (_p, h) => startGatewayServer(join(userData, 'falta', 'gw.sock'), h)
  const { out, errors } = await quietly(() => bootConnectors({ engine: e as never, userData, runners, cipher, startServer }))
  // the panel says why it is empty instead of looking like the connectors were gone
  const { fault, ...rest } = e.state.connectors as { fault?: string }
  assert.deepEqual(rest, { list: [], logins: [] })
  assert.match(fault ?? '', /^Conectores não iniciados: .*(listen|ENOENT|EACCES)/)
  assert.equal(thread.logins, undefined)
  assert.equal(gatewayFor(ref), null)
  assert.equal(errors.length, 1)
  assert.match(errors[0].map(String).join(' '), /listen|ENOENT/)
  assert.throws(() => out.deps.store.list(), { message: BOOT_FAILED })
  await out.stop()

  // the panel's channels register and refuse cleanly
  const reg = new Registry()
  registerConnectorsIpc(out.deps, reg)
  await assert.rejects(Promise.resolve().then(() => reg.invoke('connectors:remove', { id: 'x' }, {})), { message: BOOT_FAILED })
})

test('started normally: state set, gateway installed, stop closes it', async () => {
  const userData = fs.mkdtempSync(join(os.tmpdir(), 'boot-'))
  const { e } = fakeEngine()
  const { out, errors } = await quietly(() => bootConnectors({ engine: e as never, userData, runners, cipher }))
  assert.deepEqual(errors, [])
  assert.deepEqual(e.state.connectors, { list: [], logins: [] })
  assert.ok(gatewayFor(ref))
  assert.deepEqual(out.deps.store.list(), [])
  await out.stop()
})

test('a skills request reaches d.skills and never the connector calls; without d.skills it is refused', async (t) => {
  const { e } = fakeEngine()
  let handle: GwHandler | undefined
  const startServer: typeof startGatewayServer = (p, h) => { handle = h; return startGatewayServer(p, h) }
  const seen: GwRequest[] = []
  const skills: GwHandler = async (_r, req) => { seen.push(req); return 'skills ok' }
  const sig = new AbortController().signal
  const { out } = await quietly(() => bootConnectors({ engine: e as never, userData: fs.mkdtempSync(join(os.tmpdir(), 'boot-')), runners, cipher, startServer, skills }))
  t.after(() => out.stop())
  assert.equal(await handle!(ref, { id: 1, token: 'x', op: 'skills', tool: 'skills_catalog' }, sig), 'skills ok')
  assert.deepEqual(await handle!(ref, { id: 2, token: 'x', op: 'list' }, sig), [])
  assert.deepEqual(seen.map(r => r.op), ['skills'])

  const bare = await quietly(() => bootConnectors({ engine: e as never, userData: fs.mkdtempSync(join(os.tmpdir(), 'boot-')), runners, cipher, startServer }))
  t.after(() => bare.out.stop())
  await assert.rejects(handle!(ref, { id: 3, token: 'x', op: 'skills', tool: 'skills_catalog' }, sig), /skills/)
})

test('only skills threads get the skills tools flag in their gateway env', async (t) => {
  const { e } = fakeEngine()
  const userData = fs.mkdtempSync(join(os.tmpdir(), 'boot-'))
  const { out } = await quietly(() => bootConnectors({ engine: e as never, userData, runners, cipher, isSkillsThread: r => r.threadId === 't2' }))
  t.after(() => out.stop())
  assert.equal(gatewayFor({ projectId: 'p1', threadId: 't2' })?.env.BRANDY_GATEWAY_SKILLS, '1')
  assert.equal('BRANDY_GATEWAY_SKILLS' in gatewayFor(ref)!.env, false)
})
