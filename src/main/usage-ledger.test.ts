import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activeTools, configureLedger, entryFor, monthOf, readLedger, recordRun } from './usage-ledger.ts'
import { claudeStream } from './adapters/claude-events.ts'
import type { AgentEvent, RunOpts } from './adapters/types.ts'
import type { RunResult } from './run.ts'

const opts = (extra: Partial<RunOpts> = {}) => ({ prompt: 'x', cwd: '/p', ...extra }) as RunOpts
const result = (): RunResult => ({
  usage: { input: 100, output: 10, cached: 80, measured: true },
  done: { kind: 'done', ok: true, text: '' }
}) as unknown as RunResult
const probe = { rtkBin: () => '/bin/rtk', codexRtkHook: () => 'unapproved' as const }

test('only the savers really in the run count as active', () => {
  const te = opts({ plugins: ['/x/tokeneconomizer'] })
  assert.deepEqual(activeTools('claude', te, probe), { rtk: true, te: true })
  assert.deepEqual(activeTools('claude', opts({ tools: 'none' }), probe), { rtk: false, te: false })
  assert.deepEqual(activeTools('codex', te, probe), { rtk: false, te: false })
  assert.equal(activeTools('codex', opts(), { ...probe, codexRtkHook: () => 'approved' as never }).rtk, true)
})

test('codex input is stored without the cached part', () => {
  assert.equal(entryFor('codex', opts(), result()).input, 20)
  assert.equal(entryFor('claude', opts(), result()).input, 100)
})

test('runs are appended per month and a broken line is skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brandy-ledger-'))
  configureLedger(null)
  recordRun('claude', opts(), result())
  assert.deepEqual(readdirSync(dir), [])
  configureLedger(dir)
  recordRun('claude', opts({ tag: { kind: 'work', projectId: 'p1', threadId: 't1', tier: 'leve' } }), result())
  configureLedger(null)
  const month = monthOf(new Date())
  appendFileSync(join(dir, `${month}.jsonl`), '{"cortada')
  const [entry, ...rest] = readLedger(dir, month)
  assert.equal(rest.length, 0)
  assert.equal(entry.threadId, 't1')
  assert.equal(entry.tier, 'leve')
  assert.deepEqual(readLedger(dir, '../x'), [])
  rmSync(dir, { recursive: true })
})

test('the model of a claude run is the one that cost most', () => {
  const events: AgentEvent[] = []
  claudeStream((e) => events.push(e), 'conta').handle({
    type: 'result', subtype: 'success', result: 'ok', usage: {},
    modelUsage: { barato: { costUSD: 0.01 }, caro: { costUSD: 0.5 } }
  })
  assert.equal((events.find((e) => e.kind === 'usage') as { model?: string }).model, 'caro')
})
