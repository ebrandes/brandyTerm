import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import net from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { startGatewayServer, type GwHandler } from './gateway-server.ts'
import { createCalls, RESULT_CAP } from './calls.ts'
import { MAX_REPLY } from './gateway-protocol.ts'
import type { Connector } from '../../shared/connectors.ts'
import type { Thread } from '../../shared/types.ts'
import { ThreadApprovals } from '../approvals.ts'

const posix = process.platform !== 'win32'
const script = resolve('src/main/connectors/gateway.ts')
let n = 0

function sockPath(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'bgwc-'))
  return posix ? join(dir, `s${n++}.sock`) : `\\\\.\\pipe\\bgwc-test-${process.pid}-${n++}`
}

async function withGateway<T>(handler: GwHandler, run: (c: Client) => Promise<T>, socket?: string): Promise<T> {
  const srv = await startGatewayServer(sockPath(), handler)
  const token = srv.issue({ projectId: 'p', threadId: 't' })
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [script],
    env: { NODE_NO_WARNINGS: '1', ELECTRON_RUN_AS_NODE: '1', BRANDY_GATEWAY_SOCKET: socket ?? srv.path, BRANDY_GATEWAY_TOKEN: token },
  })
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(transport)
  try { return await run(client) } finally { await client.close(); await srv.close() }
}

const text = (r: unknown): string => ((r as { content: { text: string }[] }).content[0].text)
const listHandler: GwHandler = async (_c, req) => {
  if (req.op === 'list') return [{ name: 'Railway', description: 'x' }]
  if (req.op === 'call' && req.tool === 'big') return 'y'.repeat(150_000)
  if (req.op === 'call' && req.tool === 'fail') throw new Error('Railway não está instalado em Mac.')
  return `${req.op}:${req.name}:${req.tool}:${JSON.stringify(req.args)}`
}

test('lists exactly three tools', async () => {
  await withGateway(listHandler, async c => {
    const { tools } = await c.listTools()
    assert.deepEqual(tools.map(t => t.name), ['list_connectors', 'connector_tools', 'call_connector'])
  })
})

test('list_connectors returns the handler result as JSON text', async () => {
  await withGateway(listHandler, async c => {
    const r = await c.callTool({ name: 'list_connectors', arguments: {} })
    assert.deepEqual(JSON.parse(text(r)), [{ name: 'Railway', description: 'x' }])
  })
})

test('connector_tools and call_connector forward their arguments', async () => {
  await withGateway(listHandler, async c => {
    assert.equal(text(await c.callTool({ name: 'connector_tools', arguments: { name: 'R' } })), 'tools:R:undefined:undefined')
    assert.equal(text(await c.callTool({ name: 'call_connector', arguments: { name: 'R', tool: 'go', args: { a: 1 } } })), 'call:R:go:{"a":1}')
  })
})

test('handler error becomes isError', async () => {
  await withGateway(listHandler, async c => {
    const r = await c.callTool({ name: 'call_connector', arguments: { name: 'Railway', tool: 'fail' } })
    assert.equal(r.isError, true)
    assert.equal(text(r), 'Railway não está instalado em Mac.')
  })
})

test('a 150 000 character result arrives capped and the next call still works', async () => {
  await withGateway(listHandler, async c => {
    const big = text(await c.callTool({ name: 'call_connector', arguments: { name: 'R', tool: 'big' } }))
    assert.ok(big.length < MAX_REPLY + 300 && /truncado/.test(big))
    assert.deepEqual(JSON.parse(text(await c.callTool({ name: 'list_connectors', arguments: {} }))), [{ name: 'Railway', description: 'x' }])
  })
})

/** the real dispatcher behind the socket, with a connector whose tool answers `text` */
function callsAnswering(text: string): GwHandler {
  const c: Connector = { id: 'c1', name: 'Logs', description: '', transport: 'stdio', command: 'x', enabled: true, auth: { kind: 'none' }, alwaysAllow: ['tail'] }
  return createCalls({
    store: { list: () => [c], visibleFor: () => [c], allow: () => {} },
    hub: { tools: async () => [], call: async () => ({ content: [{ type: 'text', text }] }) },
    login: { needsLogin: async () => false, require: async () => {} },
    approvals: { ask: async () => 'allow', releaseConnector: () => {} },
    findThread: r => ({ p: { id: r.projectId, path: '/p' }, t: { id: r.threadId } }) as never,
    machineName: () => 'PC', elsewhere: () => undefined, notify: () => {},
  })
}
const tail = { name: 'call_connector', arguments: { name: 'Logs', tool: 'tail' } }

test('a 94k log with quotes and newlines reaches the agent as the same plain text', async () => {
  let log = ''
  for (let i = 0; log.length < 94_300; i++) log += `2026-11-25T10:00:${String(i % 60).padStart(2, '0')}Z "GET /api/deploys?id=${i}" 200 "ok" {"ms":${i % 97}}\n`
  assert.ok(log.length < RESULT_CAP)
  await withGateway(callsAnswering(log), async c => {
    assert.equal(text(await c.callTool(tail)), log)
  })
})

test('a result over RESULT_CAP ends with the calls.ts note exactly once', async () => {
  await withGateway(callsAnswering('"linha"\n'.repeat(20_000)), async c => {
    const out = text(await c.callTool(tail))
    const note = `\n(resultado cortado em ${RESULT_CAP} caracteres)`
    assert.ok(out.endsWith(note))
    assert.equal(out.split(note).length, 2)
    assert.equal(out.includes('truncado'), false)
    assert.equal(out, '"linha"\n'.repeat(20_000).slice(0, RESULT_CAP) + note)
  })
})

test('an agent cancel removes the pending approval card and the hub is never called', { timeout: 8000 }, async () => {
  const c: Connector = { id: 'c1', name: 'Railway', description: '', transport: 'stdio', command: 'x', enabled: true, auth: { kind: 'none' }, alwaysAllow: [] }
  const t = { id: 't', steps: [] } as unknown as Thread
  const approvals = new ThreadApprovals(() => {})
  let hubCalls = 0
  const handler = createCalls({
    store: { list: () => [c], visibleFor: () => [c], allow: () => {} },
    hub: { tools: async () => [], call: async () => { hubCalls++; return { content: [] } } },
    login: { needsLogin: async () => false, require: async () => {} },
    approvals: { ask: (th, a) => approvals.ask(th, a), releaseConnector: () => {} },
    findThread: () => ({ p: { id: 'p', path: '/p' }, t }) as never,
    machineName: () => 'PC', elsewhere: () => undefined, notify: () => {},
  })
  await withGateway(handler, async client => {
    const ctl = new AbortController()
    const p = client.callTool({ name: 'call_connector', arguments: { name: 'Railway', tool: 'deploy' } }, undefined, { signal: ctl.signal })
    p.catch(() => {})
    while (!t.approval) await new Promise(r => setTimeout(r, 5))
    ctl.abort()
    const t0 = Date.now()
    while (t.approval && Date.now() - t0 < 2000) await new Promise(r => setTimeout(r, 5))
    assert.equal(t.approval, undefined)
    assert.equal(hubCalls, 0)
  })
})

test('dead socket answers instead of hanging', async () => {
  const dead = sockPath()
  const t0 = Date.now()
  await withGateway(listHandler, async c => {
    const r = await c.callTool({ name: 'list_connectors', arguments: {} })
    assert.equal(r.isError, true)
    assert.equal(text(r), 'BrandyTerm não está respondendo')
    assert.ok(Date.now() - t0 < 2000 + 1500)
  }, dead)
})

test('parallel first calls share one socket connection', async () => {
  const srv = await startGatewayServer(sockPath(), listHandler)
  const proxyPath = sockPath()
  let conns = 0
  const proxy = net.createServer(client => {
    conns++
    const up = net.connect(srv.path)
    client.pipe(up); up.pipe(client)
    client.on('error', () => up.destroy()); up.on('error', () => client.destroy())
    client.on('close', () => up.destroy()); up.on('close', () => client.destroy())
  })
  await new Promise<void>(r => proxy.listen(proxyPath, () => r()))
  const token = srv.issue({ projectId: 'p', threadId: 't' })
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [script],
    env: { NODE_NO_WARNINGS: '1', ELECTRON_RUN_AS_NODE: '1', BRANDY_GATEWAY_SOCKET: proxyPath, BRANDY_GATEWAY_TOKEN: token },
  }))
  try {
    const rs = await Promise.all([1, 2, 3, 4, 5].map(i => client.callTool({ name: 'call_connector', arguments: { name: 'R', tool: `t${i}` } })))
    assert.deepEqual(rs.map(r => text(r)), [1, 2, 3, 4, 5].map(i => `call:R:t${i}:undefined`))
    assert.equal(conns, 1)
  } finally { await client.close(); proxy.close(); await srv.close() }
})
