import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dockSummary } from './dock-summary.ts'
import type { ProcessInfo } from './types.ts'

const proc = (state: ProcessInfo['state'], ports: number[] = []) => ({ state, ports }) as ProcessInfo

test('no processes and no context: only a zero count, no allow-all mark', () => {
  assert.deepEqual(dockSummary([], undefined, false), { count: 0, exited: 0, ports: [], context: undefined, allowAll: false })
})

test('counts processes and lists the ports of the running ones, sorted and once each', () => {
  const s = dockSummary([proc('running', [5173, 3000]), proc('running', [3000]), proc('exited', [8080])], undefined, false)
  assert.equal(s.count, 3)
  assert.equal(s.exited, 1)
  assert.deepEqual(s.ports, [3000, 5173])
})

test('context shows use and percentage', () => {
  assert.equal(dockSummary([], { used: 40_000, limit: 300_000 }, false).context, '40,0 mil (13%)')
})

test('allow-all stays flagged in the minimized line', () => {
  assert.equal(dockSummary([], undefined, true).allowAll, true)
})

test('detected processes add to the count and to the ports, never as stopped', () => {
  const s = dockSummary([proc('running', [3000]), proc('exited')], undefined, false, [
    { pid: 1, projectId: 'p', origin: 'external', command: 'x', ports: [4321, 3000] }
  ])
  assert.equal(s.count, 3)
  assert.equal(s.exited, 1)
  assert.deepEqual(s.ports, [3000, 4321])
})
