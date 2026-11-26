import test from 'node:test'
import assert from 'node:assert/strict'
import { noticeTitle, terminalName, versionTitle } from './version-labels.ts'

test('the version tooltip carries the commit only when running from a clone', () => {
  assert.equal(versionTitle({ version: '0.1.0', update: null }), 'BrandyTerm v0.1.0')
  assert.equal(versionTitle({ version: '0.1.0', commit: 'abc1234', update: null }), 'BrandyTerm v0.1.0 · commit abc1234')
})

test('each kind of notice says what the click does', () => {
  assert.match(noticeTitle({ kind: 'release', version: '0.2.0', url: 'u' }), /v0\.2\.0.*navegador/)
  assert.equal(noticeTitle({ kind: 'git', behind: 1, command: 'git pull' }), '1 commit atrás de origin/main')
  assert.equal(noticeTitle({ kind: 'git', behind: 3, command: 'git pull' }), '3 commits atrás de origin/main')
})

test('the terminal is named per platform', () => {
  assert.equal(terminalName('win32'), 'PowerShell')
  assert.equal(terminalName('darwin'), 'Terminal')
  assert.equal(terminalName('linux'), 'terminal')
})
