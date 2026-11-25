import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sep } from 'node:path'
import { machineDir, openDecision, safeName, targetPath } from './open-policy.ts'

test('safeName keeps only a base name', () => {
  assert.equal(safeName('../../x'), 'x')
  assert.equal(safeName('a/b\\c'), 'c')
  assert.equal(safeName('..'), 'arquivo')
  assert.equal(safeName(''), 'arquivo')
  assert.equal(safeName(undefined), 'arquivo')
  assert.equal(safeName('a\x00b\x1f.png'), 'ab.png')
  assert.equal(safeName('x'.repeat(300)).length, 120)
})

test('safeName: Windows-hostile characters, reserved device names, bidi controls', () => {
  assert.equal(safeName('a<b>c:d"e|f?g*h.txt'), 'a_b_c_d_e_f_g_h.txt')
  for (const n of ['CON', 'con.txt', 'Prn', 'AUX.tar.gz', 'nul', 'COM1', 'lpt9.md']) assert.ok(safeName(n).startsWith('_'), n)
  assert.equal(safeName('console.txt'), 'console.txt')
  assert.equal(safeName('com10.txt'), 'com10.txt')
  assert.equal(safeName('fdp.\u202Egnp.exe'), 'fdp.gnp.exe')
  assert.equal(safeName('a\u200e\u2066b\u2069.txt'), 'ab.txt')
  assert.equal(safeName('name. . '), 'name')
})

test('targetPath: a hostile machine id or name never leaves the base folder', () => {
  const base = '/data/remote-open'
  for (const id of ['..', 'a/b', '..\\x', '../../..', '/etc', '']) {
    for (const name of ['f.png', '..', '../../x', '..\\..\\y']) {
      const p = targetPath(base, id, name)
      assert.ok(p.startsWith(base + sep + machineDir(id) + sep), `${id} ${name} -> ${p}`)
    }
  }
  assert.equal(machineDir('..').length, 16)
  assert.match(machineDir('a/b'), /^[0-9a-f]{16}$/)
})

test('only passive formats open; everything else is revealed', () => {
  for (const n of ['a.png', 'B.PDF', 'c.md', 'd.m4a', 'e.txt']) assert.equal(openDecision(n), 'open', n)
  for (const n of ['a.command', 'a.exe', 'a.app', 'a.sh', 'a.bat', 'a.ps1', 'a.js', 'a.jar', 'a.dmg', 'a.pkg', 'noext', 'a.png.exe', '.png', 'a.html', 'a.htm', 'a.svg']) {
    assert.equal(openDecision(n), 'reveal', n)
  }
})
