import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultName, osOf } from './machine.ts'

test('osOf maps platforms', () => {
  assert.equal(osOf('darwin'), 'mac')
  assert.equal(osOf('win32'), 'windows')
  assert.equal(osOf('linux'), 'linux')
  assert.equal(osOf('freebsd'), 'linux')
})

test('defaultName strips .local and falls back per OS', () => {
  assert.equal(defaultName('Eduardos-MacBook-Pro.local', 'mac'), 'Eduardos-MacBook-Pro')
  assert.equal(defaultName('', 'windows'), 'PC Windows')
  assert.equal(defaultName('', 'mac'), 'Mac')
})
