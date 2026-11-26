import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateMonitor } from './update-monitor.ts'
import type { CheckResult } from './update-check.ts'
import type { UpdateStatus } from '../shared/update.ts'

const notice = { kind: 'git', behind: 2, command: 'git pull' } as const

test('keeps the notice when a check cannot tell, clears it when one says there is none', async () => {
  const answers: CheckResult[] = [{ commit: 'abc1234', update: notice }, {}, { commit: 'def5678', update: null }]
  const seen: UpdateStatus[] = []
  const m = createUpdateMonitor('0.1.0', async () => answers.shift()!, (s) => seen.push(s))
  assert.deepEqual(m.status(), { version: '0.1.0', update: null })
  await m.check()
  await m.check()
  assert.deepEqual(m.status(), { version: '0.1.0', commit: 'abc1234', update: notice })
  await m.check()
  assert.deepEqual(m.status(), { version: '0.1.0', commit: 'def5678', update: null })
  assert.equal(seen.length, 2)
})

test('does not overlap checks, and a check that throws does not reject', async () => {
  let runs = 0
  const m = createUpdateMonitor('0.1.0', async () => { runs++; throw new Error('boom') }, () => {})
  await Promise.all([m.check(), m.check()])
  assert.equal(runs, 1)
  await m.check()
  assert.equal(runs, 2)
})
