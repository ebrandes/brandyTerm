import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureDiagLog, diagLog, diagLogOnChange, flushDiagLog } from './diag-log.ts'

function setup(t: { after(fn: () => void): void }, opts: { debug?: boolean; maxBytes?: number } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'diag-'))
  configureDiagLog({ dir, debug: false, ...opts })
  t.after(() => {
    configureDiagLog(null)
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

const lines = (file: string): any[] => readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l))

test('writes one JSON line per entry, one file per area', async t => {
  const dir = setup(t)
  diagLog('plugins', 'info', 'instalado', { id: 'ralph-loop' })
  diagLog('remote', 'error', 'falhou\ncom quebra')
  await flushDiagLog()
  const [p] = lines(join(dir, 'plugins.log'))
  assert.deepEqual(Object.keys(p), ['ts', 'area', 'level', 'msg', 'data'])
  assert.ok(!Number.isNaN(Date.parse(p.ts)))
  assert.deepEqual([p.area, p.level, p.msg, p.data], ['plugins', 'info', 'instalado', { id: 'ralph-loop' }])
  const r = lines(join(dir, 'remote.log'))
  assert.equal(r.length, 1)
  assert.deepEqual(r[0].data, {})
})

test('keeps the order of many entries', async t => {
  const dir = setup(t)
  for (let i = 0; i < 200; i++) diagLog('mcp', 'info', `n${i}`)
  await flushDiagLog()
  assert.deepEqual(lines(join(dir, 'mcp.log')).map(l => l.msg), Array.from({ length: 200 }, (_, i) => `n${i}`))
})

test('rotates by size and keeps at most 3 files per area', async t => {
  const dir = setup(t, { maxBytes: 600 })
  for (let i = 0; i < 100; i++) diagLog('skills', 'info', `entrada ${i}`, { pad: 'x'.repeat(40) })
  await flushDiagLog()
  assert.deepEqual(readdirSync(dir).sort(), ['skills.1.log', 'skills.2.log', 'skills.log'])
  for (const f of readdirSync(dir)) assert.ok(statSync(join(dir, f)).size <= 600, f)
  assert.equal(lines(join(dir, 'skills.log')).at(-1).msg, 'entrada 99')
  assert.ok(lines(join(dir, 'skills.2.log')).at(-1).msg < lines(join(dir, 'skills.1.log'))[0].msg)
})

test('rotation counts what a previous run left in the file', async t => {
  const dir = setup(t, { maxBytes: 300 })
  writeFileSync(join(dir, 'mcp.log'), `${'a'.repeat(290)}\n`)
  diagLog('mcp', 'info', 'nova')
  await flushDiagLog()
  assert.equal(lines(join(dir, 'mcp.log'))[0].msg, 'nova')
  assert.ok(existsSync(join(dir, 'mcp.1.log')))
})

test('debug entries are written only when debug is on', async t => {
  const dir = setup(t)
  diagLog('mcp', 'debug', 'escondido')
  await flushDiagLog()
  assert.ok(!existsSync(join(dir, 'mcp.log')))
  configureDiagLog({ dir, debug: true })
  diagLog('mcp', 'debug', 'visível')
  await flushDiagLog()
  assert.equal(lines(join(dir, 'mcp.log'))[0].msg, 'visível')
})

test('does nothing before it is configured', async () => {
  configureDiagLog(null)
  assert.doesNotThrow(() => diagLog('mcp', 'error', 'sem destino'))
  await flushDiagLog()
})

test('a disk failure never throws nor rejects, and later writes work again', async t => {
  const dir = setup(t)
  const blocker = join(dir, 'arquivo')
  writeFileSync(blocker, '')
  configureDiagLog({ dir: join(blocker, 'logs'), debug: false })
  assert.doesNotThrow(() => diagLog('remote', 'error', 'perdido'))
  await flushDiagLog()
  configureDiagLog({ dir, debug: false })
  diagLog('remote', 'info', 'voltou')
  await flushDiagLog()
  assert.equal(lines(join(dir, 'remote.log'))[0].msg, 'voltou')
})

test('data that cannot be serialized never throws', async t => {
  const dir = setup(t)
  const loop: Record<string, unknown> = { n: 1n }
  loop.self = loop
  const hostile = { get boom(): string { throw new Error('getter') } }
  assert.doesNotThrow(() => diagLog('mcp', 'info', 'ciclo', loop))
  assert.doesNotThrow(() => diagLog('mcp', 'info', 'getter', hostile))
  diagLog('mcp', 'error', 'erro', { error: new Error('quebrou'), bytes: new Uint8Array(4) })
  await flushDiagLog()
  const all = lines(join(dir, 'mcp.log'))
  assert.equal(all[0].data.self, '[circular]')
  assert.equal(all.at(-1).data.error.message, 'quebrou')
  assert.equal(all.at(-1).data.bytes, '[4 bytes]')
})

test('secrets are redacted before reaching the disk', async t => {
  const dir = setup(t)
  diagLog('mcp', 'error', 'falhou com Bearer abc.def-123456 em https://u:senhaurl@host/x?access_token=qsvalor1', {
    token: 'valor-token', apiKey: 'valor-key', client_secret: 'valor-secret', Password: 'valor-pass',
    Authorization: 'valor-authz', cookie: 'valor-cookie',
    env: { QUALQUER: 'valor-env' }, headers: { 'x-custom': 'valor-header' },
    nested: [{ refreshToken: 'valor-nested' }],
    stderr: 'sk-ant-api03-AbCdEf123456 ghp_AbCdEf1234567890 github_pat_11ABCDEF0_zzzzzzzz',
    cli: 'run --token valorflag1 API_KEY=valorassign1 password: valorcolon1',
    json: '{"client_secret":"valorjson1"}',
    jwt: 'eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl',
    error: new Error('401 Authorization: Basic dXNlcjpwYXNz')
  })
  await flushDiagLog()
  const raw = readFileSync(join(dir, 'mcp.log'), 'utf8')
  for (const secret of [
    'abc.def-123456', 'senhaurl', 'qsvalor1', 'valor-', 'AbCdEf', '11ABCDEF0', 'valorflag1', 'valorassign1',
    'valorcolon1', 'valorjson1', 'c2lnbmF0dXJl', 'dXNlcjpwYXNz'
  ]) assert.ok(!raw.includes(secret), `vazou: ${secret}`)
  const [entry] = lines(join(dir, 'mcp.log'))
  assert.deepEqual(Object.keys(entry.data.env), ['QUALQUER'])
  assert.equal(entry.data.token, '[oculto]')
})

test('values of sensitive environment variables are redacted wherever they appear', async t => {
  const dir = setup(t)
  process.env.DIAG_TEST_SECRET = 'zq81-valor-do-ambiente'
  t.after(() => { delete process.env.DIAG_TEST_SECRET })
  diagLog('plugins', 'warn', 'saída: zq81-valor-do-ambiente', { line: 'x zq81-valor-do-ambiente y' })
  await flushDiagLog()
  assert.ok(!readFileSync(join(dir, 'plugins.log'), 'utf8').includes('zq81'))
})

test('a long string is truncated only after redaction', async t => {
  const dir = setup(t)
  diagLog('mcp', 'info', 'longo', { text: `${'a'.repeat(3990)} sk-AbCdEfGhIjKlMnOp ${'b'.repeat(9000)}` })
  await flushDiagLog()
  const [e] = lines(join(dir, 'mcp.log'))
  assert.ok(e.data.text.length < 4100)
  assert.ok(!e.data.text.includes('sk-AbC'))
})

test('ordinary diagnostic text survives redaction', async t => {
  const dir = setup(t)
  diagLog('remote', 'info', 'MCP error -32001: Request timed out', { code: 1, address: '192.168.0.2:47017', path: '/tmp/task-runner' })
  await flushDiagLog()
  const [e] = lines(join(dir, 'remote.log'))
  assert.equal(e.msg, 'MCP error -32001: Request timed out')
  assert.deepEqual(e.data, { code: 1, address: '192.168.0.2:47017', path: '/tmp/task-runner' })
})

test('diagLogOnChange skips a repeated entry for the same key', async t => {
  const dir = setup(t)
  for (const n of [1, 1, 2, 2, 1]) diagLogOnChange('x', 'skills', 'info', 'descoberta', { n })
  await flushDiagLog()
  assert.deepEqual(lines(join(dir, 'skills.log')).map(l => l.data.n), [1, 2, 1])
})
