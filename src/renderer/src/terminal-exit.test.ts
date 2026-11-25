import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exitNotice } from './terminal-exit.ts'

test('a shell that ended says Enter opens another', () => {
  assert.equal(exitNotice('p1', 0), '\r\n\x1b[2m[processo encerrado (0). Pressione Enter para abrir outro shell]\x1b[0m\r\n')
})

test('a connector login terminal shows no Enter hint: Enter does nothing there', () => {
  assert.equal(exitNotice('connector-login-railway', 1), '\r\n\x1b[2m[processo encerrado (1)]\x1b[0m\r\n')
})
