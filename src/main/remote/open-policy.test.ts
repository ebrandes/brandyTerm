import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDecision, safeName, targetPath } from './open-policy.ts'

test('safeName keeps only a base name', () => {
  assert.equal(safeName('../../x'), 'x')
  assert.equal(safeName('a/b\\c'), 'c')
  assert.equal(safeName('..'), 'arquivo')
  assert.equal(safeName(''), 'arquivo')
  assert.equal(safeName(undefined), 'arquivo')
  assert.equal(safeName('a\x00b\x1f.png'), 'ab.png')
  assert.equal(safeName('x'.repeat(300)).length, 120)
})

test('targetPath stays under the machine folder', () => {
  assert.equal(targetPath('/tmp', 'm1', '../../etc/passwd'), '/tmp/brandyterm-remote/m1/passwd')
})

test('only passive formats open; everything else is revealed', () => {
  for (const n of ['a.png', 'B.PDF', 'c.md', 'd.m4a', 'e.html']) assert.equal(openDecision(n), 'open', n)
  for (const n of ['a.command', 'a.exe', 'a.app', 'a.sh', 'a.bat', 'a.ps1', 'a.js', 'a.jar', 'a.dmg', 'a.pkg', 'noext', 'a.png.exe', '.png']) {
    assert.equal(openDecision(n), 'reveal', n)
  }
})
