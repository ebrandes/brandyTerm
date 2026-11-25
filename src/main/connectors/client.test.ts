import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { connectorError, realFactory } from './client.ts'
import { ConnectorError } from './hub.ts'
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

test('refused credentials mean a login: HTTP 401 and 403, and the SDK UnauthorizedError', () => {
  for (const e of [new StreamableHTTPError(401, 'x'), new StreamableHTTPError(403, 'x'), new UnauthorizedError()]) {
    const ce = connectorError(e)
    assert.equal(ce.kind, 'login')
    assert.equal(ce.message, 'Precisa de login.')
  }
  assert.equal(connectorError(new StreamableHTTPError(500, 'x')).kind, 'failed')
  assert.equal(connectorError(new Error('boom')).message, 'boom')
})

test('a token connector the server answers with 401 fails as needs-login, not as an error', async () => {
  for (const status of [401, 403]) {
    const srv = createServer((req, res) => { req.resume(); res.statusCode = status; res.end('{}') })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
    try {
      const url = `http://127.0.0.1:${(srv.address() as { port: number }).port}/mcp`
      const c: Connector = { id: 'g', name: 'GitHub', description: '', transport: 'http', url, auth: { kind: 'token', fields: [] }, enabled: true, alwaysAllow: [] }
      await assert.rejects(realFactory(c, { env: {}, headers: { Authorization: 'Bearer velho' } }), (e: unknown) => e instanceof ConnectorError && e.kind === 'login')
    } finally { srv.close() }
  }
})

test('a tool call gets 10 minutes, kept alive by progress, and the request signal; listing gets 60 s', async () => {
  const seen: Record<string, Record<string, unknown> | undefined> = {}
  const call = Client.prototype.callTool
  const list = Client.prototype.listTools
  Client.prototype.callTool = function (this: Client, ...a: Parameters<Client['callTool']>) { seen.call = a[2] as never; return call.apply(this, a) }
  Client.prototype.listTools = function (this: Client, ...a: Parameters<Client['listTools']>) { seen.list = a[1] as never; return list.apply(this, a) }
  try {
    const c = await realFactory(echo, auth)
    try {
      const ctl = new AbortController()
      await c.tools(ctl.signal)
      await c.call('echo', { text: 'oi' }, ctl.signal)
      assert.equal(seen.call?.timeout, 600_000)
      assert.equal(seen.call?.resetTimeoutOnProgress, true)
      // without a progress handler the SDK asks for no progress, and nothing could extend the timeout
      assert.equal(typeof seen.call?.onprogress, 'function')
      assert.equal(seen.call?.signal, ctl.signal)
      assert.equal(seen.list?.timeout, 60_000)
      assert.equal(seen.list?.signal, ctl.signal)
    } finally { await c.close() }
  } finally {
    Client.prototype.callTool = call
    Client.prototype.listTools = list
  }
})
