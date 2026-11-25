import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PanelLogin } from '../../../shared/connectors.ts'
import { goneTerminals } from './login-terminals.ts'

const cli = (id: string): PanelLogin => ({ connectorId: id, name: id, phase: 'waiting', authKind: 'cli' })

test('a terminal whose login left the list is gone; the others stay live', () => {
  const r = goneTerminals(['connector-login-a', 'connector-login-b'], [cli('b')])
  assert.deepEqual(r, { gone: ['connector-login-a'], live: ['connector-login-b'] })
})

test('non-cli logins have no terminal', () => {
  assert.deepEqual(goneTerminals([], [{ ...cli('a'), authKind: 'oauth' }]), { gone: [], live: [] })
})
