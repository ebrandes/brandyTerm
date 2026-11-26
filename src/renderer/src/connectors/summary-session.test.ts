import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { startSummary } from './summary-session.ts'
import type { LogSummary } from '../../../shared/logs.ts'

function fake(answer: () => Promise<LogSummary> = async () => ({ state: 'ok', text: 'tudo bem' })) {
  const calls: string[] = []
  return {
    calls,
    api: {
      summarizeLogs: (area: string) => { calls.push(`summarize:${area}`); return answer() },
      cancelLogSummary: async (area: string) => { calls.push(`cancel:${area}`) }
    }
  }
}
const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

test('a session asks once, delivers the answer and cancels on close', async () => {
  const f = fake()
  const got: LogSummary[] = []
  const close = startSummary(f.api, 'mcp', (s) => got.push(s))
  await tick()
  close()
  assert.deepEqual(f.calls, ['summarize:mcp', 'cancel:mcp'])
  assert.deepEqual(got.map((s) => s.text), ['tudo bem'])
})

test('nothing is delivered after close', async () => {
  const f = fake()
  const got: LogSummary[] = []
  startSummary(f.api, 'mcp', (s) => got.push(s))()
  await tick()
  assert.deepEqual(got, [])
})

test('a rejected call becomes an error to retry', async () => {
  const f = fake(async () => { throw new Error('canal caiu') })
  const got: LogSummary[] = []
  startSummary(f.api, 'mcp', (s) => got.push(s))
  await tick()
  assert.deepEqual(got, [{ state: 'error', error: 'canal caiu' }])
})

// the model is only reachable through the open modal: these chains must not grow another entry
const root = new URL('../../../', import.meta.url)
const sources = readdirSync(root, { recursive: true, encoding: 'utf8' })
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))
const using = (pattern: RegExp): string[] =>
  sources.filter((f) => pattern.test(readFileSync(new URL(f, root), 'utf8'))).sort()

test('only the modal summary starts a session, and only an opened modal renders it', () => {
  assert.deepEqual(using(/\bstartSummary\(/), ['renderer/src/connectors/LogsSummary.tsx', 'renderer/src/connectors/summary-session.ts'])
  assert.deepEqual(using(/<LogsSummary\b/), ['renderer/src/connectors/LogsModal.tsx'])
  assert.deepEqual(using(/<LogsModal\b/), ['renderer/src/connectors/ConnectorRow.tsx', 'renderer/src/connectors/ConnectorsSection.tsx'])
  for (const f of using(/<LogsModal\b/)) assert.match(readFileSync(new URL(f, root), 'utf8'), /\{logs && \(?\s*<LogsModal/)
})

test('in main, only the summarize channel reaches the model', () => {
  assert.deepEqual(using(/\.summarize\(/), ['main/logs-ipc.ts'])
  assert.deepEqual(using(/createSummarizer\b/), ['main/logs-ipc.ts', 'main/logs-summary.ts'])
})
