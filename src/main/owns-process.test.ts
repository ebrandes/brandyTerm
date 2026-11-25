import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ownsProcess } from './owns-process.ts'

test('ownsProcess only matches the project own processes', () => {
  const a = { processes: [{ id: 'x' }] } as never
  assert.equal(ownsProcess(a, 'x'), true)
  assert.equal(ownsProcess(a, 'y'), false)
  assert.equal(ownsProcess(undefined, 'x'), false)
})
