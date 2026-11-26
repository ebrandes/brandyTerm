// A connector that does not start says at which stage, why, and what it printed, without its secrets.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { createFactory, realFactory } from './client.ts'
import { connectStage, failureMessage } from './connect-diag.ts'
import { ConnectorError } from './hub.ts'
import type { Connector } from '../../shared/connectors.ts'

const SECRET = 'segredo-do-conector-123'
// starts, prints to stderr, and never answers initialize: what `claude mcp add …` did as a "server"
const silent: Connector = {
  id: 's', name: 'Mudo', description: '', transport: 'stdio', command: process.execPath,
  args: ['-e', `process.stderr.write('usando ' + process.env.MY_KEY + ' Bearer abcdefghijkl\\n'); setInterval(() => {}, 1000)`],
  auth: { kind: 'none' }, enabled: true, alwaysAllow: [], trusted: true,
}
const auth = { env: { MY_KEY: SECRET }, headers: {} }

test('a server that never answers initialize names the stage, the timeout and its stderr, redacted', async () => {
  const err = await createFactory({ connectMs: 400 })(silent, auth).then(() => null, (e: unknown) => e)
  assert.ok(err instanceof ConnectorError && err.kind === 'failed')
  assert.match(err.message, /^Falhou em initialize \(handshake MCP\): sem resposta em 400 ms \(MCP -32001\)/)
  assert.match(err.message, /não um instalador como "claude mcp add"/)
  assert.match(err.message, /stderr: usando \[oculto\] Bearer \[oculto\]/)
  assert.ok(!err.message.includes(SECRET) && !err.message.includes('abcdefghijkl'))
  assert.ok(err.message.length <= 500)
})

test('a missing program fails at the spawn stage', async () => {
  const err = await realFactory({ ...silent, command: 'definitely-not-a-command-xyz', args: [] }, auth).then(() => null, (e: unknown) => e)
  assert.ok(err instanceof ConnectorError)
  assert.match(err.message, /^Falhou em iniciar o processo: comando "definitely-not-a-command-xyz" não encontrado \(ENOENT\)/)
})

test('a process that exits before answering says so, with what it printed', async () => {
  const dies: Connector = { ...silent, args: ['-e', "process.stderr.write('Error: module not found\\n'); process.exit(3)"] }
  const err = await createFactory({ connectMs: 5000 })(dies, auth).then(() => null, (e: unknown) => e)
  assert.ok(err instanceof ConnectorError)
  assert.match(err.message, /^Falhou em initialize \(handshake MCP\): o processo terminou antes de responder\.\nstderr: Error: module not found/)
})

test('an install command saved as the server fails at once with the fix, without running it', async () => {
  const pasted: Connector = { ...silent, command: 'claude', args: ['mcp add --transport http context7 https://mcp.context7.com/mcp'] }
  const t0 = Date.now()
  const err = await realFactory(pasted, auth).then(() => null, (e: unknown) => e)
  assert.ok(err instanceof ConnectorError && err.kind === 'failed')
  assert.match(err.message, /claude mcp add.*não o servidor MCP/)
  assert.match(err.message, /URL \(http\) https:\/\/mcp\.context7\.com\/mcp/)
  assert.ok(Date.now() - t0 < 1000)
})

test('stages: errno codes are the spawn, fetch errors the connection, the rest initialize', () => {
  const http: Connector = { ...silent, transport: 'http', url: 'https://x.test/mcp' }
  assert.equal(connectStage(silent, Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' })), 'spawn')
  assert.equal(connectStage(silent, new McpError(ErrorCode.RequestTimeout, 'Request timed out')), 'initialize')
  assert.equal(connectStage(http, new TypeError('fetch failed')), 'connect')
  assert.equal(connectStage(http, new McpError(ErrorCode.RequestTimeout, 'x')), 'initialize')
})

test('the message keeps the head when stderr is long and fits the card', () => {
  const f = { connector: silent, stage: 'tools/list' as const, timeoutMs: 60_000, stderr: 'x'.repeat(2000), ended: false }
  const m = failureMessage(new McpError(ErrorCode.RequestTimeout, 'Request timed out'), f, s => s)
  assert.match(m, /^Falhou em tools\/list \(listar ferramentas\): sem resposta em 60 s/)
  assert.ok(m.length <= 500)
})
