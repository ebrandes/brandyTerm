import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { BOOT_FAILED, bootConnectors } from './boot.ts'
import { startGatewayServer } from './gateway-server.ts'
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
  assert.deepEqual(e.state.connectors, { list: [], logins: [] })
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
