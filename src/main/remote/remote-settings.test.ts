import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeRemote } from './remote-settings.ts'

test('mergeRemote: a partial patch keeps the custom port', () => {
  assert.deepEqual(mergeRemote({ enabled: false, port: 50000 }, { enabled: true }), { enabled: true, port: 50000 })
})
test('mergeRemote: defaults, port change and invalid ports', () => {
  assert.deepEqual(mergeRemote(undefined, { enabled: true }), { enabled: true, port: 47321 })
  assert.deepEqual(mergeRemote({ enabled: true, port: 50000 }, { port: 51000 }), { enabled: true, port: 51000 })
  for (const port of [80, 70000, 1.5, NaN, '9000' as never]) assert.equal(mergeRemote({ enabled: true, port: 50000 }, { port }).port, 50000)
})
