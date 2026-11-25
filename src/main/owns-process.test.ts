import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ownedProcess, ownsProcess } from './owns-process.ts'

test('ownsProcess only matches the project own processes', () => {
  const a = { processes: [{ id: 'x' }] } as never
  assert.equal(ownsProcess(a, 'x'), true)
  assert.equal(ownsProcess(a, 'y'), false)
  assert.equal(ownsProcess(undefined, 'x'), false)
})

test('ownedProcess: the ids of a stop/remove call only when that project started that process', () => {
  const projects = [{ id: 'a', processes: [{ id: 'x' }] }, { id: 'b', processes: [{ id: 'y' }] }] as never
  assert.deepEqual(ownedProcess(projects, { projectId: 'a', processId: 'x' }), { projectId: 'a', processId: 'x' })
  assert.equal(ownedProcess(projects, { projectId: 'a', processId: 'y' }), null, "another project's process")
  assert.equal(ownedProcess(projects, { projectId: 'z', processId: 'x' }), null)
  assert.equal(ownedProcess(projects, null), null)
  assert.equal(ownedProcess(projects, 'x'), null)
})
