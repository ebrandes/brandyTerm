import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSummarizer, type ModelResult } from './logs-summary.ts'
import { readLogs } from './logs-read.ts'
import type { LogsRead } from '../shared/logs.ts'

const full = (mtimeMs = 1, size = 10): LogsRead =>
  ({ size, mtimeMs, entries: [{ ts: '2026-11-26T10:00:00.000Z', level: 'error', msg: 'quebrou' }] })

function setup(read: () => Promise<LogsRead> = async () => full(), timeoutMs?: number) {
  const prompts: string[] = []
  const ends: ((r: ModelResult) => void)[] = []
  let cancels = 0
  const summarizer = createSummarizer({
    read,
    timeoutMs,
    run: (prompt) => {
      prompts.push(prompt)
      const result = new Promise<ModelResult>((resolve) => { ends.push(resolve) })
      return { result, cancel: () => { cancels++ } }
    }
  })
  const answer = async (r: ModelResult = { ok: true, text: 'tudo bem' }) => {
    await tick()
    ends.at(-1)!(r)
  }
  return { summarizer, prompts, answer, cancels: () => cancels }
}
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

test('creating the summarizer and reading the log never call the model', async () => {
  const s = setup()
  await readLogs(join(tmpdir(), 'nao-existe-brandy'), 'mcp')
  await tick()
  assert.equal(s.prompts.length, 0)
})

test('an unchanged log reuses the cached summary; a changed one asks again', async () => {
  let now = full(1)
  const s = setup(async () => now)
  const first = s.summarizer.summarize('mcp')
  await s.answer()
  assert.deepEqual(await first, { state: 'ok', text: 'tudo bem', cached: false, costUsd: undefined })
  assert.equal((await s.summarizer.summarize('mcp')).cached, true)
  assert.equal(s.prompts.length, 1)
  now = full(2)
  const changed = s.summarizer.summarize('mcp')
  await s.answer()
  await changed
  now = full(2, 11)
  const grown = s.summarizer.summarize('mcp')
  await s.answer()
  await grown
  assert.equal(s.prompts.length, 3)
  assert.match(s.prompts[0], /quebrou/)
})

test('an empty log does not call the model', async () => {
  const s = setup(async () => ({ entries: [], size: 0, mtimeMs: 0 }))
  assert.deepEqual(await s.summarizer.summarize('mcp'), { state: 'empty' })
  assert.equal(s.prompts.length, 0)
})

test('two requests while one runs share it', async () => {
  const s = setup()
  const a = s.summarizer.summarize('mcp')
  const b = s.summarizer.summarize('mcp')
  await s.answer()
  assert.deepEqual(await a, await b)
  assert.equal(s.prompts.length, 1)
})

test('cancel stops the run and nothing is cached', async () => {
  const s = setup()
  const first = s.summarizer.summarize('mcp')
  await tick()
  s.summarizer.cancel('mcp')
  assert.deepEqual(await first, { state: 'cancelled' })
  assert.equal(s.cancels(), 1)
  await s.answer({ ok: true, text: 'resposta atrasada' })
  const again = s.summarizer.summarize('mcp')
  await s.answer()
  assert.equal((await again).text, 'tudo bem')
  assert.equal(s.prompts.length, 2)
})

test('closing before the log is read never calls the model, and reopening right away works', async () => {
  const s = setup()
  const first = s.summarizer.summarize('mcp')
  s.summarizer.cancel('mcp')
  const second = s.summarizer.summarize('mcp')
  assert.deepEqual(await first, { state: 'cancelled' })
  await s.answer()
  assert.equal((await second).state, 'ok')
  assert.equal(s.prompts.length, 1)
})

test('a failure is reported and not cached', async () => {
  const s = setup()
  const first = s.summarizer.summarize('mcp')
  await s.answer({ ok: false, text: '', error: 'Claude CLI não encontrado' })
  assert.deepEqual(await first, { state: 'error', error: 'Claude CLI não encontrado' })
  const retry = s.summarizer.summarize('mcp')
  await s.answer()
  assert.equal((await retry).state, 'ok')
})

test('an unreadable log and a throwing run become errors', async () => {
  const broken = setup(async () => { throw new Error('sem permissão') })
  assert.deepEqual(await broken.summarizer.summarize('mcp'), { state: 'error', error: 'sem permissão' })
  const boom = createSummarizer({ read: async () => full(), run: () => { throw new Error('spawn falhou') } })
  assert.deepEqual(await boom.summarize('mcp'), { state: 'error', error: 'spawn falhou' })
})

test('a run that takes too long is cancelled and becomes an error', async () => {
  const s = setup(undefined, 10)
  const keepAlive = setTimeout(() => {}, 1000)
  const out = await s.summarizer.summarize('mcp')
  clearTimeout(keepAlive)
  assert.equal(out.state, 'error')
  assert.equal(s.cancels(), 1)
})

test('readLogs joins rotated files oldest first and skips broken lines', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'brandy-logs-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const row = (msg: string) => `${JSON.stringify({ ts: '2026-11-26T10:00:00.000Z', area: 'mcp', level: 'info', msg, data: {} })}\n`
  await writeFile(join(dir, 'mcp.2.log'), row('a'))
  await writeFile(join(dir, 'mcp.1.log'), row('b'))
  await writeFile(join(dir, 'mcp.log'), `${row('c')}{quebrada\nnull\n{"msg":1}\n`)
  const first = await readLogs(dir, 'mcp')
  assert.deepEqual(first.entries.map((e) => e.msg), ['a', 'b', 'c'])
  await appendFile(join(dir, 'mcp.log'), row('d'))
  assert.notEqual((await readLogs(dir, 'mcp')).size, first.size)
})

test('readLogs refuses an area that is not a log area', async () => {
  await assert.rejects(readLogs(tmpdir(), '../segredo'), /Área de log desconhecida/)
})
