import { test } from 'node:test'
import assert from 'node:assert/strict'
import { entrarArgs } from './status.ts'

test('Entrar on a token connector only opens the card', () => {
  assert.deepEqual(entrarArgs({ id: 'a', authKind: 'token' }), { id: 'a' })
})

test('Entrar on oauth or cli runs the login at once', () => {
  assert.deepEqual(entrarArgs({ id: 'a', authKind: 'oauth' }), { id: 'a', values: {} })
  assert.deepEqual(entrarArgs({ id: 'a', authKind: 'cli' }), { id: 'a', values: {} })
})
