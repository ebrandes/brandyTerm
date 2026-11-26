import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ProcSnapshot } from './proc-attribution.ts'
import { descendants, indexOf, lineage } from './proc-tree.ts'

const snap = (...rows: [number, number, number?][]): ProcSnapshot => ({
  procs: rows.map(([pid, ppid, startedAt]) => ({ pid, ppid, command: `c${pid}`, startedAt })),
  ports: new Map()
})

test('three levels: children come before their parents, siblings of the root stay out', () => {
  const s = snap([10, 1], [11, 10], [12, 11], [13, 10], [20, 1])
  assert.deepEqual(descendants(s, 10), [12, 11, 13, 10])
  assert.deepEqual(lineage(indexOf(s), 12), [12, 11, 10, 1])
})

test('a ppid cycle ends; a missing pid is just itself', () => {
  assert.deepEqual(descendants(snap([10, 11], [11, 10]), 10), [11, 10])
  assert.deepEqual(descendants(snap([10, 1]), 99), [99])
})

test('a "child" older than its parent only points at a reused pid', () => {
  assert.deepEqual(descendants(snap([10, 1, 500], [11, 10, 100], [12, 10, 600]), 10), [12, 10])
})
