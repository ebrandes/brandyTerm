import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { startGatewayServer, socketPath, type GwHandler } from './gateway-server.ts'
import { MAX_LINE, MAX_RESULT, type GwResponse } from './gateway-protocol.ts'

const posix = process.platform !== 'win32'
let n = 0
function tmpPath(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'bgw-'))
  return posix ? join(dir, `s${n++}.sock`) : `\\\\.\\pipe\\bgw-test-${process.pid}-${n++}`
}

function connect(path: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(path, () => resolve(s))
    s.once('error', reject)
  })
}

function oneReply(s: net.Socket): Promise<GwResponse> {
  return new Promise(resolve => {
    let buf = ''
    s.setEncoding('utf8')
    s.on('data', c => { buf += c; const i = buf.indexOf('\n'); if (i >= 0) resolve(JSON.parse(buf.slice(0, i))) })
  })
}

async function ask(path: string, req: object): Promise<GwResponse> {
  const s = await connect(path)
  try { s.write(JSON.stringify(req) + '\n'); return await oneReply(s) } finally { s.destroy() }
}

test('unknown token is refused', async () => {
  const srv = await startGatewayServer(tmpPath(), async () => 'x')
  try {
    assert.deepEqual(await ask(srv.path, { id: 1, token: 'nope', op: 'list' }), { id: 1, ok: false, error: 'Sessão do gateway inválida' })
  } finally { await srv.close() }
})

test('issued token reaches the handler with its thread', async () => {
  let seen: string | undefined
  const handler: GwHandler = async ctx => { seen = `${ctx.projectId}/${ctx.threadId}`; return 'ok' }
  const srv = await startGatewayServer(tmpPath(), handler)
  try {
    const token = srv.issue({ projectId: 'p', threadId: 't' })
    assert.equal(srv.issue({ projectId: 'p', threadId: 't' }), token)
    assert.notEqual(srv.issue({ projectId: 'p', threadId: 'u' }), token)
    assert.deepEqual(await ask(srv.path, { id: 2, token, op: 'list' }), { id: 2, ok: true, result: 'ok' })
    assert.equal(seen, 'p/t')
  } finally { await srv.close() }
})

test('a handler error is returned as the error text', async () => {
  const srv = await startGatewayServer(tmpPath(), async () => { throw new Error('falhou') })
  try {
    const token = srv.issue({ projectId: 'p', threadId: 't' })
    assert.deepEqual(await ask(srv.path, { id: 3, token, op: 'list' }), { id: 3, ok: false, error: 'falhou' })
  } finally { await srv.close() }
})

test('socket close aborts in-flight requests', async () => {
  let signal!: AbortSignal
  let started!: () => void
  const running = new Promise<void>(r => { started = r })
  const handler: GwHandler = (_c, _r, sig) => new Promise(() => { signal = sig; started() })
  const srv = await startGatewayServer(tmpPath(), handler)
  try {
    const token = srv.issue({ projectId: 'p', threadId: 't' })
    const s = await connect(srv.path)
    s.write(JSON.stringify({ id: 4, token, op: 'call' }) + '\n')
    await running
    assert.equal(signal.aborted, false)
    const aborted = new Promise<void>(r => signal.addEventListener('abort', () => r()))
    s.destroy()
    await aborted
    assert.equal(signal.aborted, true)
  } finally { await srv.close() }
})

test('oversized line drops the socket and the server keeps serving', async () => {
  const srv = await startGatewayServer(tmpPath(), async () => 'ok')
  try {
    const s = await connect(srv.path)
    s.on('error', () => {})
    const closed = new Promise<void>(r => s.once('close', () => r()))
    s.write('a'.repeat(MAX_LINE + 1))
    await closed
    const token = srv.issue({ projectId: 'p', threadId: 't' })
    assert.equal((await ask(srv.path, { id: 5, token, op: 'list' })).ok, true)
  } finally { await srv.close() }
})

test('a result over the cap is truncated and the connection stays usable', async () => {
  const srv = await startGatewayServer(tmpPath(), async (_c, req) => (req.id === 6 ? 'x'.repeat(150_000) : 'curto'))
  try {
    const token = srv.issue({ projectId: 'p', threadId: 't' })
    const s = await connect(srv.path)
    const first = oneReply(s)
    s.write(JSON.stringify({ id: 6, token, op: 'call' }) + '\n')
    const big = await first
    assert.ok(big.ok && typeof big.result === 'string')
    assert.ok((big.result as string).length < MAX_RESULT + 200)
    assert.match(big.result as string, /truncado/)
    const second = oneReply(s)
    s.write(JSON.stringify({ id: 7, token, op: 'call' }) + '\n')
    assert.deepEqual(await second, { id: 7, ok: true, result: 'curto' })
    s.destroy()
  } finally { await srv.close() }
})

test('stale socket file is replaced', { skip: !posix }, async () => {
  const path = tmpPath()
  fs.writeFileSync(path, 'stale')
  const srv = await startGatewayServer(path, async () => 'ok')
  try {
    const token = srv.issue({ projectId: 'p', threadId: 't' })
    assert.equal((await ask(path, { id: 8, token, op: 'list' })).ok, true)
  } finally { await srv.close() }
})

test('the socket file is private to the user', { skip: !posix }, async () => {
  const srv = await startGatewayServer(tmpPath(), async () => 'ok')
  try {
    assert.equal(fs.statSync(srv.path).mode & 0o777, 0o600)
  } finally { await srv.close() }
})

test('socketPath falls back to tmpdir when the path is too long', { skip: !posix }, () => {
  assert.equal(socketPath('/a', 7), '/a/gw-7.sock')
  assert.equal(socketPath('/a'.repeat(60), 7), join(os.tmpdir(), 'bt-gw-7.sock'))
})
