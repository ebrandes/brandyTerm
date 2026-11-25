import { test } from 'node:test'
import assert from 'node:assert/strict'
import { insideProjectFolder } from './attachment-scope.ts'

test('a remote attachment must sit in the calling project folder', () => {
  const root = '/data/attachments'
  assert.equal(insideProjectFolder(root, 'p1', '/data/attachments/p1/abc-a.png'), true)
  assert.equal(insideProjectFolder(root, 'p1', '/data/attachments/p2/abc-a.png'), false)
  assert.equal(insideProjectFolder(root, 'p1', '/data/attachments/p1/../p2/a.png'), false)
  assert.equal(insideProjectFolder(root, 'p1', '/data/attachments/p1'), false)
  assert.equal(insideProjectFolder(root, 'p1', '/etc/passwd'), false)
  assert.equal(insideProjectFolder(root, 'p.1', '/data/attachments/p_1/a'), true)
})
