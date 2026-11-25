import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parentDir } from './parent-dir.ts'

test('parentDir goes up one folder and stops at the top', () => {
  assert.equal(parentDir('~/a/b/'), '~/a/')
  assert.equal(parentDir('~/a/'), '~/')
  assert.equal(parentDir('~/'), '~/')
  assert.equal(parentDir('/a/'), '/')
  assert.equal(parentDir('/'), '/')
})
