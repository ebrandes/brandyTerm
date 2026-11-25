import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entrarArgs, showsEntrar } from './status.ts'

test('Entrar on a token connector only opens the card', () => {
  assert.deepEqual(entrarArgs({ id: 'a', authKind: 'token' }), { id: 'a' })
})

test('Entrar on oauth or cli runs the login at once', () => {
  assert.deepEqual(entrarArgs({ id: 'a', authKind: 'oauth' }), { id: 'a', values: {} })
  assert.deepEqual(entrarArgs({ id: 'a', authKind: 'cli' }), { id: 'a', values: {} })
})

test('Entrar shows whenever a connector that logs in is not connected', () => {
  for (const authKind of ['oauth', 'token', 'cli']) {
    for (const status of ['desconectado', 'precisa de login', 'erro'] as const) assert.equal(showsEntrar({ authKind, status }), true, `${authKind} ${status}`)
    assert.equal(showsEntrar({ authKind, status: 'conectado' }), false)
  }
  for (const status of ['desconectado', 'precisa de login', 'erro', 'conectado'] as const) assert.equal(showsEntrar({ authKind: 'none', status }), false)
})
