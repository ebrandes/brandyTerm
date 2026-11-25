import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { realFactory } from './client.ts'
import type { Connector } from '../../shared/connectors.ts'

const echo: Connector = {
  id: 'e', name: 'Echo', description: '', transport: 'stdio', command: process.execPath,
  args: [resolve('src/main/connectors/fixtures/echo-server.ts')], auth: { kind: 'none' }, enabled: true, alwaysAllow: [],
}
const auth = { env: {}, headers: {} }

test('realFactory talks stdio to the echo fixture', async () => {
  const c = await realFactory(echo, auth)
  try {
    const tools = await c.tools()
    assert.equal(tools[0].name, 'echo')
    const r = await c.call('echo', { text: 'oi' })
    assert.deepEqual(r.content, [{ type: 'text', text: 'oi' }])
  } finally { await c.close() }
})

test('an in-flight call rejects with the stderr tail when the process crashes', async () => {
  const c = await realFactory(echo, auth)
  let tail = ''
  c.onClose(t => { tail = t })
  await assert.rejects(c.call('crash', {}), /fatal: kaboom/)
  assert.match(tail, /fatal: kaboom/)
})

test('a missing command fails to start', async () => {
  await assert.rejects(realFactory({ ...echo, command: 'definitely-not-a-command-xyz' }, auth), /ENOENT/)
})
